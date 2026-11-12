# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 297：P1.b（自研精简版原型）。同一包 `packages/plugin-spike` 内新增 `KernelSurface`（两个内核共用的扩展点注册表、槽位取用、机制执行与五种事件分发）与 `LiteKernel`：只做注册表、`inject`/`provide` 依赖解析、装载失败回滚、卸载回收、热重载与五种分发，不 import `cordis`；依赖缺失停在 pending，提供者出现后按装载顺序自动激活，提供者卸载或依赖消失时回退 pending 并撤销全部注册；配置校验复用 StandardSchema。`PluginKernel` 接口进入 `contracts.ts`，11 条断言抽成 `test/kernel-suite.ts`，`cordis-kernel.test.ts` 与 `lite-kernel.test.ts` 各跑同一份套件（22 个测试）。门禁通过（177 个测试文件、1587 个测试、5 个跳过）。

## 下一步（会话 298 先做）
1. 做 **P1.c 比较与 ADR**：测量两个原型的包体积（框架及传递依赖的安装体积）与启动耗时（新建内核并装载同一组插件，重复若干次取中位数），并记录类型检查、热重载、依赖解析与循环检测、许可证与打包方式。
2. 写 ADR 决定采用哪一种，登记依赖清单；删除 `packages/plugin-spike`，把可复现命令与数字留在 ADR。删除前两个原型各跑一次门禁通过。
3. 之后 P2 依赖 P1 与 R5-T99；C 线依赖 P2。H-T00 的依赖已满足但仍排在 P/C 之后，不要提前开始。
4. M6-T99 仍等待 HUMAN-15（ComfyUI 与 API workflow JSON），不要开始。
5. 后续顺序：P1 → P2 → C 兼容插件 → H → X → R6 → M6b → P3/P4 → M5 → P5 → M7。

## P1 两个原型（代码事实）
- `packages/plugin-spike/src/contracts.ts`：插件作者看到的类型。`PluginDefinition { name, inject?, provide?, Config?, apply(ctx, config) }`；`PluginContext` 提供 `slot`、`directorMechanism`、`blockType`、`provide`、`service`、`on`、`onDispose`；`PluginStatus` 状态为 `active`、`loading`、`blocked`、`failed`、`disposed`；`PluginKernel` 是两个内核共同的对外接口（装载、卸载、重载、状态、快照、槽位、机制、块类型、服务、五种分发）。
- `packages/plugin-spike/src/kernel-surface.ts`：`KernelSurface` 抽象类，持有 `ExtensionRegistry` 与 `EventBus`，实现 `runSlot`、`runMechanisms`、`blockType`、`on`/`emit`/`parallel`/`serial`/`bail`/`waterfall`；`service` 抽象。
- `packages/plugin-spike/src/cordis-kernel.ts`：`CordisKernel extends KernelSurface`。装载前检查 `provide` 与 `ctx.get` 重名；`settle()` 等待全部 fiber；PENDING 时用 `missingServices` 与 `findCycle` 生成原因；注册走 `ctx.effect`；插件 apply 抛错时按倒序执行已注册清理。
- `packages/plugin-spike/src/lite-kernel.ts`：`LiteKernel extends KernelSurface`。每个插件一条 `{ definition, config, state, failure, cleanups }`；`settle()` 先撤销依赖不再满足的 active 插件，再按装载顺序激活依赖满足的 pending 插件；配置校验与 apply 在一次 activate 里完成，失败时倒序执行清理、标 failed、写原因；服务值存在内核的 `serviceValues` 表，提供时写入、清理时删除；重名、缺失与循环分析由内核自己算，消息与 Cordis 适配层一致。
- `packages/plugin-spike/src/registry.ts`：槽位、Director 机制、块类型注册表；块类型复用 `@dramaticer/core/blocks` 的 `createBlockTypeRegistry` 校验。
- `packages/plugin-spike/src/events.ts`：五种分发模式的 EventBus（`emit` 通知、`parallel` 按注册顺序收集、`serial` 依次收集、`bail` 首个非空、`waterfall` 依次改写同一个值）。
- `packages/plugin-spike/src/fixtures.ts`：两个共享 fixture 组——weather 服务（带 StandardSchema 配置）+ scene 槽位 + Director 机制 + `weather` 块类型；两个互相依赖的循环插件。
- `packages/plugin-spike/test/kernel-suite.ts`：`describeKernel(label, createKernel)`，11 条断言；两个 test 文件各调用一次。

