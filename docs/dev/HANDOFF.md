# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 314：P4.c（worker 隔离与未声明调用拒绝）。新增 `packages/core/src/plugins/code-plugin-worker.ts`（每插件一个 worker、四类能力中介、Trace、崩溃/超时/非法消息处理、槽位与只读工具代理）；`DeepToolDefinition` 增加可选 `execute`；ADR-0092；新增 10 条测试；门禁通过。

## 下一步（会话 315 先做）
1. 按 TASKS 从上往下选任务：**P4.d 从 npm、git、zip 安装与更新，卸载回收副作用**（依赖 P4.c，已满足）。
2. P4.d 要点：三种来源（npm 包名与版本、git 地址、zip 文件）安装到插件目录；读取清单并复用 P4.b 的 `planCodePluginInstallation` / `confirmCodePluginInstallation`；更新检查与版本兼容提示；卸载时回收 `CodePluginRuntime` 的 worker 与注册项，并删除插件目录文件与安装记录。
3. 安装后的启动核对继续用 `assertInstalledCodePluginsMatch`；运行时权限从安装记录读，不要只看清单。
4. 后续：P4.e 开发文档与示例代码插件、P4.f 验收。M6-T99 仍等待 HUMAN-15，不要开始。

## P4.c worker 隔离（代码事实）
- 模块 `packages/core/src/plugins/code-plugin-worker.ts`，经 `plugins/index.ts` 从 `@dramaticer/core` 根导出。
- `startCodePluginRuntime(options)` 返回 `CodePluginRuntime`；激活失败、崩溃或超时不会抛错，状态为 `failed`，原因在 `status.reason`。构造参数非法、已授予权限不在清单里才同步抛错。
- 选项：`pluginDir`、`manifest`、`grantedPermissions`（安装记录里的值，必须是清单权限子集）、`config`、`registry`（`ExtensionRegistry`，插件注册项进入这里）、`fetch`（默认全局 fetch）、`model`（声明 model 权限时需要）、`ledger`（声明 ledger-write 权限时需要，只接收已校验的 `LedgerDiffInput[]`）、`onTrace`；上限：`activationTimeoutMs` 10 秒、`invokeTimeoutMs` 10 秒、`maxMessageBytes` 1 MiB、`maxTraceEntries` 200。
- 插件入口导出 `activate(api, config)` 或默认导出同名函数。`api`：`name`、`version`、`config`、`network(url, options)`、`readFile(path)`、`writeFile(path, content)`、`model(role, messages, options)`、`writeLedger(diffs)`、`slot(name, handler)`、`tool(definition, phases, handler)`、`blockType(definition)`、`mechanism(name)`、`onDispose(fn)`、`log(message)`。
- 能力判定：网络按主机与可选端口（`*.example.com` 匹配子域，不匹配裸域）；文件按插件目录内相对路径的目录前缀，写只允许 `read-write`，读写都用 `realpath` 确认不逃出插件目录；模型按角色；台账按命名空间。未声明调用返回错误给插件，写一条 `denied` Trace，插件继续运行。
- 台账写入：每条 diff 强制 `source: "settler"`，逐条 `validateLedgerDiff`；全部通过后交给 `CodePluginLedgerSink`。运行时没有 `StoryStore` 参数，无法绕过结算器（I12、I16）。
- 失败处理：非法帧、未知能力、消息超限、激活或调用超时、worker `error`、提前退出都置为 `failed`，撤销全部注册项、拒绝挂起调用并终止 worker；其他插件不受影响。失败后槽位返回 null，工具从注册表消失。
- 扩展点：槽位与只读工具（`permission: "read"`）通过消息代理执行；块类型只允许纯数据且 `semantics.kind = "none"`；Director 机制拒绝注册（I9 要求同步纯函数，机制上下文含 `StoryStore`），拒绝原因写 Trace。
- `DeepToolDefinition` 新增可选 `execute(args)`；执行器在 `permission: "read"` 且存在 `execute` 时直接调用并 JSON 化返回值，内置工具没有这个字段，行为不变。
- Trace 类型 `CodePluginTraceEntry`：`plugin`、`kind`（permission/lifecycle/protocol/registration）、`action`、`capability`、`target`、`outcome`（allowed/denied/rejected/failed/registered/unregistered/disposed）、`reason`、`durationMs`、`at`。`takeTrace()` 取走并清空，供后续接到排障报告。
- worker 线程是故障隔离与能力中介，不是对抗性沙箱；插件仍可直接使用 Node 内置模块。信任依据是安装时展示的权限（见 DESIGN §19.7 与 ADR-0092）。

## P4.b 安装记录（代码事实）
- 模块 `packages/core/src/plugins/installation.ts`，经 `plugins/index.ts` 从 `@dramaticer/core` 根导出。
- 来源：`CodePluginInstallSource { kind: "npm" | "git" | "zip"; spec: string }`，`assertCodePluginInstallSource` 拒绝未知字段、非法类型与首尾空白。
- 记录：`CodePluginInstallationRecord { name, version, manifest, grantedPermissions, source, installedAt }`；`CodePluginInstallationStore` 声明 `getCodePluginInstallation`、`saveCodePluginInstallation`、`listCodePluginInstallations`，`StoryStore` 直接满足这个形状。
- `planCodePluginInstallation(store, manifest, source)`：首次安装 `previousVersion` 为 null、`added` 是全部权限、`requiresConfirmation` 恒 true；已有记录时用 `diffCodePluginPermissions(已授予, 新声明)`，权限没有变化（数组顺序不影响）时不要求确认。
- `confirmCodePluginInstallation(store, plan, { installedAt? })`：重算计划并比较 `previousVersion`、`added`、`removed`，不一致抛「安装计划已过期：<插件名>」；写入的 `grantedPermissions` 等于清单声明的权限；拒绝安装就是不调用它。
- `assertInstalledCodePluginsMatch(store, manifests)`：记录没有磁盘清单、磁盘清单没有记录、清单指纹不一致、已授予权限与清单权限不一致，都抛错并指出插件名。指纹覆盖全部字段，`inject`/`provide` 与权限数组按比较键排序。
- 存储：迁移 v43 `plugin_installations(name PRIMARY KEY, version, manifest, granted_permissions, source_kind CHECK(npm/git/zip), source_spec, installed_at) STRICT`；安装与升级覆盖同一行。
- 测试 `packages/core/test/code-plugin-installations.test.ts` 9 条。

