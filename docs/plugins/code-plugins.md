# 代码插件开发

代码插件用 JavaScript 注册扩展点，运行在独立的 worker 线程里。与声明式插件（纯 JSON 数据）相比，代码插件需要用户明确授权，安装时逐条展示权限；未声明的能力调用直接拒绝并写入 Trace，不做静默放行（I18）。宿主与插件之间的通信、权限判定与失败处理都在主线程完成，插件只通过 Context API 访问网络、文件、模型与台账。

## 目录布局与清单

安装后的插件放在 `<插件目录>/<插件名>/` 下，根目录必须有清单 `dramaticer.plugin.json`。npm、git、zip 三种来源解包后都按这个布局检查。入口模块与文件权限的相对路径都从插件目录解析。

清单是严格校验的 JSON：未知字段、空字符串、重复权限类别都会抛错，错误信息带字段路径（例如 `codePlugin.permissions[0].hosts`）。

| 字段 | 必填 | 规则 |
|---|---|---|
| `format` | 是 | 固定为 `dramaticer.code-plugin` |
| `formatVersion` | 是 | `formatVersion` 只支持 1；其他值整份清单拒绝 |
| `name` | 是 | 插件名，只含小写字母、数字、`.`、`_`、`-`，并以字母或数字开头 |
| `version` | 是 | 插件自身版本，形如 `1.2.3` 或 `1.2.3-beta.1` |
| `tier` | 是 | 固定为 `code` |
| `engine` | 是 | 兼容的 Dramaticer 版本范围，semver 语法，例如 `>=0.1.0 <0.2.0` |
| `entry` | 是 | 相对插件目录的入口模块，必须以 `.js` 或 `.mjs` 结尾，不能是绝对路径、反斜杠路径或含 `..` |
| `title` | 否 | 展示标题 |
| `description` | 否 | 说明文字 |
| `inject` | 否 | 依赖的服务名数组；同名不能同时出现在 `provide` |
| `provide` | 否 | 向外提供的服务名数组 |
| `configSchema` | 否 | 配置的 JSON Schema 对象；运行时把 `config` 原样交给 `activate()` |
| `permissions` | 否 | 权限数组，同一类别只能出现一次 |

```json
{
	"format": "dramaticer.code-plugin",
	"formatVersion": 1,
	"name": "example.travel-log",
	"version": "1.0.0",
	"tier": "code",
	"engine": ">=0.1.0 <0.2.0",
	"entry": "plugin.mjs",
	"permissions": [
		{ "kind": "files", "access": "read", "paths": ["data"] }
	]
}
```

## 四类权限

| `kind` | 字段 | 允许范围 |
|---|---|---|
| `network` | `hosts` | 主机名、`host:port` 或 `*.example.com`；无端口时匹配任意端口，`*.example.com` 只匹配子域，不匹配裸域 |
| `files` | `access`、`paths` | `read` 或 `read-write`；路径是插件目录内的相对路径，目录按前缀匹配，`.` 表示整个插件目录 |
| `model` | `roles` | `writer`、`settler`、`planner`、`judge` 之一或多个 |
| `ledger-write` | `namespaces` | `character`、`relation`、`item`、`scene`、`time`、`clue`、`knowledge`、`userWill`、`mvu`、`rule` 之一或多个 |

安装记录里保存用户授予的权限；运行时要求授予的权限是清单声明的子集。权限类别缺失、范围之外的主机与路径、只读权限下的写入、未声明的模型角色与台账命名空间都返回错误给插件，同时写一条 `denied` Trace；插件继续运行。

台账写入即使通过了命名空间检查，每条 diff 仍然要用结算器同一套 `validateLedgerDiff` 校验，来源强制为 `settler`（I12、I16）。宿主只提供待校验 diff 的接收器，插件拿不到 `StoryStore` 或快照写的入口。

## Context API

入口模块导出 `activate(api, config)` 或默认导出同名函数：

```js
export async function activate(api, config) {
	api.slot("memory", async () => ({
		messages: [{ role: "system", content: "旅行日志：……" }],
		source: api.name,
	}));
}
```

`api` 的字段与方法：

