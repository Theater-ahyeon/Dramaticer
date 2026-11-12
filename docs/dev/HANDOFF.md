# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 291：R3b-T09（运行中追加要求）。core 新增 `chat/guidance.ts`：`TurnGuidanceController` 按运行保存待处理指引，`pushGuidance` 去空白后校验 1–2,000 字、待处理上限 5 条，运行结束后拒绝；`TurnRunHandle` 与 `TurnStartedInfo` 由 `onTurnStarted` 在第一次模型请求前交给调用方。执行器每次请求前整批取走指引，按 `【玩家在运行中追加的指引】\n<文本>` 作为一条用户消息追加；省略旧工具往返之后再追加，不会被省略。`turn.ts` 接受指引时写 `steering` 运行事件（只记 `textLength`），在失败、未提交与成功提交三条结束路径上关闭控制器。server 新增 `TurnRunRegistry` 句柄表：`turn.started` 改由 `onTurnStarted` 发出并带 `runId`（快回合为 null），流结束时清理；`POST /api/stories/:id/turns/:runId/steering` 返回 202，未知或跨故事 404，已结束 409，空文本或超长 400 并指出 `text`，队列满 409；SSE 发 `turn.steering` 回显。协议新增 `turn.steering` 与 `TurnStartedPayload.runId`。新增 core 测试 2 个与 server 测试 1 个；门禁通过（172 个测试文件、1547 个测试、5 个 live 跳过）。

## 下一步（会话 292 先做）
1. 做 R3b-T10.a（界面：模式开关与进度事件）。
2. T10.a 之后做 T10.b（草稿、追加要求与运行时间线），再 T99。
3. M6-T99 仍等待 HUMAN-15（ComfyUI 与 API workflow JSON），不要开始。
4. R3b 完成后再做 P1/P2 → C 兼容插件 → H → X → R6 → M6b → P3/P4 → M5 → P5 → M7。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T09。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 41。R3b-T09 没有迁移：`steering` 事件使用已有的 `turn_run_events`。
- `eval-private/memory-cache/r1-retrieval.db` 有三个故事：`仙侠雌竞：什么叫我是炉鼎体质？` 290 个助手楼层已抽取 282 个、414 条事件；`欲望世界-1600` 180 个助手楼层已抽取 174 个、292 条事件；`银麒赎世` 114 个助手楼层已抽取 112 个、248 条事件。评测自己的临时数据库重新抽取后事件覆盖为 282/290、172/180、112/114，事件数 371/247/248。
- M6-T99 标 `[!]`，等待 HUMAN-15：真实 ComfyUI 启动在 `http://127.0.0.1:8188` 并提供 API 格式 workflow JSON 到 `eval-private/comfyui/`；2026-11-09 探测时端口仍未监听。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## R3b 任务拆分（2026-11-12）
- T01 深回合循环与上限（已完成）：`runDeepTurn` 复用 `runModelTurns`；工具调用总数默认 40、时长默认 600 秒；迁移 v39 的四个故事设置；`TurnTrace.deep`；快回合为 null。
- T02 工具集、权限与进度事件（已完成）：注册表声明权限与进度文字；`history_read`、`ledger_read`、`ledger_write`；`ledger_write` 只收集，提交时统一写（I12）；未启用的侧效应工具与未知工具都返回错误结果并记录；进度事件按阶段去重，server 发 `turn.progress`；工具调用上限覆盖 propose 与 side_effect。
- T03 运行日志（已完成）：迁移 v40；`turn_runs` 与只追加的 `turn_run_events`；深回合每步同步写事件，快回合不写；启动时把遗留 `running` 标为 `interrupted`；`TurnTrace.run`、`GET /api/nodes/:id/run`、`dramaticer explain` 读同一时间线。
- T04 草稿与提交（已完成）：`draft_write` 整份替换运行内草稿，`commit_draft` 提交为助手楼层并结束运行；草稿提交前不写楼层、不进历史、不参与台账；`draft.replace` SSE 按 100 毫秒节流；提交后发 `turn.committed`；正常结束但没有提交时把最后一次输出自动提交并记 `missing_commit` 漂移；中止、超时、工具次数上限或没有正文时运行标为 `aborted` 或 `failed`，不产生楼层，head 停在用户楼层。
- T05 导演手记（已完成）：迁移 v41；每楼存 `set`/`delete` diff，沿当前路径累加，后写覆盖；`note_read` 与 `note_write`；深回合开始时在组装后的消息之后注入一条系统消息，快回合不注入；手记不进台账。
- T06 上下文卫生（已完成）：每次请求前对工具往返累计估算 token，超过 `deepContextTokenLimit`（默认 48,000）时从最早一步开始成对省略，保留最近 `deepRecentToolSteps`（默认 4）步；`TurnTrace.deep.contextOmitted` 只在有省略时写入；快回合不套用。
- T07 模板配置（已完成）：`ContextTemplate.deepTurn` 见下文；模板覆盖故事设置，故事设置覆盖默认值；白名单外调用按未知工具拒绝并记录；模板保存、导入与 `assertContextTemplate` 走同一校验；指纹包含模板内容。规划—批评—执行仍按 DESIGN §18 暂缓。
- T08 原生元数据（已完成）：`LlmResult.native` 与 `LlmToolCall.native` 保存签名类字段；pi 通道提取并回放，缺失签名时不产生空对象；执行器在深回合工具循环里逐轮保留；缓存键与缓存结果都包含 `native`；Gemini fixture 断言第二轮请求的 `thoughtSignature` 逐字节一致。
- T09 运行中追加要求（已完成）：`chat/guidance.ts` 的 `TurnGuidanceController` 与 `TurnRunHandle`；`onTurnStarted` 带 `runId` 与句柄；执行器每次请求前整批追加为用户消息；`steering` 运行事件只记长度；server 句柄表与 steering 接口；`turn.steering` 回显；不写楼层；结束状态分别映射 404/409/400。
- T10.a 界面：模式选择列出快/深、设置页深回合区段与模板字段（`ContextTemplate.deepTurn` 同形）、`turn.progress` 阶段文字；`turn.started` 已带 `runId`。
- T10.b 界面：草稿区、追加要求输入（调用 steering 接口并回显）、楼层运行时间线。web 的流式状态已经有 `liveDraft` 与 `committed` 字段可用；`turn.steering` 目前在 `stream-state.ts` 里被忽略，T10.b 落界面状态。
- T99 验收：30 次真实深回合（失败率目标 ≤10%）、漂移率、时长对照 TauriTavern P50 66 秒/P90 147 秒、10 个分支点的快/深盲评增益；统计版写 `docs/dev/reports/R3b.md`。

