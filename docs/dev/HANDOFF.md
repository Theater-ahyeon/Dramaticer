# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 309：P3.d（卡片导入依赖检查与提示）。`packages/core` 新增 `semver` 运行时依赖与 `@types/semver` 开发依赖；新增 `plugins/versions.ts`（`readVersionRange`、`assertInstalledVersion`、`versionSatisfies`）与 `plugins/card-dependencies.ts`（`checkCardDependencies`，返回 `CardDependencyReport {satisfied, issues}`）；`parseDeclarativeRequirements` 的 `versionRange` 改为 semver 语法校验；`importCardContent` 合并内置插件、调用方 `availableDependencies` 与卡随附声明式插件后核对依赖，报告进入 `ImportedCardContent.dependencies`、server 的 `ImportStoryResult.imported.dependencies` 与 `dramaticer chat --card` 的日志；ADR-0089；新增 `packages/core/test/card-dependencies.test.ts` 6 条与 `packages/st-compat/test/card-dependencies.test.ts` 4 条，server 导入断言补上 `dependencies`。门禁通过（186 个测试文件、1647 个测试、5 个跳过）。

## 下一步（会话 310 先做）
1. 做 **P3.e 示例声明式插件与格式文档**（依赖 P3.a，已满足）。在 `docs/plugins/examples/` 放台账 schema、块渲染器与技能三个示例声明式插件，测试读取并走 `parseDeclarativePlugin` 校验；写格式文档（外壳字段、七种负载、卡片打包、semver 版本范围规则）。
2. P3.e 之后做 **P3.f P3 验收**（依赖 P3.b、P3.c、P3.d、P3.e）：逐条核对 P3 总验收与 I4、I8、I12、I13、I15、I16，写 `docs/dev/reports/P3.md`。
3. P3 之后按 TASKS 顺序做 P4（代码插件：权限清单、worker 隔离、安装与更新）。
4. M6-T99 仍等待 HUMAN-15（ComfyUI 与 API workflow JSON），不要开始。

## 卡片依赖检查（P3.d，代码事实）
- `plugins/versions.ts`：`readVersionRange(value, path)` 用 semver 的 `validRange` 校验，空字符串报「不能是空字符串」，非法范围报「不是合法的版本范围」；`assertInstalledVersion` 用 `valid` 校验已安装版本；`versionSatisfies` 用 `satisfies`，预发布按 semver 默认规则排除。
- `plugins/card-dependencies.ts`：`CardDependencyCatalog { plugins, playpacks }` 每项是 `{name, version?}`；`checkCardDependencies({requires, recommends}, catalog)` 只返回未满足的 `issues`，每条含 `kind`（`plugin`/`playpack`）、`level`（`required`/`recommended`）、`name`、`versionRange`、`installedVersion`、`status`、`message`；`status` 取 `missing`、`version-mismatch`、`unknown-version`。`satisfied` 只看必需依赖。已安装版本未知时带范围的依赖记为 `unknown-version`，不当作满足；没有范围的依赖只按名称判断。可用清单重名直接抛错。
- `parseDeclarativeRequirements` 的版本范围现在有语法校验，P3.a 的合法样例不受影响。
- `importCardContent`（`packages/st-compat/src/chat/session.ts`）新增 `availableDependencies?: CardDependencyCatalog`；可用清单由 `BUILTIN_PLUGINS`（只有名称）、调用方清单与 `extension.plugins`（名称与版本）合并，同名时卡随附版本优先。缺少必需依赖不中止导入，报告里逐条说明。
- `ImportStoryCounts.dependencies` 在 `packages/protocol/src/story.ts`；server 导入接口返回它；`dramaticer chat --card` 逐条打印「依赖提示：…」，必需依赖未满足时追加「（必需依赖未满足）」。