| 成员 | 签名与返回值 |
|---|---|
| `name` | 清单里的插件名 |
| `version` | 清单里的插件版本 |
| `config` | 启动时传入的配置；没有配置时为 `null` |
| `network()` | `network(url, options)` 返回 `{ status, ok, headers, body }`；只允许 http 与 https，`options` 支持 `method`、`body`、`headers`，响应正文上限 1 MiB |
| `readFile()` | `readFile(path)` 返回 `{ content }`，按 UTF-8 读取 |
| `writeFile()` | `writeFile(path, content)` 返回 `{ written }`，需要 `read-write` 权限 |
| `model()` | `model(role, messages, options)` 返回 JSON 值；调用走内核的渠道与故障转移 |
| `writeLedger()` | `writeLedger(diffs)` 返回 `{ accepted }`；diff 含 `path`、`op`、`value`、可选 `storyTime` 与 `confidence` |
| `slot()` | `slot(name, handler)` 注册上下文槽位提供者 |
| `tool()` | `tool(definition, phases, handler)` 注册只读工具 |
| `blockType()` | `blockType(definition)` 注册块类型 |
| `mechanism()` | 声明 Director 机制会被拒绝并写 Trace |
| `onDispose()` | `onDispose(fn)` 登记卸载回调，停止时按登记顺序的逆序调用 |
| `log()` | `log(message)` 写一条日志消息；不进入 Trace |

槽位名取 `lore`、`character`、`persona`、`summary`、`state`、`situation`、`world_index`、`memory`、`history`、`scene`、`profile`、`reunion`、`scene_card`、`blueprint`、`director`、`user_will`、`protocol` 之一。处理器收到槽位请求（`slot`、`storyId`、`nodeId`、`switches`、`state`），返回 `{ messages, source, suffix? }`：`messages` 每项是 `{ role, content }`，`role` 取 `system`、`user`、`assistant`，`content` 必须是非空字符串；`source` 也必须是非空字符串。

工具定义只允许 `name`、`description`、`parameters`、`permission`、`progressLabel` 五个字段，`permission` 目前只接受 `read`，`phases` 是非空的 `fast`、`deep` 数组。处理器返回 JSON 值，执行结果进入工具结果。

块类型定义只允许 `name`、`display`、`context`、`semantics`。代码插件的 `semantics.kind` 固定为 `none`；语义处理器必须同步执行，宿主不接管异步逻辑。`display` 与 `context` 与内置块类型使用同一套校验。

Director 机制必须是同步纯函数，不能调用模型或做网络与磁盘访问（I9）。代码插件注册机制一律拒绝，原因写入 Trace；需要模型的工作放到后台任务或声明式插件里。

## 生命周期与失败处理

装载顺序：宿主校验清单与已授予权限 → 启动 worker → 动态导入入口并等待 `activate()` 完成 → 状态从 `starting` 变为 `active`。运行状态另有 `failed` 与 `disposed`。

以下情况把插件置为 `failed`，撤销它注册的全部扩展点、拒绝挂起的调用并终止 worker：

- 入口模块不存在、没有导出 `activate`，或 `activate()` 抛错；
- 激活超过 `activationTimeoutMs`（默认 10,000 毫秒）；
- worker 抛出未捕获异常或提前退出；
- 发送非法消息、未知能力或无法序列化的消息，消息超过 `maxMessageBytes`（默认 1 MiB）；
- 一次槽位或工具调用超过 `invokeTimeoutMs`（默认 10,000 毫秒）。

失败只影响当前插件：其他插件的槽位与工具继续工作，主进程不退出。失败后该插件的槽位返回 `null`，工具从注册表消失，状态原因在 `status.reason`。

Trace 保留最近 `maxTraceEntries`（默认 200）条记录，每条包含：

| 字段 | 含义 |
|---|---|
| `plugin` | 插件名 |
| `kind` | `permission`、`lifecycle`、`protocol`、`registration` |
| `action` | 具体动作，例如 `network`、`files.read`、`model`、`ledger-write`、`slot`、`activate` |
| `capability` | 权限判定时的权限类别，其他情况为 `null` |
| `target` | 被请求的主机、文件路径、模型角色、台账命名空间或扩展点名 |
| `outcome` | `allowed`、`denied`、`rejected`、`failed`、`registered`、`unregistered`、`disposed` |
| `reason` | 拒绝或失败原因；正常时为空 |
| `durationMs` | 能力调用的耗时 |
| `at` | 记录时间 |