## 深回合实现起点（代码事实）
- 回合入口 `packages/core/src/chat/turn.ts`：`runChatTurn` 先 `resolveTurnMode`，再追加用户楼层、组装上下文、按模式调用 `runDeepTurn` 或 `runModelTurns`。`generateAssistantTurn` 里 `applyTemplateDeepTurn` 用 `options.template.deepTurn` 覆盖 `resolveTurnMode` 的结果；`selectDeepTurnTools` 按白名单过滤注册表工具并排除关闭的手记工具，白名单外调用落到执行器的未知工具拒绝。深回合新建 `TurnDraftController`、`TurnNoteController` 与 `TurnGuidanceController`；`withDirectorNotes` 在组装后的消息之后追加一条系统消息（没有手记时不加）；`onTurnStarted` 在这里同步交给调用方。正文解析在 `resolveTurnBody`：显式提交用草稿；正常结束但没有提交时把最后一次输出整份替换为草稿并自动提交，记 `drift: "missing_commit"`；中止、超时、工具次数上限或没有正文且没有提交时返回 null，运行标为 `failed` 并抛 `DeepTurnWithoutCommitError`（中止抛 `TurnAbortedError`，运行标为 `aborted`）。
- 追加要求 `packages/core/src/chat/guidance.ts`：常量 `MAX_TURN_GUIDANCE_ENTRIES = 5`、`MAX_TURN_GUIDANCE_LENGTH = 2_000`、`TURN_GUIDANCE_PREFIX`；`TurnGuidanceError.reason` 取 `closed`、`empty`、`too_long`、`queue_full`；`TurnGuidanceController.push` 同步校验并回调 `onAccepted`，`drain` 整批取走，`close` 清空并拒绝后续追加；`formatGuidanceMessage` 生成注入正文。`turn.ts` 在三条结束路径（异常、未提交、提交事务）关闭控制器。
- 模板与校验 `packages/core/src/context/template.ts`：`ContextTemplate` 含 `id`、`segments`、可选 `deepTurn`；`assertContextTemplate` 校验片段 id、priority、静态文本、槽位、条件、`protocol` 必须在最后，并调用 `assertContextTemplateDeepTurn`。`deepTurn.tools` 只接受 `DEEP_TURN_TOOLS` 里的工具名；`maxToolCalls` 与 `maxDurationMs` 复用 `chat/mode.ts` 的范围校验；`notesEnabled` 必须是布尔值，为 false 时不允许点名 `note_read` 或 `note_write`。模板保存与导入都经过 `store` 的 `assertStoredContextTemplate`。
- 工具注册表 `packages/core/src/tools/registry.ts`、`read-tools.ts`、`write-tools.ts`、`draft-tools.ts`、`note-tools.ts`、`index.ts`：权限与进度文字声明、两个注册表、十个内置工具；`NOTE_READ_TOOL_NAME` 与 `NOTE_WRITE_TOOL_NAME` 是模板校验与工具过滤共用的常量。`ledger_write` 的收集结果进入 `ModelTurnResult.proposedStateUpdates`，`note_write` 的收集结果留在 `TurnNoteController`，两者都在楼层事务里写入。深回合工具顺序为 memory_search、lore_lookup、state_get、ledger_read、history_read、note_read、ledger_write、note_write、draft_write、commit_draft。
- 原生元数据 `packages/core/src/llm/types.ts` 与 `pi-channel.ts`：`LlmAssistantNative.content` 是渠道内容片段数组；`providerResultFromMessage` 把文本签名、思考签名、工具调用的 `thoughtSignature`、`namespace`、`argumentsError` 提取到 `LlmResult.native` 与 `LlmToolCall.native`，没有任何签名类字段时不设置 `native`。`buildPiContext` 在助手消息带 `native.content` 时逐块回放，只保留当前消息 `toolCalls` 里仍然存在的工具调用（按 id），缺失的调用按 `LlmToolCall.native` 拼装；没有 `native` 时按正文与工具调用拼装。`chat/executor.ts` 在原生传输下把 `result.native` 与每个调用的 `native` 写进下一条助手消息，文本协议不使用这些字段。`llm/cache.ts` 的请求键与读回都包含 `native`。
- 导演手记 `packages/core/src/director/notes.ts`：`set`/`delete` 校验、`applyDirectorNoteDiffs` 累加、`formatDirectorNotes` 注入文本；存储层 `saveDirectorNotes`、`getDirectorNotes`、`readDirectorNoteEntries`。手记是模型的工作材料，不写 `state_diffs`，不参与结算。
- 草稿 `packages/core/src/chat/draft.ts`：`TurnDraftSnapshot { text, version }`；替换时版本加一，空正文与提交后的替换抛错；`commit(method)` 只允许一次，方式取 `tool` 或 `auto`。运行日志的 `draft.replace` 只记版本号与正文长度，`draft.commit` 记版本号、长度与方式。
- 手记控制器 `packages/core/src/chat/notes.ts`：`TurnNoteController.pending` 是本次运行的待提交 diff；`apply` 逐条校验并在累计超过 50 条时整批拒绝。
- 上下文卫生 `packages/core/src/chat/context-window.ts`：`DeepContextWindow { tokenLimit, recentToolSteps, estimator? }`；`pruneToolRoundTrips` 把助手工具调用消息加紧随其后的工具结果识别为一个工具步（没有工具结果的助手消息不算），按“正文 + 工具名 + 参数 JSON”估算每条消息 token，累计超过上限时从最早一步整步删除，直到降到上限以下或只剩 `recentToolSteps` 步；`addContextOmission` 把多次请求前的省略累计成 `{pairs, messages, tokens, reason: "context_limit"}`。
- 执行器 `packages/core/src/chat/executor.ts`：按注册表权限执行工具；`maxToolCalls` 计只读、propose、control 与 side_effect 的执行次数；`side_effect` 不强制下一轮，只登记；停用工具返回工具错误；未知工具记入 `rejected`（两种传输）；`maxDurationMs` 每次请求前检查；每次请求前先成对省略较早的工具往返，再 `guidance.drain()` 并把每条追加成用户消息；进度阶段去重后回调 `onToolProgress`；`TurnAbortedError` 带 `toolCallCount`。`control` 工具需要 `draft` 控制器；`propose` 里 `ledger_write` 进待提交集合、`note_write` 进手记控制器；提交后同一轮后续工具不再产生副作用，循环立即收束并把草稿正文作为最终结果。原生传输下 `RoundToolCall` 保留 `native`，进入下一条助手消息与 `ModelTurnResult.toolCalls`。
- 运行日志 `packages/core/src/run-log.ts`：`TurnRunRecord`、`TurnRunEvent`、`TurnRunEventInput`、`TurnRunDetail`，状态五种、事件九种（`model.request`、`model.response`、`tool.call`、`tool.result`、`draft.replace`、`draft.commit`、`steering`、`limit`、`error`）。存储层事件序号由单条 `INSERT ... SELECT COALESCE(MAX(seq),0)+1` 分配；事件表触发器拒绝更新与删除；只能在 `running` 状态追加；`markInterruptedTurnRuns` 返回改动行数。`turn_runs.node_id` 在提交/中止保存楼层时写入，没有楼层时为空；唯一索引保证一个助手楼层最多一条运行。
- Trace `packages/core/src/trace.ts`：`TurnTrace.deep`（`TurnTraceDeep`，含 `stopReason`、`commit`、`drift`，以及可选的 `contextOmitted`）、`TurnTrace.run`、`DeepTurnStopReason`、`TurnTraceToolCall.permission`；快回合 `deep` 与 `run` 都为 null；旧 Trace 读回时缺失的 `run` 补 null。
- server SSE `packages/server/src/turns.ts`：`turn.started`（由 `onTurnStarted` 发出，带 `runId`，快回合为 null）、`text.delta`、`blocks.replace`（100 毫秒节流）、`thinking.delta`、`tool.call`、`turn.progress`、`draft.replace`（100 毫秒节流）、`turn.steering`、`turn.committed`、`turn.error`、`turn.completed`；`turn.committed` 只带提交时的楼层 id、最终块与方式 `tool` 或 `auto`；`DeepTurnWithoutCommitError` 映射为 `internal` 错误并保留原因。`handleTurnStream` 在 `turn.completed` 后触发后台调度。`TurnRunRegistry` 在 `onTurnStarted` 注册、流 `finally` 注销。协议事件名与载荷在 `packages/protocol/src/turn.ts`。
- server 只读接口 `packages/server/src/routes.ts`：`GET /api/nodes/:id/run` 返回 `NodeRunView`（`nodeId`、`run`、按 `seq` 升序的 `events`），楼层不存在或没有运行都 404。`POST /api/stories/:storyId/turns/:runId/steering` 先查故事与运行归属（404），再查运行状态与句柄（409），然后校验请求体字段 `text`，交给句柄追加；成功返回 202 `{ runId }`，队列满返回 409，文本非法返回 400 并带 `details.path = "text"`。
- web `packages/web/src/chat/stream-state.ts` 处理 `turn.started`、`blocks.replace`、`tool.call`、`turn.progress`、`draft.replace`（写 `liveDraft`）、`turn.steering`（暂不落状态）与 `turn.committed`（写 `committed`）；聊天页每轮完成后重新取最近 60 楼。界面仍只展示快回合（R3b-T10.a 才放开）。