## 玩法包与故事级插件状态（P3.b、P3.c，代码事实）
- 模块 `packages/core/src/plugins/playpack.ts`，从 `@dramaticer/core` 根导出。
- 外壳 `PlaypackManifest`：`format` 固定 `"dramaticer.playpack"`，`formatVersion` 固定 `1`；`name` 与 `version` 的规则和插件相同（`readPluginName`/`readPluginVersion` 从 `declarative.ts` 导入）；可选 `title`、`description`；`requirements` 复用 `parseDeclarativeRequirements`（`plugins` 与 `playpacks`，版本范围有 semver 语法校验）；`plugins` 复用 `parseDeclarativePlugins`（包内重名整组拒绝）；`config` 是插件名到 JSON 对象的补丁表；`switches` 是插件名到布尔值的表。
- 解析入口 `parsePlaypackManifest(value, path?)`、`parsePlaypacks(value, path?)`（同名玩法包整组拒绝）；`parsePlaypackUserOverrides(value, path?)` 在叶子模块 `plugins/playpack-overrides.ts`，只接受 `config` 与 `switches`，省略或 `null` 返回 `EMPTY_PLAYPACK_USER_OVERRIDES`；未知字段一律拒绝。
- `stackPlaypacks(packs, { overrides?, knownPluginNames? })` 返回 `ResolvedPlaypack { playpacks, plugins, configs, switches }`：插件按加载顺序收集；同一插件名跨包重复直接拒绝；同一玩法包名在叠加里出现两次直接拒绝；配置按插件名做深合并（嵌套对象递归合并，数组与标量整体替换），后加载的包覆盖前面的值；开关按插件名覆盖，用户覆盖最后应用。
- 依赖规则：`requirements.playpacks` 必须是更早加载的包；`requirements.plugins` 必须由更早的包或本包提供。叠加阶段只判断存在性，不做版本匹配；版本匹配用于 P3.d 的卡片导入报告。
- 配置与开关的键必须出现在玩法包插件集合或 `knownPluginNames` 里，否则抛错并指出来源（`玩法包 <name> 的配置/开关`、`用户覆盖的配置/开关`）。运行时调用方要把内置插件名传进 `knownPluginNames`。
- `isPlaypackPluginEnabled(resolved, name)`：只有显式 `false` 才算关闭，未声明的插件按启用处理。
- `resolveStoryPlugins(packs, { overrides?, knownPluginNames? })` 返回 `ResolvedStoryPlugins extends ResolvedPlaypack` 加 `disabledPlugins`：先叠加玩法包与故事覆盖，再把开关为 `false` 的插件从 `plugins` 与 `configs` 里剔除；`switches` 保留完整解析结果。
- 输入只读：叠加不写回包文件，返回的 `configs`、`switches` 与插件数组都是新对象（测试用深冻结输入验证）。
- 测试：`packages/core/test/playpacks.test.ts`（11 条）覆盖解析与缺省值、外壳与补丁校验、同名玩法包与函数拒绝、用户覆盖解析、叠加顺序、深合并、用户覆盖优先级、包文件只读、开关默认值、跨包重名、依赖顺序与未知插件、按故事解析；`packages/core/test/story-plugins.test.ts`（2 条）覆盖故事覆盖保存与重新打开、分支切换不改变、故事隔离。

## 故事设置里的插件状态（P3.c）
- 迁移 v42：`ALTER TABLE story_settings ADD COLUMN plugin_overrides TEXT NOT NULL DEFAULT '{}'`。值是 `{config, switches}`；旧数据库升级后覆盖为空。
- `StorySettings.pluginOverrides` 与 `StorySettingsUpdate.pluginOverrides` 是 `PlaypackUserOverrides`；默认值是 `EMPTY_PLAYPACK_USER_OVERRIDES`（冻结的空覆盖）。
- `parseStoryPluginOverrides(value)` 在 `store/settings.ts`，错误路径是 `故事设置的 pluginOverrides...`；`assertStorySettingsUpdate` 与 `updateStorySettings` 都调用它，`rowToStorySettings` 读取列时也调用。
- `store/settings.ts` 只依赖叶子模块 `plugins/playpack-overrides.ts`，不把 `declarative.ts` 的导入链带进存储层。
- 分支共享由 `story_settings` 的一行一故事保证：`setHead` 只改 `stories.head_node_id`。