## P4.a 代码插件清单（代码事实）
- 模块 `packages/core/src/plugins/code-plugins.ts`。外壳：`format` 固定 `"dramaticer.code-plugin"`、`formatVersion` 固定 `1`、`tier` 固定 `"code"`、`name` 与 `version` 复用声明式插件的校验、`engine` 是 semver 范围、`entry` 是插件目录内的相对 js 模块、可选 `title`/`description`/`configSchema`、`inject`/`provide`、`permissions`。未知字段拒绝。
- 权限：`network`（`hosts`）、`files`（`access` 与 `paths`）、`model`（四个角色）、`ledger-write`（九个命名空间）；同类权限只能出现一次。
- 纯函数：`parseCodePluginManifest`、`parseCodePluginManifests`、`describeCodePluginPermissions`、`diffCodePluginPermissions`、`isEngineCompatible`、`parseCodePluginPermissions`、`assertCodePluginRelativePath`、`codePluginPermissionKey`。
- 测试 `packages/core/test/code-plugins.test.ts` 12 条。

## P3 声明式插件（代码事实）
- 模块 `packages/core/src/plugins/declarative.ts`，根导出。外壳 `dramaticer.plugin`、`formatVersion` 1、七种 `kind`；未知字段与函数拒绝，错误带 JSON 路径。
- `parseDeclarativePlugin`、`parseDeclarativePlugins`、`parseDeclarativeRequirements`；`readPluginName` 与 `readPluginVersion` 导出复用。
- `plugins/playpack.ts`：`parsePlaypackManifest`、`parsePlaypacks`、`stackPlaypacks`、`isPlaypackPluginEnabled`、`resolveStoryPlugins`；用户覆盖在叶子模块 `plugins/playpack-overrides.ts`。
- 迁移 v42：`story_settings.plugin_overrides`；`StorySettings.pluginOverrides` 复用 `PlaypackUserOverrides`。
- 卡片依赖：`plugins/versions.ts` 与 `plugins/card-dependencies.ts`；`semver` 是 core 运行依赖，已在 `docs/dev/DEPENDENCIES.md` 登记。
- 文档 `docs/plugins/declarative-plugins.md`，示例在 `docs/plugins/examples/`，测试 `declarative-plugins.test.ts`（13）、`declarative-plugin-examples.test.ts`（3）。

## P2 插件内核（代码事实）
- ADR-0087 决定采用自研 `LiteKernel`，不引入 `cordis`。
- `plugins/contracts.ts`：`PluginDefinition { name, inject?, provide?, Config?, apply(ctx, config) }`；`PluginContext` 提供 `slot`、`directorMechanism`、`blockType`、`tool(definition, phases)`、`provide`、`service`、`on`、`backgroundJob`、`timeout`、`interval`、`onDispose`。
- `plugins/lite-kernel.ts` 与 `plugins/runtime.ts`；`plugins/builtin.ts` 的 `BUILTIN_PLUGINS` 共 51 个。
- 槽位 10 个（另有朴素档 `slot.history.raw`）、机制 6 个、块类型 12 个、工具 10 个、后台任务静态 13 个。
- 回合内钩子：`plugins/turn-hooks.ts` 的 `runTurnHook` 预算默认 5,000 毫秒；超时跳过并写 `TurnTrace.hooks`。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a、P4.b、P4.c。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- P3 验收报告：`docs/dev/reports/P3.md`；P2 报告：`docs/dev/reports/P2.md`。
- 声明式插件还没有接进运行时装载器：P3 完成格式、解析、叠加、按故事解析与导入报告；把台账 schema、块渲染器、技能与玩法包配置注册到内核留给后续任务。
- 代码插件还没有接到启动流程与安装命令：P4.c 提供 worker 运行时与能力中介，P4.d 负责安装、更新与卸载。
- ADR-0088 记录故事级插件状态存进 `story_settings`；ADR-0089 记录版本范围用 semver 与导入报告字段；ADR-0090 记录代码插件清单与权限形状；ADR-0091 记录安装确认与安装记录；ADR-0092 记录 worker 隔离、能力判定与信任边界。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- P4.c 目标测试：`pnpm exec vitest run packages/core/test/code-plugin-worker.test.ts`（10 个测试）。
- P4.b 目标测试：`pnpm exec vitest run packages/core/test/code-plugin-installations.test.ts`（9 个测试）。
- P4.a 目标测试：`pnpm exec vitest run packages/core/test/code-plugins.test.ts`（12 个测试）。
- 插件内核与扩展测试：`pnpm exec vitest run packages/core/test/plugins.test.ts packages/core/test/plugin-runtime.test.ts packages/core/test/chat-slot-plugins.test.ts packages/core/test/plugin-extensions.test.ts packages/core/test/plugin-background-tools.test.ts packages/core/test/turn-hooks.test.ts`。
- 不变量检查：`node scripts/check-invariants.mjs`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
