# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 313：P4.b（安装确认与安装记录）。迁移 v43 新增全局 `plugin_installations`；新增 `packages/core/src/plugins/installation.ts`（安装计划、确认写入、启动核对、来源校验）；`StoryStore` 新增安装记录读写；新增 9 条测试；ADR-0091；门禁通过（189 个测试文件、1671 个测试、5 个跳过）。

## 下一步（会话 314 先做）
1. 按 TASKS 从上往下选任务：**P4.c worker 隔离与未声明调用拒绝**（依赖 P4.b，已满足）。
2. P4.c 要点：代码插件在 worker 线程里运行，主线程只通过消息端口交付清单允许的能力；网络、文件、模型与台账写入四类调用先查安装记录里已授予的权限，未声明直接拒绝并写入 Trace；worker 崩溃、超时或非法消息时终止该插件并记为失败，主进程与其他插件继续；台账写入仍然只能提交为待校验 diff，经过结算器（I12、I16）。
3. P4.c 的权限判定以 P4.b 的安装记录为准：`store.getCodePluginInstallation(name)` 读回 `grantedPermissions`，不要只看清单。
4. 后续：P4.d 三种来源安装与卸载、P4.e 开发文档与示例、P4.f 验收。M6-T99 仍等待 HUMAN-15，不要开始。

## P4.b 安装记录（代码事实）
- 模块 `packages/core/src/plugins/installation.ts`，经 `plugins/index.ts` 从 `@dramaticer/core` 根导出。
- 来源：`CodePluginInstallSource { kind: "npm" | "git" | "zip"; spec: string }`，`assertCodePluginInstallSource` 拒绝未知字段、非法类型与首尾空白。
- 记录：`CodePluginInstallationRecord { name, version, manifest, grantedPermissions, source, installedAt }`；`CodePluginInstallationStore` 声明 `getCodePluginInstallation`、`saveCodePluginInstallation`、`listCodePluginInstallations`，`StoryStore` 直接满足这个形状。
- `planCodePluginInstallation(store, manifest, source)`：首次安装 `previousVersion` 为 null、`added` 是全部权限、`requiresConfirmation` 恒 true；已有记录时用 `diffCodePluginPermissions(已授予, 新声明)`，权限没有变化（数组顺序不影响）时不要求确认。
- `confirmCodePluginInstallation(store, plan, { installedAt? })`：重算计划并比较 `previousVersion`、`added`、`removed`，不一致抛「安装计划已过期：<插件名>」；写入的 `grantedPermissions` 等于清单声明的权限；拒绝安装就是不调用它。
- `assertInstalledCodePluginsMatch(store, manifests)`：记录没有磁盘清单、磁盘清单没有记录、清单指纹不一致、已授予权限与清单权限不一致，都抛错并指出插件名。指纹覆盖全部字段，`inject`/`provide` 与权限数组按比较键排序。
- 存储：迁移 v43 `plugin_installations(name PRIMARY KEY, version, manifest, granted_permissions, source_kind CHECK(npm/git/zip), source_spec, installed_at) STRICT`；`saveCodePluginInstallation` 安装与升级覆盖同一行，校验名称与版本和清单一致、已授予权限与清单权限一致；读回复用 `parseCodePluginManifest` 与 `parseCodePluginPermissions`。
- `code-plugins.ts` 新增导出 `codePluginPermissionKey(permission)` 与 `parseCodePluginPermissions(value, path?)`。
- 测试 `packages/core/test/code-plugin-installations.test.ts` 9 条：首次安装、确认写入与重开读回、升级差异、权限无变化、拒绝、计划过期、启动核对、存储层校验、来源校验。