## 声明式插件格式（P3.a）
- 模块 `packages/core/src/plugins/declarative.ts`，从 `@dramaticer/core` 根导出。
- 外壳：`DeclarativePlugin`，字段 `format` 固定 `"dramaticer.plugin"`、`formatVersion` 固定 `1`（当前唯一版本）、`name`（小写字母数字与 `.`、`_`、`-`）、`version`（`1.2.3` 或 `1.2.3-beta.1`）、`kind`、可选 `title` 与 `description`、`payload`。解析入口 `parseDeclarativePlugin(value, path?)`、`parseDeclarativePlugins(value, path?)`（组内重名整组拒绝）。输入先过 `assertJsonValue`，函数与类实例无法通过。
- 七种 `kind` 与负载：`ledger-schema`（`namespace` 取 `LEDGER_NAMESPACES`，`fields` 每项 `path`、`type` 取 `string`/`number`/`integer`/`boolean`/`enum`/`string-array`，`enum` 必须给非空 `values`，数值可给 `min`/`max`，字符串可给 `maxLength`，路径不得重复）；`plot-beat`（`id`、`title`、`text`、`preconditions`，条件允许 `switch`）；`context-template`（直接是 `ContextTemplate`，`segments` 非空，`protocol` 仍必须最后，`deepTurn` 走现有工具白名单校验）；`block-renderer`（`block`、`display`、`context`，只允许显示与上下文策略，没有语义处理器）；`skill`（`name`、`description`、`content`）；`director-config`（`config` 为 `DirectorConfig` 的覆盖项，与 `DEFAULT_DIRECTOR_CONFIG` 合并后校验）；`event-pool`（`events` 非空，复用事件定义校验）。
- 依赖声明：`DeclarativeDependency { name, versionRange? }`、`DeclarativeRequirements { plugins, playpacks }`；`parseDeclarativeRequirements` 拒绝未知字段、重名与非法版本范围。版本范围用 semver 语法。
- 卡片打包：`DramaticerCardExtension` 新增 `plugins`（随卡附带的声明式插件）、`requires`、`recommends`（后两者都是 `DeclarativeRequirements`）。缺省为空数组。`parseDramaticerCardExtension` 的合法键现在是 `events`、`npcAgendas`、`arcs`、`plugins`、`requires`、`recommends`。
- 事件定义 `DramaticerEventDefinition` 与 `parseDramaticerEventDefinitions` 移到 `packages/core/src/director/event-definition.ts`，卡扩展与 `event-pool` 共用；`director/index.ts` 转出该模块。
- 测试：`packages/core/test/declarative-plugins.test.ts`（13 条）覆盖七种合法样例、外壳字段、函数拒绝、组内重名、各负载非法值、卡片打包与依赖声明；`card-extension.test.ts` 的空扩展断言已补三个新字段。