## Cordis 4.0.0-rc.13 原型事实（P1.c 直接可用）
- 包名 `cordis`，MIT，解包 77,075 字节；运行时依赖 `cosmokit` 与 `@standard-schema/spec`，pnpm 一共新增 3 个包。`@deepseek-ai/cordis`（4.1.0）是 DSH 的分支，P1 只验证上游 `cordis`。
- `new Context()` 是根；`ctx.use(component, config)` 返回 `Fiber`（thenable），组件形状 `{ name, inject, provide, Config, apply }`。`fiber.await()` 等待装载；配置校验失败时抛 `ValidationError`（`invalid config`）。
- 依赖缺失与循环依赖都只让 fiber 停在 PENDING，`await()` 正常返回、没有错误；原因必须由适配层分析。同名服务不会被 Cordis 拒绝：两个插件都会 apply，`ctx.get(name)` 返回先注册的值；适配层必须在装载前检查 `provide` 声明与 `ctx.get`。
- 分发语义与 DESIGN §19.2 不同：`emit` 同步通知无返回值；`parallel` 并行等待全部监听器、不收集结果、失败时抛 `AggregateError`；`serial` 依次执行但只返回第一个非 null/false/undefined 的结果；`bail` 与 `serial` 相同但不等待；`waterfall` 是中间件。两个内核因此都用自己的 EventBus。
- `ctx.effect(() => dispose)` 返回幂等 disposer，随 fiber 卸载执行；`ctx.provide(name, value)` 返回 disposer；`fiber.dispose()` 卸载。`FiberState` 运行时导出：PENDING 0、LOADING 1、ACTIVE 2、FAILED 3、DISPOSED 4、UNLOADING 5。
- 类型体验：事件名是 `interface Events` 的静态声明合并，动态扩展点事件名没有类型；适配层的 `Component` 与 `Config` 需要一次类型断言。插件作者看到的契约全部在 `packages/plugin-spike/src/contracts.ts`，没有 import cordis。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 41。P1.b 没有迁移。
- 新增依赖：`cordis`（`packages/plugin-spike`，runtime）、`@standard-schema/spec`（`packages/plugin-spike`，dev）；已登记 `docs/dev/DEPENDENCIES.md`。
- `eval-private/memory-cache/r1-retrieval.db` 有三个故事：`仙侠雌竞：什么叫我是炉鼎体质？` 290 个助手楼层已抽取 282 个、414 条事件；`欲望世界-1600` 180 个助手楼层已抽取 174 个、292 条事件；`银麒赎世` 114 个助手楼层已抽取 112 个、248 条事件。评测自己的临时数据库重新抽取后事件覆盖为 282/290、172/180、112/114，事件数 371/247/248。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086。
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
- 回合入口 `packages/core/src/chat/turn.ts`：`runChatTurn` 先 `resolveTurnMode`，再追加用户楼层、组装上下文、按模式调用 `runDeepTurn` 或 `runModelTurns`。`generateAssistantTurn` 用 `applyTemplateDeepTurn` 覆盖模板里的 `deepTurn`；`selectDeepTurnTools` 按白名单过滤注册表工具并排除关闭的手记工具。深回合新建 `TurnDraftController`、`TurnNoteController` 与 `TurnGuidanceController`；`withDirectorNotes` 在组装后的消息之后追加一条系统消息（没有手记时不加）。正文解析在 `resolveTurnBody`：显式提交用草稿；正常结束但没有提交时把最后一次输出整份替换为草稿并自动提交，记 `drift: "missing_commit"`；中止、超时、工具次数上限或没有正文且没有提交时返回 null，运行标为 `failed` 并抛 `DeepTurnWithoutCommitError`。
- 追加要求 `packages/core/src/chat/guidance.ts`：`MAX_TURN_GUIDANCE_ENTRIES = 5`、`MAX_TURN_GUIDANCE_LENGTH = 2_000`、`TURN_GUIDANCE_PREFIX`；执行器每次请求前成对省略旧工具往返，再 `guidance.drain()` 并逐条追加为用户消息。
- 草稿 `packages/core/src/chat/draft.ts`：`TurnDraftSnapshot { text, version }`；替换时版本加一；`commit(method)` 只允许一次。运行日志的 `draft.replace` 只记版本号与正文长度，`draft.commit` 记版本号、长度与方式。
- 运行日志 `packages/core/src/run-log.ts`：状态 `running`、`completed`、`interrupted`、`failed`、`aborted`；事件 `model.request`、`model.response`、`tool.call`、`tool.result`、`draft.replace`、`draft.commit`、`steering`、`limit`、`error`。事件表只追加，序号按运行内最大值加一；`TurnTrace.run` 记录 `runId`、状态与事件条数，快回合为 null。
- 上下文卫生 `packages/core/src/chat/context-window.ts`：把助手工具调用加紧随其后的工具结果识别为一个工具步，按累计估算 token 从最早一步整步省略，保留最近 `deepRecentToolSteps` 步；省略量写 `TurnTrace.deep.contextOmitted`。
- 手记 `packages/core/src/director/notes.ts`：`set`/`delete` diff 沿当前路径累加；`note_read`/`note_write`；手记不进台账，不参与结算。
- 验收评测 `packages/st-compat/src/evalset/deep-eval.ts`：`runDeepEval`、`summarizeDeepEval`、`parseDeepEvalJsonl`、`serializeDeepEvalRecord`、`selectBranchRounds`；CLI 在 `deep-eval-cli.ts`。失败轮次把 head 恢复到生成前；分支盲评用 `judgePairwise({ task: "historical" })` 两次，两次结论不同记 `inconsistent`；统计按轮次去重，重试后的成功覆盖同一轮。

