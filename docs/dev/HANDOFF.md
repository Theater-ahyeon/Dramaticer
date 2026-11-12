# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 312：P4.a（代码插件清单与权限声明）。新增 `packages/core/src/plugins/code-plugins.ts`，定稿 `dramaticer.code-plugin` 外壳、四类带范围的权限、安装展示文案、权限差异与引擎兼容判断；新增 12 条测试；ADR-0090；门禁通过（188 个测试文件、1662 个测试、5 个跳过）。P4 已按协议拆成 P4.a 至 P4.f，P4.a 完成。

## 下一步（会话 313 先做）
1. 按 TASKS 从上往下选任务：**P4.b 安装确认与安装记录**（依赖 P4.a，已满足）。
2. P4.b 要点：迁移新增全局 `plugin_installations` 表（清单原文、已授予权限、来源、时间）；首次安装列出全部权限，升级只列出 `diffCodePluginPermissions` 的差异，确认后才写记录，拒绝则不留记录；权限无变化不重复确认；记录与磁盘清单不一致时抛出并指出插件名。
3. 表结构参考既有迁移的写法（`packages/core/src/store/migrations.ts`，当前 schema 版本 42，P4.b 用 v43）；全局表不需要同故事触发器。
4. M6-T99 仍等待 HUMAN-15（ComfyUI 与 API workflow JSON），不要开始。HUMAN-03（抽查事件题）不阻塞任何任务。

## P4.a 代码插件清单（代码事实）
- 模块 `packages/core/src/plugins/code-plugins.ts`，经 `plugins/index.ts` 从 `@dramaticer/core` 根导出。
- 外壳：`format` 固定 `"dramaticer.code-plugin"`、`formatVersion` 固定 `1`、`tier` 固定 `"code"`、`name` 与 `version` 复用声明式插件的校验（小写名称、三段式版本）、`engine` 是 semver 范围、`entry` 是插件目录内的相对 js 模块、可选 `title`/`description`/`configSchema`（普通 JSON 对象）、`inject`/`provide`（服务名数组）、`permissions`。未知字段拒绝，函数与类实例在 `assertJsonValue` 处拒绝。
- 权限：`network`（`hosts` 小写主机，允许 `*.example.com` 与端口）、`files`（`access` 取 `read`/`read-write`，`paths` 是插件目录内相对路径，可用 `"."`）、`model`（`writer`/`settler`/`planner`/`judge`）、`ledger-write`（九个台账命名空间）；同类权限只能出现一次，`undefined` 表示无权限。
- 纯函数：`parseCodePluginManifest`、`parseCodePluginManifests`（组内重名整组拒绝）、`describeCodePluginPermissions`（返回 `{kind, summary}`）、`diffCodePluginPermissions`（返回 `added`/`removed`/`requiresConfirmation`，权限数组顺序不影响结果）、`isEngineCompatible(range, version)`（版本由调用方传入）。
- 权限差异按"权限条目及其范围"比较：范围变化表现为旧条目进入 `removed`、新条目进入 `added`。
- 测试 `packages/core/test/code-plugins.test.ts` 12 条。

## P3 声明式插件（代码事实）
- 模块 `packages/core/src/plugins/declarative.ts`，从 `@dramaticer/core` 根导出。外壳 `dramaticer.plugin`、`formatVersion` 1、七种 `kind`（`ledger-schema`、`plot-beat`、`context-template`、`block-renderer`、`skill`、`director-config`、`event-pool`）；未知字段与函数拒绝，错误带 JSON 路径。
- `parseDeclarativePlugin`、`parseDeclarativePlugins`、`parseDeclarativeRequirements`；`readPluginName` 与 `readPluginVersion` 是导出的复用校验。
- `plugins/playpack.ts`：`parsePlaypackManifest`、`parsePlaypacks`、`stackPlaypacks`、`isPlaypackPluginEnabled`、`resolveStoryPlugins`；用户覆盖解析在叶子模块 `plugins/playpack-overrides.ts`。
- 迁移 v42：`story_settings.plugin_overrides`；`StorySettings.pluginOverrides` 复用 `PlaypackUserOverrides`；`store/settings.ts` 只依赖 `plugins/playpack-overrides.ts`，不把 `declarative.ts` 的导入链带进存储层。
- 卡片依赖：`plugins/versions.ts`（`readVersionRange`、`assertInstalledVersion`、`versionSatisfies`）与 `plugins/card-dependencies.ts`（`checkCardDependencies`）；`semver` 是 core 的运行依赖，已在 `docs/dev/DEPENDENCIES.md` 登记。
- 文档 `docs/plugins/declarative-plugins.md`，示例在 `docs/plugins/examples/`，测试 `declarative-plugins.test.ts`（13）、`declarative-plugin-examples.test.ts`（3）。

## P2 插件内核（代码事实）
- ADR-0087 决定采用自研 `LiteKernel`，不引入 `cordis`。
- `plugins/contracts.ts`：`PluginDefinition { name, inject?, provide?, Config?, apply(ctx, config) }`；`PluginContext` 提供 `slot`、`directorMechanism`、`blockType`、`tool(definition, phases)`、`provide`、`service`、`on`、`backgroundJob`、`timeout`、`interval`、`onDispose`；`PluginKernel` 对外含槽位、机制、块类型、工具、后台任务、服务、五种事件分发与 `dispose`。
- `plugins/lite-kernel.ts` 与 `plugins/runtime.ts`（`createPluginKernel`）；`plugins/builtin.ts` 的 `BUILTIN_PLUGINS` 共 51 个。
- 槽位 10 个（另有朴素档 `slot.history.raw`）、机制 6 个、块类型 12 个、工具 10 个、后台任务静态 13 个，分别在 `plugins/slots.ts`、`mechanisms.ts`、`block-types.ts`、`tools.ts`、`background-jobs.ts`。
- 回合内钩子：`plugins/turn-hooks.ts` 的 `runTurnHook` 预算默认 5,000 毫秒；超时跳过并写 `TurnTrace.hooks`，`dramaticer explain` 列出插件、耗时与原因。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 42。P4.b 会新增 v43。
- P3 验收报告：`docs/dev/reports/P3.md`；P2 报告：`docs/dev/reports/P2.md`。
- 声明式插件还没有接进运行时装载器：P3 完成格式、解析、叠加、按故事解析与导入报告；把台账 schema、块渲染器、技能与玩法包配置注册到内核留给后续任务。
- ADR-0088 记录故事级插件状态存进 `story_settings` 的理由与影响；ADR-0089 记录版本范围用 semver 与导入报告的字段；ADR-0090 记录代码插件清单与权限形状。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
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