## P2 插件内核（决定与代码位置）
- ADR-0087 在 `docs/dev/DECISIONS.md`。采用的实现是 `LiteKernel`，不引入 `cordis`；Cordis 原型证据留在 ADR。
- `packages/core/src/plugins/contracts.ts`：`PluginDefinition { name, inject?, provide?, Config?, apply(ctx, config) }`；`PluginContext` 提供 `slot`、`directorMechanism`、`blockType`、`tool(definition, phases)`、`provide`、`service`、`on`、`backgroundJob`、`timeout`、`interval`、`onDispose`；`PluginStatus.state` 的声明值是 `active`、`loading`、`blocked`、`failed`、`disposed`，`LiteKernel` 实际只产生 `active`、`blocked`、`failed`；`PluginKernel` 对外含 `runSlot`、`slotProvider`、`slotProviderEntry`、`rewriteRequest`、`runMechanisms`、`mechanisms`、`blockType`、`blockTypes`、`tool`、`tools`、`backgroundJob(s)`、`service`、五种事件分发与 `dispose`；`SlotProviderEntry { plugin, provider }`；`KernelSnapshot` 有 `plugins`、`missingServices`、`slots`、`mechanisms`、`blockTypes`、`backgroundJobs`、`tools`、`services`。
- `packages/core/src/plugins/turn-hooks.ts`：`runTurnHook` 的预算默认 5,000 毫秒（内置记忆槽位会在回合内调用 embedding 与重排序渠道，不能设短）；实现用真实计时器与 `Promise.withResolvers`；`TurnRequestRewriter` 只有 `rewriteRequest` 一个方法。
- `packages/core/src/plugins/events.ts`：`EventRegistration { plugin, listener }`；`on(name, listener, plugin = null)`、`listeners(name)`；`waterfall` 仍是同步版本，回合请求改写走 `KernelSurface.rewriteRequest`。
- `packages/core/src/plugins/kernel-surface.ts`：`slotProviderEntry` 取注册表第一项；`rewriteRequest` 逐个钩子计时，超时跳过，`undefined`/`null` 视为不改写，其余必须返回消息数组（角色与内容校验）。
- `packages/core/src/plugins/lite-kernel.ts`：每个插件一条 `{ definition, config, state, failure, cleanups }`；`settle()` 先撤销依赖不再满足的 active 插件，再按装载顺序激活依赖满足的 pending 插件；服务值存在 `serviceValues` 表；同名服务在装载前拒绝；配置校验复用 `StandardSchemaV1`；`timeout`/`interval`/`backgroundJob`/`tool`/`on` 都进 `cleanups`，`deactivate()` 逆序执行，装载失败同样逆序回滚。`installSync` 供模块级静态插件使用。
- `packages/core/src/plugins/runtime.ts`：`createPluginKernel({ plugins?, configs? })` 是启动入口；`plugins` 缺省为 `BUILTIN_PLUGINS`；启动抛错时先 `dispose()` 再原样抛出。`load()` 把 `apply` 抛错记为插件 failed，调用方需要自己检查状态。
- `packages/core/src/plugins/builtin.ts`：`BUILTIN_PLUGINS = [...MECHANISM_PLUGINS, ...BLOCK_TYPE_PLUGINS, ...TOOL_PLUGINS, ...BACKGROUND_JOB_PLUGINS, ...SLOT_PLUGINS]`，共 51 个。没有配置时槽位插件会标为 failed 并给出原因。
- `packages/core/src/plugins/mechanisms.ts`：6 个机制插件；`DEFAULT_MECHANISM_KERNEL` 是模块级内核。
- `packages/core/src/plugins/block-types.ts`：12 个块类型插件；`DEFAULT_BLOCK_TYPES`、`DEFAULT_BLOCK_TYPE_KERNEL`、`blockTypeRegistryFromKernel`、`defaultBlockTypeRegistry` 在这里。
- `packages/core/src/plugins/tools.ts`：10 个工具插件与阶段；`DEFAULT_TOOL_KERNEL`；`defaultToolRegistry(phase)` 装载失败直接抛错，`FAST_TURN_TOOLS`/`DEEP_TURN_TOOLS` 由它派生。
- `packages/core/src/plugins/background-jobs.ts`：17 个任务插件定义、`BACKGROUND_JOB_PLUGINS`（静态 13 个）、`createBackgroundJobPlugins(options)`、`createBackgroundJobRegistryFromPlugins`；`embeddings` 与 `illustrate` 按选项补齐。
- `packages/core/src/plugins/slots.ts`：十个内置槽位插件与 `NAIVE_SLOT_PLUGINS`；插件名常量与配置接口在这里；history 的 `policy`、memory 的 `embedder`/`reranker` 原样透传给 `chat/providers.ts` 的工厂。
- `packages/core/src/plugins/chat-providers.ts`：`ChatSlotSet`、`collectSlotProviders`（给每个提供者填 `plugin`）、`composeSlotSet`、`createStandardChatSlots`、`createNaiveChatSlots`；任一插件未激活时工厂抛错并列出原因。
- `packages/core/src/plugins/registry.ts`：槽位、Director 机制、块类型、工具、后台任务类型注册表；复用 `blocks/types.ts`、`tools/registry.ts`、`background/registry.ts` 的校验；每次注册返回幂等撤销函数。
- `packages/core/src/context/slot-names.ts`：`CONTEXT_SLOT_NAMES`、`ContextSlotName`、`isContextSlotName`；`context/template.ts` 继续转出。
- 测试：`plugin-fixtures.ts`、`plugin-kernel-suite.ts`、`plugins.test.ts`（11 条）、`plugin-runtime.test.ts`（6 条）、`chat-slot-plugins.test.ts`（4 条）、`plugin-extensions.test.ts`（7 条）、`plugin-background-tools.test.ts`（10 条）、`turn-hooks.test.ts`（7 条）、`explain.test.ts` 的钩子用例。
- 依赖：`@standard-schema/spec` 在 `packages/core` 的 `dependencies`，只用于公开类型声明。

