# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 311：P3.f（P3 验收）。逐条核对 P3 总验收与 P3.a 至 P3.e 的验收标准，复核 I4、I8、I12、I13、I15、I16，结果写入 `docs/dev/reports/P3.md`。P3 覆盖的 8 个测试文件、56 个测试单独重跑通过；门禁通过（187 个测试文件、1650 个测试、5 个跳过）。P3 的全部子任务与验收完成。

## 下一步（会话 312 先做）
1. 按 TASKS 从上往下选任务：**P4 代码插件：权限清单、worker 隔离、安装与更新**（依赖 P3，已满足）。P4 的条目明显超过一个会话，先按协议在 TASKS.md 里拆成 `P4.a`、`P4.b`……，然后只做第一个。
2. P4 开始前读 DESIGN §19.3、§19.4、§19.7 与 ADR-0045、ADR-0087，并确认 I16、I18：插件不能修改楼层原文，台账写入必须经过结算器；代码插件的权限必须声明并在安装时展示，未声明的调用直接拒绝并记录。
3. M6-T99 仍等待 HUMAN-15（ComfyUI 与 API workflow JSON），不要开始。
4. HUMAN-03（抽查事件题）不阻塞任何任务。

## P3 声明式插件（代码事实）
- 模块 `packages/core/src/plugins/declarative.ts`，从 `@dramaticer/core` 根导出。
- 外壳：`format` 固定 `"dramaticer.plugin"`、`formatVersion` 固定 `1`、`name`（小写字母数字与 `.`、`_`、`-`）、`version`（`1.2.3` 或 `1.2.3-beta.1`）、`kind`、可选 `title` 与 `description`、`payload`。解析先过 `assertJsonValue`，函数、类实例、循环引用与 `undefined` 都被拒绝；未知字段一律拒绝，错误带 JSON 路径。
- 解析入口 `parseDeclarativePlugin(value, path?)`、`parseDeclarativePlugins(value, path?)`（组内重名整组拒绝）、`parseDeclarativeRequirements(value, path?)`。
- 七种 `kind`：`ledger-schema`（命名空间与字段表，字段路径相对命名空间）、`plot-beat`（id、title、text、preconditions）、`context-template`（直接是 `ContextTemplate`，`protocol` 必须是最后一段，`deepTurn` 走工具白名单）、`block-renderer`（block、display、context，没有语义处理器）、`skill`（name、description、content）、`director-config`（配置覆盖项与默认值合并后校验）、`event-pool`（事件数组，条件不允许 `switch`）。
- `ledger-schema` 字段类型：`string`（可选 `maxLength`）、`number`/`integer`（可选 `min`/`max`）、`boolean`、`enum`（非空且不重复的 `values`）、`string-array`。字段约束只描述值本身，写入仍走 `validateLedgerDiff`。
- 条件表达式：`switch`、`state`（`exists`/`equals`/`truthy`）、`all`、`any`、`not`；卡片事件与事件池禁用 `switch`。
- 文档 `docs/plugins/declarative-plugins.md`；示例在 `docs/plugins/examples/`；测试 `declarative-plugins.test.ts` 13 条、`declarative-plugin-examples.test.ts` 3 条（同时防止文档常量与解析器脱节）。

## P3 玩法包与故事级状态（代码事实）
- `packages/core/src/plugins/playpack.ts`：`parsePlaypackManifest`、`parsePlaypacks`、`stackPlaypacks`、`isPlaypackPluginEnabled`、`resolveStoryPlugins`。
- 外壳 `dramaticer.playpack`，`formatVersion` 固定 `1`；`requirements` 复用 `parseDeclarativeRequirements`；`plugins` 复用 `parseDeclarativePlugins`；`config` 是插件名到 JSON 对象的补丁表；`switches` 是插件名到布尔值的表。
- `stackPlaypacks` 按加载顺序收集插件；跨包同名插件、同名玩法包、引用未知插件的配置与开关都拒绝；配置按插件名深合并（嵌套对象递归，数组与标量整体替换）；用户覆盖最后应用；输入只读，返回全新对象。
- `resolveStoryPlugins` 在叠加后剔除显式为 `false` 的插件，`plugins` 与 `configs` 只含启用项，另给 `disabledPlugins`；`switches` 保留完整结果。
- 用户覆盖解析与 JSON 拷贝在叶子模块 `plugins/playpack-overrides.ts`；`EMPTY_PLAYPACK_USER_OVERRIDES` 是冻结的空覆盖。
- 迁移 v42：`story_settings.plugin_overrides TEXT NOT NULL DEFAULT '{}'`；`StorySettings.pluginOverrides` 与更新字段复用 `PlaypackUserOverrides`；保存与读取都走 `store/settings.ts` 的 `parseStoryPluginOverrides`；同一故事各分支共享一行设置。
- `store/settings.ts` 只依赖叶子模块 `plugins/playpack-overrides.ts`，避免把 `declarative.ts` 与机制内核的导入链带进存储层。