## 记忆与检索（R1 续）
- 父子分块：父段上限 1200 码点，按换行合并；单段超过上限时整楼退化成一个父段。小块 400 字符窗口、80 字符重叠。`StoryStore.open(path, { chunkStrategy })` 取 `parent-child`（默认）或 `fixed`。
- 重排序：`reranker` 段在 `channels.yaml`，`enabled` 当前 false；`OpenAiRerankClient` 默认把文档截断到 4,000 码点。融合权重默认 BM25 2、向量 1、实体 0.5、事件 0.5、最近块 1。
- 八段式压缩：表 `chapter_compressions`，固定八个键；槽位注入主线压缩与最近一条章节；`DEFAULT_COMPRESSION_TOKEN_LIMIT = 2_000`，散文摘要默认 800；完整八段实测 1,146/1,210/1,491 token。
- 世界书预筛：表 `lore_prefilter(node_id PRIMARY KEY, story_id, entry_ids, created_at)`；后台任务 `lore_prefilter` 只处理当前 head 路径最新助手楼层；槽位有记录时只注入常驻条目与记录选中的非恒常条目。
- 上下文包：表 `context_packs(node_id PRIMARY KEY, story_id, payload, created_at)`；指纹覆盖模板（含 `deepTurn`）、预算、档位、导演强度与各槽位 `packKey`；引用失效时重新组装；玩家编辑产生新楼层，不继承旧包。
- R1 验收数字与口径见 `docs/dev/reports/R1.md` 第十二节与 ADR-0086。