## 回合内钩子（P2.f）
- `ContextSlotProvider.plugin` 为空表示直接构造的提供者，组装时不计时、不写 Trace；生产路径经 `collectSlotProviders` 一定有插件名。
- 超时的槽位在 `ContextTraceEntry` 里是 `missing-slot`，`source` 仍是 `slot:<name>`；`AssembledContext.hooks` 里有 `outcome: "timeout"` 与原因。超时回合不写上下文包；`saveContextPack` 本身也不保存钩子耗时（复用旧包时不重放）。
- `TurnTrace.hooks` 是槽位钩子与改写钩子的拼接；没有计时钩子时字段不存在（`TurnTrace.hooks === undefined`），保证无插件路径的 Trace 与改动前一致。
- 请求改写与槽位提供者共用 `hookBudgetMs`；`GenerateAssistantTurnOptions.requestRewriter` 由 server 运行时（`StoryRuntime.requestRewriter`）与 `dramaticer chat` 传入内核，st-compat 评测入口目前没有传（没有插件注册改写钩子，行为不变）。
- `dramaticer explain` 第 3 段标题仍是「被裁剪的段落与缺失槽位」，随后多出「回合钩子（时间预算与跳过原因）」子段；`dramaticer explain --json` 的 `hooks` 字段直接给出条目。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.d。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 42。P3.c 的迁移是 v42（`story_settings.plugin_overrides`）；P3.a、P3.b、P3.d 没有迁移。
- 依赖登记：`@standard-schema/spec`、`semver` 已登记为 `packages/core` 依赖；`@types/semver` 是开发依赖；当前没有第三方插件框架。
- ADR-0088 记录故事级插件状态存进 `story_settings` 的理由与影响；ADR-0089 记录版本范围用 semver 与导入报告的字段。
- P2 验收数字与复现命令在 `docs/dev/reports/P2.md`：51 个内置插件；R2 记分牌、遗忘报告、B1 报告复跑一致。
- `eval-private/memory-cache/r1-retrieval.db` 有三个故事：`仙侠雌竞：什么叫我是炉鼎体质？` 290 个助手楼层已抽取 282 个、414 条事件；`欲望世界-1600` 180 个助手楼层已抽取 174 个、292 条事件；`银麒赎世` 114 个助手楼层已抽取 112 个、248 条事件。评测自己的临时数据库重新抽取后事件覆盖为 282/290、172/180、112/114，事件数 371/247/248。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 深回合评测命令与产物
- 完整批量：
  `pnpm --filter @dramaticer/st-compat deep-eval --db .devloop/scratch/R3b-T99/deep.db --story benchmark-mist-harbor --turns 30 --branches 10 --out eval-private/reports/R3b-deep.jsonl --summary eval-private/reports/R3b-deep.json --resume`
- 只重算统计（零模型调用）：
  `pnpm --filter @dramaticer/st-compat deep-eval --db .devloop/scratch/R3b-T99/deep.db --out eval-private/reports/R3b-deep.jsonl --summary eval-private/reports/R3b-deep.json --summary-only`
- 相对路径都按仓库根目录解析。默认模型 `main-fallback`、模拟用户 `background`、裁判按 `roles.judge`。
- 运行数据库 `.devloop/scratch/R3b-T99/deep.db` 里 30 次运行共 120 条事件（`model.request`、`model.response`、`draft.replace`、`draft.commit` 各 30 条），每次请求暴露 12 个工具、传输为 `native`；模型一次也没有调用工具，提交方式全部是 `auto`。