## P4.a 代码插件清单（代码事实）
- 模块 `packages/core/src/plugins/code-plugins.ts`。外壳：`format` 固定 `"dramaticer.code-plugin"`、`formatVersion` 固定 `1`、`tier` 固定 `"code"`、`name` 与 `version` 复用声明式插件的校验、`engine` 是 semver 范围、`entry` 是插件目录内的相对 js 模块、可选 `title`/`description`/`configSchema`、`inject`/`provide`、`permissions`。未知字段拒绝，函数与类实例在 `assertJsonValue` 处拒绝。
- 权限：`network`（`hosts`，允许 `*.example.com` 与端口）、`files`（`access` 取 `read`/`read-write`，`paths` 是插件目录内相对路径）、`model`（`writer`/`settler`/`planner`/`judge`）、`ledger-write`（九个台账命名空间）；同类权限只能出现一次。
- 纯函数：`parseCodePluginManifest`、`parseCodePluginManifests`、`describeCodePluginPermissions`、`diffCodePluginPermissions`、`isEngineCompatible`；权限差异按“权限条目及其范围”比较。
- 测试 `packages/core/test/code-plugins.test.ts` 12 条。

## P3 声明式插件（代码事实）
- 模块 `packages/core/src/plugins/declarative.ts`，根导出。外壳 `dramaticer.plugin`、`formatVersion` 1、七种 `kind`；未知字段与函数拒绝，错误带 JSON 路径。
- `parseDeclarativePlugin`、`parseDeclarativePlugins`、`parseDeclarativeRequirements`；`readPluginName` 与 `readPluginVersion` 导出复用。
- `plugins/playpack.ts`：`parsePlaypackManifest`、`parsePlaypacks`、`stackPlaypacks`、`isPlaypackPluginEnabled`、`resolveStoryPlugins`；用户覆盖在叶子模块 `plugins/playpack-overrides.ts`。
- 迁移 v42：`story_settings.plugin_overrides`；`StorySettings.pluginOverrides` 复用 `PlaypackUserOverrides`。
- 卡片依赖：`plugins/versions.ts`（`readVersionRange`、`assertInstalledVersion`、`versionSatisfies`）与 `plugins/card-dependencies.ts`（`checkCardDependencies`）；`semver` 是 core 运行依赖，已在 `docs/dev/DEPENDENCIES.md` 登记。
- 文档 `docs/plugins/declarative-plugins.md`，示例在 `docs/plugins/examples/`，测试 `declarative-plugins.test.ts`（13）、`declarative-plugin-examples.test.ts`（3）。

## P2 插件内核（代码事实）
- ADR-0087 决定采用自研 `LiteKernel`，不引入 `cordis`。
- `plugins/contracts.ts`：`PluginDefinition { name, inject?, provide?, Config?, apply(ctx, config) }`；`PluginContext` 提供 `slot`、`directorMechanism`、`blockType`、`tool(definition, phases)`、`provide`、`service`、`on`、`backgroundJob`、`timeout`、`interval`、`onDispose`。
- `plugins/lite-kernel.ts` 与 `plugins/runtime.ts`；`plugins/builtin.ts` 的 `BUILTIN_PLUGINS` 共 51 个。
- 槽位 10 个（另有朴素档 `slot.history.raw`）、机制 6 个、块类型 12 个、工具 10 个、后台任务静态 13 个。
- 回合内钩子：`plugins/turn-hooks.ts` 的 `runTurnHook` 预算默认 5,000 毫秒；超时跳过并写 `TurnTrace.hooks`。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a、P4.b。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- P3 验收报告：`docs/dev/reports/P3.md`；P2 报告：`docs/dev/reports/P2.md`。
- 声明式插件还没有接进运行时装载器：P3 完成格式、解析、叠加、按故事解析与导入报告；把台账 schema、块渲染器、技能与玩法包配置注册到内核留给后续任务。
- ADR-0088 记录故事级插件状态存进 `story_settings`；ADR-0089 记录版本范围用 semver 与导入报告字段；ADR-0090 记录代码插件清单与权限形状；ADR-0091 记录安装确认与安装记录。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- P4.b 目标测试：`pnpm exec vitest run packages/core/test/code-plugin-installations.test.ts`（9 个测试）。
- P4.a 目标测试：`pnpm exec vitest run packages/core/test/code-plugins.test.ts`（12 个测试）。
- P3 目标测试：`pnpm exec vitest run packages/core/test/declarative-plugins.test.ts packages/core/test/declarative-plugin-examples.test.ts packages/core/test/playpacks.test.ts packages/core/test/story-plugins.test.ts packages/core/test/story-settings.test.ts packages/core/test/card-extension.test.ts packages/core/test/card-dependencies.test.ts packages/st-compat/test/card-dependencies.test.ts`（56 个测试）。
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