## server 与 web（R3b-T10）
- server SSE `packages/server/src/turns.ts`：`turn.started`（带 `runId`，快回合 null）、`text.delta`、`blocks.replace`（100 毫秒节流）、`thinking.delta`、`tool.call`、`turn.progress`、`draft.replace`（100 毫秒节流）、`turn.steering`、`turn.committed`、`turn.error`、`turn.completed`。`TurnRunRegistry` 在 `onTurnStarted` 注册、流 `finally` 注销。
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

## 导演与界面
- 导演实时选择是纯程序，零模型调用（I9）。
- 聊天页虚拟窗口 `PAGE_SIZE` 60、分页阈值 240px、自动贴底 96px、overscan 600px；候选行动、开场候选与楼层图片轮询 2 秒、上限 15 次。
- 生图：`data/images.yaml`、`image_workflows`、`character_visual_profiles`、`node_images`；`server --images` 与 `--media-dir`；图片只读 `done` 行；`illustrate` 是权限 `side_effect` 的深回合工具。
- 已注册槽位：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol；默认顺序 character、lore、state、summary、memory、scene、director、user_will、history、（可选 `block_format`）、protocol，`protocol` 必须最后。

## 可重复命令与评测产物
- 门禁：`pnpm check`。
- 插件内核原型：`pnpm --filter @dramaticer/plugin-spike run build`；测试 `cd packages/plugin-spike && pnpm exec vitest run test`（Cordis 与自研各 11 条）。
- 单个 e2e：`cd packages/web && pnpm exec playwright test --project=desktop --grep "深回合"`；e2e 假渠道固定端口 4517，数据库 `.devloop/scratch/e2e/work/e2e.db`。
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`，只读、零模型调用；第 9 段显示运行状态与按 `seq` 排序的事件。
- R1 事件回填与检索评测：
  - `pnpm --filter @dramaticer/st-compat events-backfill --resume --db eval-private/memory-cache/r1-retrieval.db`
  - `pnpm --filter @dramaticer/st-compat memory-eval --events --rerank --db eval-private/memory-cache/tmp/r1-memory-eval.db --private-report eval-private/reports/R1-retrieval.md --public-report docs/dev/reports/R1-retrieval.md --title "R1 记忆引擎检索评测"`
- 记分牌重新生成：`node packages/st-compat/dist/evalset/scoreboard-cli.js --playtest eval-private/reports/forgetting/playtest --playtest eval-private/reports/forgetting/legacy/playtest --forgetting eval-private/reports/forgetting/runs --forgetting eval-private/reports/forgetting/legacy/runs --b1-samples eval-private/reports/R2-b1/samples.jsonl --b1-records eval-private/reports/R2-b1/records.jsonl --b1-quality eval-private/reports/R2-b1/quality.jsonl --out docs/dev/SCOREBOARD.md`
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
- `packages/st-compat`、`packages/server` 与 `packages/plugin-spike` 测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