## 深回合实现位置（代码事实）
- 回合入口 `packages/core/src/chat/turn.ts`：`runChatTurn` 先 `resolveTurnMode`，再追加用户楼层、组装上下文、按模式调用 `runDeepTurn` 或 `runModelTurns`。`generateAssistantTurn` 用 `applyTemplateDeepTurn` 覆盖模板里的 `deepTurn`；`selectDeepTurnTools` 按白名单过滤 `DEEP_TURN_TOOLS` 并排除关闭的手记工具。深回合新建 `TurnDraftController`、`TurnNoteController` 与 `TurnGuidanceController`；`withDirectorNotes` 在组装后的消息之后追加一条系统消息（没有手记时不加）。正文解析在 `resolveTurnBody`：显式提交用草稿；正常结束但没有提交时把最后一次输出整份替换为草稿并自动提交，记 `drift: "missing_commit"`；中止、超时、工具次数上限或没有正文且没有提交时返回 null，运行标为 `failed` 并抛 `DeepTurnWithoutCommitError`。
- 上下文组装 `packages/core/src/context/assembler.ts`：模板片段并行解析，槽位提供者带 `plugin` 时逐个计时；`AssembledContext.hooks` 只在有计时钩子时出现。
- 上下文包 `packages/core/src/context/pack.ts`：保存时只写 messages、segments、trace 与 references，不写钩子耗时。
- 追加要求 `packages/core/src/chat/guidance.ts`：`MAX_TURN_GUIDANCE_ENTRIES = 5`、`MAX_TURN_GUIDANCE_LENGTH = 2_000`、`TURN_GUIDANCE_PREFIX`；执行器每次请求前成对省略旧工具往返，再 `guidance.drain()` 并逐条追加为用户消息。
- 草稿 `packages/core/src/chat/draft.ts`：`TurnDraftSnapshot { text, version }`；替换时版本加一；`commit(method)` 只允许一次。运行日志的 `draft.replace` 只记版本号与正文长度，`draft.commit` 记版本号、长度与方式。
- 运行日志 `packages/core/src/run-log.ts`：状态 `running`、`completed`、`interrupted`、`failed`、`aborted`；事件 `model.request`、`model.response`、`tool.call`、`tool.result`、`draft.replace`、`draft.commit`、`steering`、`limit`、`error`。事件表只追加，序号按运行内最大值加一；`TurnTrace.run` 记录 `runId`、状态与事件条数，快回合为 null。
- 上下文卫生 `packages/core/src/chat/context-window.ts`：把助手工具调用加紧随其后的工具结果识别为一个工具步，按累计估算 token 从最早一步整步省略，保留最近 `deepRecentToolSteps` 步；省略量写 `TurnTrace.deep.contextOmitted`。
- 手记 `packages/core/src/director/notes.ts`：`set`/`delete` diff 沿当前路径累加；`note_read`/`note_write`；手记不进台账，不参与结算。
- 验收评测 `packages/st-compat/src/evalset/deep-eval.ts`：`runDeepEval`、`summarizeDeepEval`、`parseDeepEvalJsonl`、`serializeDeepEvalRecord`、`selectBranchRounds`；CLI 在 `deep-eval-cli.ts`。失败轮次把 head 恢复到生成前；分支盲评用 `judgePairwise({ task: "historical" })` 两次，两次结论不同记 `inconsistent`；统计按轮次去重，重试后的成功覆盖同一轮。