## 后台任务与队列
- server 回合路径在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain。
- `requeueRunningBackgroundJobs(storyId?)` 与 `requeueRunningNodeImages(storyId?)` 在 `startServer` 与 `dramaticer work` 启动时各调用一次；同一处调用 `markInterruptedTurnRuns()`。
- 后台任务分 `gap` 与 `deferred` 两档；`deferred` 只在会话结束或间隙达到 `gapPlanSeconds` 时执行；`gap_pass` 默认关闭；`candidate_actions` 与 `lore_prefilter` 是 `gap` 档；连续失败 3 次才放弃。
- `drainBackgroundJobs` 每轮按 `created_at ASC, id ASC` 取 pending，先丢弃不在当前 head 路径上的楼层任务；日志格式 `后台任务 <storyId>：新增 N 条，执行 N 条（失败 N，丢弃 N）`。
- 迁移 v35 会把全部 `embeddings` 任务退回 `pending`，旧库第一次 drain 会按新块补齐向量。

## 导演与界面
- 导演计划、拍状态、候选行动与开局候选的既有语义见 TASKS 与 HANDOFF 历史记录；导演实时选择是纯程序，零模型调用（I9）。
- 聊天页虚拟窗口 `PAGE_SIZE` 60、分页阈值 240px、自动贴底 96px、overscan 600px；候选行动、开场候选与楼层图片轮询 2 秒、上限 15 次。
- 生图：`data/images.yaml`、`image_workflows`、`character_visual_profiles`、`node_images`；`server --images` 与 `--media-dir`；图片只读 `done` 行。`illustrate` 现在是权限 `side_effect` 的深回合工具定义。
- 块类型 12 个；`historyBlockPolicy` 默认在更早楼层省略显示类块，最近 1 楼保留原文。
- 已注册槽位：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol；默认模板顺序 character、lore、state、summary、memory、scene、director、user_will、history、（可选的 block_format）、protocol；`protocol` 必须最后。