`takeTrace()` 取走并清空当前记录，供排障报告与界面复用。

## 安装、更新与卸载

`CodePluginManager` 是安装入口，从 `@dramaticer/core` 导出。构造参数需要 `pluginsDir`、`store`（满足安装记录接口）、`engineVersion`；可选 `stagingDir`（默认插件目录下的 `.staging`）、`npmRegistry`、`registryFetch`、`pluginFetch`、`registry`、`model`、`ledger`、`onTrace`、`commandTimeoutMs`。

| 来源 | `source` | 行为 |
|---|---|---|
| npm | `{ kind: "npm", spec: "包名@版本范围" }` | 读 registry 元数据，按 `dist-tags.latest`、精确版本或 semver 范围选版本；下载 tarball，有 `dist.integrity` 时校验；以 `strip: 1` 解包 |
| git | `{ kind: "git", spec: "地址" }` | `git clone --depth 1 -- <spec> <目录>`，随后删除 `.git`；需要本机安装 git |
| zip | `{ kind: "zip", spec: "文件路径" }` | 解包并拒绝绝对路径、反斜杠与 `..`；条目逃出安装目录直接失败 |

安装流程分两步：

1. `prepare(source)` 解包到暂存目录、读清单、计算权限计划，返回 `manifest`、`plan`、`compatible` 与提示文案。首次安装列出全部权限并要求确认；升级只列新增与移除，权限没有变化时不要求确认。本机版本不满足 `engine` 时返回 `compatible: false`，暂存目录立即删除，`confirm()` 抛错。
2. `confirm(preparation, { installedAt })` 把旧目录移到暂存区备份，新目录就位后写安装记录；写记录失败时恢复旧目录。拒绝安装就是不调用它，随后调用 `cancel(preparation)` 清理暂存目录。

`checkUpdate(name)` 按安装记录的来源重新解包比较版本，`updateAvailable` 只在来源版本更高且本机兼容时为 true；结果给出结论文案与权限差异，不写记录、不改插件目录。`start(name, { config, activationTimeoutMs, invokeTimeoutMs })` 从安装记录取清单与已授予权限启动 worker；`stop(name)` 停止并撤销注册项；`runtime(name)` 与 `runtimeStatuses()` 查询运行中的插件；`uninstall(name)` 先停止，再删除插件目录与安装记录。故事级配置保存在 `story_settings.pluginOverrides.config`，安装、更新与卸载都不触碰它。

启动时用 `readInstalledManifests()` 读取插件目录里的全部清单，与安装记录核对：记录没有磁盘清单、磁盘清单没有记录、清单指纹不一致、已授予权限与清单不一致，都会抛错并指出插件名。

## 示例插件

`docs/plugins/examples/code-travel-log/` 是一个可运行的示例：

| 文件 | 作用 |
|---|---|
| `dramaticer.plugin.json` | 清单，只声明 `files` 的只读权限，范围是 `data` |
| `plugin.mjs` | 入口：注册 `memory` 槽位、`travel_log` 只读工具与 `旅行日志` 块类型 |
| `data/travel.md` | 插件读取的合成日志 |

`packages/core/test/code-plugin-examples.test.ts` 在 worker 里装载这个示例，按清单授予权限后验证三种扩展点；再用空权限启动一次，确认槽位与工具被拒绝且 Trace 记录拒绝；同时核对本文档与解析器的常量没有脱节。运行：`pnpm exec vitest run packages/core/test/code-plugin-examples.test.ts`。

## 安全边界

worker 线程提供故障隔离与能力中介，不是对抗性安全沙箱。插件仍然可以直接使用 Node 内置模块；安装时展示的权限是用户判断是否信任这段代码的依据（ADR-0092）。编写插件时应当只通过 Context API 访问外部资源，并声明所需的全部权限。