## server 与 web（R3b-T10）
- server SSE `packages/server/src/turns.ts`：`turn.started`（带 `runId`，快回合 null）、`text.delta`、`blocks.replace`（100 毫秒节流）、`thinking.delta`、`tool.call`、`turn.progress`、`draft.replace`（100 毫秒节流）、`turn.steering`、`turn.committed`、`turn.error`、`turn.completed`。`TurnRunRegistry` 在 `onTurnStarted` 注册、流 `finally` 注销。`turnOptions` 把 `runtime.requestRewriter` 传给生成入口。
- server 运行时 `packages/server/src/runtime.ts`：`StoryRuntime` 有 `requestRewriter`，来自 `createStandardChatSlots` 的内核。
- server 接口 `packages/server/src/routes.ts`：`GET /api/nodes/:id/run` 返回 `NodeRunView`（`nodeId`、`run`、按 `seq` 升序的 `events`），没有运行 404；`POST /api/nodes/:id/retry` 只接受用户楼层，请求体 `{ mode? }`，以该用户楼层为父节点生成新的助手楼层，不追加用户楼层；`POST /api/stories/:id/turns/:runId/steering` 返回 202 `{ runId }`，未知或跨故事 404、已结束 409、文本非法 400、队列满 409。
- `packages/web/src/chat/stream-state.ts`：`TurnDraft` 含 `runId`、`progress`、`liveDraft`、`guidance`、`committed`；`applyDraftSnapshot` 忽略不高于当前版本的快照；`describeProgress` 输出阶段文字；`turn.committed` 用提交块替换 `blocks` 并清空阶段文字。`resolveRetryAction` 依次给出 `regenerate`、`retry`、`resend`、`blocked`。
- `packages/web/src/chat/run-timeline.ts` 按 `seq` 排序事件并生成标签；`StreamingBubble`、`Composer`、`FloorRunTimeline` 只做渲染。e2e 假渠道消息里含“深回合草稿”时返回 `draft_write` 与 `commit_draft`，每次响应延迟 1.2 秒。

## 记忆与检索（R1 续）
- 父子分块：父段上限 1200 码点；小块 400 字符窗口、80 字符重叠。`StoryStore.open(path, { chunkStrategy })` 取 `parent-child`（默认）或 `fixed`。
- 重排序：`reranker` 段在 `channels.yaml`，`enabled` 当前 false；`OpenAiRerankClient` 默认把文档截断到 4,000 码点。融合权重默认 BM25 2、向量 1、实体 0.5、事件 0.5、最近块 1。
- 八段式压缩：表 `chapter_compressions`；`DEFAULT_COMPRESSION_TOKEN_LIMIT = 2_000`，散文摘要默认 800；完整八段实测 1,146/1,210/1,491 token。
- 世界书预筛：表 `lore_prefilter`；后台任务只处理当前 head 路径最新助手楼层。
- 上下文包：表 `context_packs(node_id PRIMARY KEY, story_id, payload, created_at)`；指纹覆盖模板（含 `deepTurn`）、预算、档位、导演强度与各槽位 `packKey`。

## 后台任务与队列
- server 回合路径在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain。
- `requeueRunningBackgroundJobs`、`requeueRunningNodeImages` 与 `markInterruptedTurnRuns` 在 `startServer` 与 `dramaticer work` 启动时调用。
- 后台任务分 `gap` 与 `deferred`；`deferred` 只在会话结束或间隙达到 `gapPlanSeconds` 时执行；`candidate_actions` 与 `lore_prefilter` 是 `gap` 档；连续失败 3 次才放弃。
- `drainBackgroundJobs` 按 `created_at ASC, id ASC` 取 pending，先丢弃不在当前 head 路径上的楼层任务。
- 任务注册表由 `createDefaultBackgroundJobRegistry` 从插件收集；`illustrate` 需要生图选项，`embeddings` 需要 embedder，两者未提供时不注册。

## 导演与界面
- 导演实时选择是纯程序，零模型调用（I9）。
- 聊天页虚拟窗口 `PAGE_SIZE` 60、分页阈值 240px、自动贴底 96px、overscan 600px；候选行动、开场候选与楼层图片轮询 2 秒、上限 15 次。
- 生图：`data/images.yaml`、`image_workflows`、`character_visual_profiles`、`node_images`；`server --images` 与 `--media-dir`；图片只读 `done` 行；`illustrate` 是权限 `side_effect` 的深回合工具。
- 已注册槽位：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol；默认顺序 character、lore、state、summary、memory、scene、director、user_will、history、（可选 `block_format`）、protocol，`protocol` 必须最后。