## 可重复命令与评测产物
- R1 事件回填与检索评测（仓库根目录）：
  - `pnpm --filter @dramaticer/st-compat events-backfill --resume --db eval-private/memory-cache/r1-retrieval.db`
  - `pnpm --filter @dramaticer/st-compat memory-eval --events --rerank --db eval-private/memory-cache/tmp/r1-memory-eval.db --private-report eval-private/reports/R1-retrieval.md --public-report docs/dev/reports/R1-retrieval.md --title "R1 记忆引擎检索评测"`
  - 两个 CLI 的相对路径都按仓库根目录解析；`--events` 与 `events-backfill` 共用 `eval-private/memory-cache/events`；`memory-eval` 在临时数据库上重新抽取事件，结束后删除数据库。
- 记分牌重新生成：`node packages/st-compat/dist/evalset/scoreboard-cli.js --playtest eval-private/reports/forgetting/playtest --playtest eval-private/reports/forgetting/legacy/playtest --forgetting eval-private/reports/forgetting/runs --forgetting eval-private/reports/forgetting/legacy/runs --b1-samples eval-private/reports/R2-b1/samples.jsonl --b1-records eval-private/reports/R2-b1/records.jsonl --b1-quality eval-private/reports/R2-b1/quality.jsonl --out docs/dev/SCOREBOARD.md`
- 自动试玩：CLI 入口 `pnpm --filter @dramaticer/st-compat playtest`；界面自动试玩 `pnpm playtest`；`pnpm e2e` 收集但跳过 `e2e/playtest/playtest.spec.ts`。live 默认 `PLAYTEST_RESUME=1`，续跑文件 `eval-private/reports/r5-playtest.progress.json`。
- R5 最终数据：60 成功 / 0 失败；相邻块 Jaccard 均值 0.0019、P90 0.0031（599 对）；首字 P50 5,176、P95 10,150 毫秒；生成 P50 10,094、P95 16,905 毫秒；每轮 total token 8,971.8；导演决策 60、有建议 60；错误 0；私有标识反向扫描通过（804 个标识）。数据库最终快照 `background_jobs` 为 done=786、pending=5、running=1、discarded=2、failed=5。不要再启动第二个监督进程或 server。
- R5 产物：`docs/dev/reports/R5.md`、`R5-playtest.md`；R3 产物 `R3.md`、`R3-fast.md`；O 产物 `O-opening.md`；R2 产物 `R2.md`、`R2-judge.md`、`R2-pairwise.md`、`R2-b1.md`、`R2-forgetting.md` 与 `docs/dev/SCOREBOARD.md`；R4 产物 `R4.md`；R1 检索与验收产物 `R1-retrieval.md`、`R1.md`。
- 引用评测数字时：B1 必须同时说明同模型子集为空、每个对话每档只有 1 个样本；遗忘矛盾率必须同时说明失败题数与可判定样本数；选择一致率当前没有样本。
- 手工冒烟脚本：聊天页、分支页、台账页、导演页、设置页与渠道页在 `.devloop/scratch/R5-T08`、`R5-T09`、`R5-T10`；M6-T04 与 M6-T05 在 `.devloop/scratch/M6-T04/smoke.mjs` 与 `.devloop/scratch/M6-T05/smoke.mjs`。
- e2e 假渠道（R5-T12）：`serve.mjs` 固定端口 4517，`playwright.config.ts` 的 baseURL 与 webServer 读 `E2E_APP_PORT`；假渠道用随机端口并写进每次重建的 `channels.yaml`；数据库固定在 `.devloop/scratch/e2e/work/e2e.db`。
- Vertex 渠道（V-T01）：`api: google-vertex` 使用 pi-ai 1.5.0 的适配器；凭证、项目、区域只从 `.env` 的三个 `GOOGLE_*` 变量读取，服务账号 JSON 不进仓库。HUMAN-14 已取消真实调用要求。
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`，只读、零模型调用；记忆检索段显示每一路的父段信息与注入范围；第 9 段显示运行状态与按 `seq` 排序的事件（包括草稿替换、提交与追加要求）。
- 生图配置：`data/images.yaml` 只有 `providers`，第一版只接受 `api: comfyui`；`baseUrl`、`apiKey` 默认空，`timeoutMs` 300,000、`pollIntervalMs` 1,000；workflow 存 `image_workflows`；`imageConfig` 存在 `story_settings.image_config`；生成文件写到数据库同目录的 `images/`，可用 `--media-dir` 覆盖；`node_images.file_name` 是 `<storyId>/<imageId>.<扩展名>`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- 真实渠道实跑用 `--model main-fallback --judge-model judge`（`rp` 仍 503）。
- 在 Windows 上并行跑 100 多个测试文件时单个测试耗时可以比单独运行高十几倍；`vitest.config.ts` 默认 `testTimeout` 60 秒。`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- `packages/core/test/` 与 `packages/st-compat/test/` 下的 `.tmp-*` 目录在 gitignore 里，不要提交。
- `packages/st-compat` 与 `packages/server` 测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这两个包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- 事件抽取提示词要求用克制、非露骨的中性表述；截断时窗口对半缩小（8 → 4 → 2 → 1）。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