## P3 卡片依赖（代码事实）
- `packages/core` 增加 `semver`（运行依赖）与 `@types/semver`（开发依赖），已在 `docs/dev/DEPENDENCIES.md` 登记。
- `plugins/versions.ts`：`readVersionRange`（`validRange`）、`assertInstalledVersion`（`valid`）、`versionSatisfies`（`satisfies`，预发布按 semver 默认规则排除）。
- `plugins/card-dependencies.ts`：`checkCardDependencies({requires, recommends}, catalog)` 只返回未满足的 `issues`；每条含 `kind`、`level`、`name`、`versionRange`、`installedVersion`、`status`、`message`；`status` 取 `missing`、`version-mismatch`、`unknown-version`；`satisfied` 只看必需依赖；清单重名直接抛错。
- `extensions.dramaticer` 的合法键是 `events`、`npcAgendas`、`arcs`、`plugins`、`requires`、`recommends`；`parseDramaticerCardExtension` 在 `director/card-extension.ts`。
- `importCardContent`（`packages/st-compat/src/chat/session.ts`）的可用清单由 `BUILTIN_PLUGINS`（只有名称）、调用方 `availableDependencies` 与卡随附插件（名称与版本）合并，同名时卡随附版本优先；缺少必需依赖不中止导入。
- `ImportStoryCounts.dependencies` 在 `packages/protocol/src/story.ts`；server 导入接口返回它；`dramaticer chat --card` 逐条打印「依赖提示：…」，必需依赖未满足时追加「（必需依赖未满足）」。

## P2 插件内核（决定与代码位置）
- ADR-0087 决定采用自研 `LiteKernel`，不引入 `cordis`。
- `packages/core/src/plugins/contracts.ts`：`PluginDefinition { name, inject?, provide?, Config?, apply(ctx, config) }`；`PluginContext` 提供 `slot`、`directorMechanism`、`blockType`、`tool(definition, phases)`、`provide`、`service`、`on`、`backgroundJob`、`timeout`、`interval`、`onDispose`；`PluginKernel` 对外含槽位、机制、块类型、工具、后台任务、服务、五种事件分发与 `dispose`。
- `packages/core/src/plugins/lite-kernel.ts`：每个插件一条 `{ definition, config, state, failure, cleanups }`；依赖缺失停在 blocked、提供者出现后按装载顺序激活；同名服务在装载前拒绝；配置校验复用 `StandardSchemaV1`；`timeout`/`interval`/`backgroundJob`/`tool`/`on` 都进 `cleanups`；`installSync` 供模块级静态插件使用。
- `packages/core/src/plugins/runtime.ts`：`createPluginKernel({ plugins?, configs? })` 是启动入口；`plugins` 缺省为 `BUILTIN_PLUGINS`；启动抛错时先 `dispose()` 再原样抛出。
- `packages/core/src/plugins/builtin.ts`：`BUILTIN_PLUGINS = [...MECHANISM_PLUGINS, ...BLOCK_TYPE_PLUGINS, ...TOOL_PLUGINS, ...BACKGROUND_JOB_PLUGINS, ...SLOT_PLUGINS]`，共 51 个。
- 槽位 10 个（另有朴素档 `slot.history.raw`）在 `plugins/slots.ts`；机制 6 个在 `plugins/mechanisms.ts`；块类型 12 个在 `plugins/block-types.ts`；工具 10 个在 `plugins/tools.ts`；后台任务静态 13 个、按选项补齐 `embeddings` 与 `illustrate`，在 `plugins/background-jobs.ts`。
- 回合内钩子：`plugins/turn-hooks.ts` 的 `runTurnHook` 预算默认 5,000 毫秒；超时跳过并写 `TurnTrace.hooks`，`dramaticer explain` 列出插件、耗时与原因；槽位提供者经 `collectSlotProviders` 带上插件名，直接构造的提供者不计时。
- 测试：`plugin-fixtures.ts`、`plugin-kernel-suite.ts`、`plugins.test.ts`（11）、`plugin-runtime.test.ts`（6）、`chat-slot-plugins.test.ts`（4）、`plugin-extensions.test.ts`（7）、`plugin-background-tools.test.ts`（10）、`turn-hooks.test.ts`（7）。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 42。P3.c 的迁移是 v42（`story_settings.plugin_overrides`）；P3.a、P3.b、P3.d、P3.e、P3.f 没有迁移。
- P3 验收报告：`docs/dev/reports/P3.md`；P2 报告：`docs/dev/reports/P2.md`。
- 声明式插件还没有接进运行时装载器：P3 完成格式、解析、叠加、按故事解析与导入报告；把台账 schema、块渲染器、技能与玩法包配置注册到内核留给后续任务。
- ADR-0088 记录故事级插件状态存进 `story_settings` 的理由与影响；ADR-0089 记录版本范围用 semver 与导入报告的字段。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
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
- `store/settings.ts` 只能依赖 `plugins/playpack-overrides.ts` 这类叶子模块，避免把 `declarative.ts`、`director/evaluate.ts` 与机制内核的导入链带进存储层。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