## 可重复命令与评测产物
- 门禁：`pnpm check`。
- 插件内核、槽位、扩展、任务、工具、声明式格式、玩法包、故事级插件与卡片依赖测试：`pnpm exec vitest run packages/core/test/plugins.test.ts packages/core/test/plugin-runtime.test.ts packages/core/test/chat-slot-plugins.test.ts packages/core/test/plugin-extensions.test.ts packages/core/test/plugin-background-tools.test.ts packages/core/test/turn-hooks.test.ts packages/core/test/declarative-plugins.test.ts packages/core/test/playpacks.test.ts packages/core/test/story-plugins.test.ts packages/core/test/story-settings.test.ts packages/core/test/card-extension.test.ts packages/core/test/card-dependencies.test.ts packages/st-compat/test/card-dependencies.test.ts`（98 个测试）。
- 单个 e2e：`cd packages/web && pnpm exec playwright test --project=desktop --grep "深回合"`；e2e 假渠道固定端口 4517，数据库 `.devloop/scratch/e2e/work/e2e.db`。
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`，只读、零模型调用；第 9 段显示运行状态与按 `seq` 排序的事件，第 3 段之后显示回合钩子。
- R1 事件回填与检索评测：
  - `pnpm --filter @dramaticer/st-compat events-backfill --resume --db eval-private/memory-cache/r1-retrieval.db`
  - `pnpm --filter @dramaticer/st-compat memory-eval --events --rerank --db eval-private/memory-cache/tmp/r1-memory-eval.db --private-report eval-private/reports/R1-retrieval.md --public-report docs/dev/reports/R1-retrieval.md --title "R1 记忆引擎检索评测"`
- 记分牌重新生成：`node packages/st-compat/dist/evalset/scoreboard-cli.js --playtest eval-private/reports/forgetting/playtest --playtest eval-private/reports/forgetting/legacy/playtest --forgetting eval-private/reports/forgetting/runs --forgetting eval-private/reports/forgetting/legacy/runs --b1-samples eval-private/reports/R2-b1/samples.jsonl --b1-records eval-private/reports/R2-b1/records.jsonl --b1-quality eval-private/reports/R2-b1/quality.jsonl --out docs/dev/SCOREBOARD.md`
- 遗忘报告复跑：`pnpm --filter @dramaticer/st-compat forgetting-report --input <仓库根>/eval-private/reports/forgetting/all-runs --private-out <目标>/R2-forgetting.private.md --public-out <目标>/R2-forgetting.public.md`；输入路径必须写绝对路径（命令行不按仓库根解析）。
- 自动试玩：CLI 入口 `pnpm --filter @dramaticer/st-compat playtest`；界面自动试玩 `pnpm playtest`；live 默认 `PLAYTEST_RESUME=1`，续跑文件 `eval-private/reports/r5-playtest.progress.json`。
- R5 最终数据：60 成功 / 0 失败；相邻块 Jaccard 均值 0.0019、P90 0.0031（599 对）；首字 P50 5,176、P95 10,150 毫秒；生成 P50 10,094、P95 16,905 毫秒；每轮 total token 8,971.8；导演决策 60、有建议 60；错误 0；私有标识反向扫描通过（804 个标识）。不要再启动第二个监督进程或 server。
- R3 快回合：20/20 成功，首字 P50 1,448 / P90 3,435 毫秒，生成 P50 2,666 / P90 4,988 毫秒，截断 0/20。
- R3b 深回合：30/30 成功，首字 P50 2,566 / P90 3,584 毫秒，总时长 P50 3,261 / P90 4,208 毫秒，工具调用 0，漂移 30/30，分支盲评 deep 4 / fast 3 / tie 0 / inconsistent 3。
- 引用评测数字：B1 必须说明同模型子集为空、每个对话每档只有 1 个样本；遗忘矛盾率必须同时说明失败题数与可判定样本数；选择一致率当前没有样本。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- 真实渠道实跑用 `--model main-fallback --judge-model judge`（`rp` 仍 503）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 槽位集合工厂是异步的（`createStandardChatSlots`、`createNaiveChatSlots`），返回 `{ kernel, providers }`；组装与回合只消费 `providers`，请求改写消费 `kernel`。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- `store/settings.ts` 只能依赖 `plugins/playpack-overrides.ts` 这类叶子模块，避免把 `declarative.ts`、`director/evaluate.ts` 与机制内核的导入链带进存储层。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
