# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 287：R3b-T05（导演手记）。迁移 v41 新增 `director_notes(node_id PRIMARY KEY, story_id, diffs, created_at)`，同故事触发器拒绝跨故事写入，归属不可改。新增 `packages/core/src/director/notes.ts`：`DirectorNoteDiff` 只允许 `set`/`delete`，`key` 去空白后非空，`set` 文本不超过 2,000 字，每楼最多 50 条；`applyDirectorNoteDiffs` 沿路径逐楼应用、后写覆盖、`delete` 移除，结果按键排序；`formatDirectorNotes` 生成深回合开始时注入的系统消息。`StoryStore` 新增 `saveDirectorNotes`（每楼一行，重复写入直接失败）、`getDirectorNotes`（没有返回 null）、`readDirectorNoteEntries`（递归 CTE 从根到指定楼层累加）。工具 `note_read`（`read`，深回合）返回路径累加结果并叠加本轮待提交修改，`note_write`（`propose`）把修改交给运行内 `TurnNoteController`（`chat/notes.ts`，累计最多 50 条）；`note_write` 不碰数据库，只在助手楼层提交时与台账写入同一事务写入；深回合在组装后的消息之后追加一条手记系统消息，没有手记时不插入，快回合不注入也不暴露两个工具；手记不进入台账。新增 8 个 core 测试；门禁通过（172 个测试文件、1524 个测试、4 个 live 跳过）

## 下一步（会话 288 先做）
1. 做 R3b-T06（工具往返的上下文卫生）：每次请求前按 `deepContextTokenLimit`（默认 48,000）估算工具消息 token，从最早的一对“助手工具调用 + 工具结果”开始成对省略，保留最近 `deepRecentToolSteps`（默认 4）；不产生孤立消息；Trace 写 `deep.contextOmitted`（`pairs`、`messages`、`tokens`、`reason`）；快回合不套用。`TurnTraceDeep` 已有 `commit` 与 `drift` 字段。
2. T06 之后按顺序做 T07（模板配置）、T08（原生元数据）、T09（运行中追加要求，追加 `steering` 事件）、T10.a/T10.b（界面）、T99。
3. M6-T99 仍等待 HUMAN-15（ComfyUI 与 API workflow JSON），不要开始。
4. R3b 完成后再做 P1/P2 → C 兼容插件 → H → X → R6 → M6b → P3/P4 → M5 → P5 → M7。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00、R3b-T01、R3b-T02、R3b-T03、R3b-T04、R3b-T05。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 41。R3b 后续计划的迁移：v42 模板深回合配置（R3b-T07）。
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
- T06 上下文卫生：超过 `deepContextTokenLimit`（默认 48,000）时从最早的一对“助手工具调用 + 工具结果”开始成对省略，保留最近 `deepRecentToolSteps`（默认 4）；不产生孤立消息；Trace 记 `deep.contextOmitted`。
- T07 模板配置：`ContextTemplate.deepTurn` 增加 `tools` 白名单、`maxToolCalls`、`maxDurationMs`、`notesEnabled`；模板覆盖故事设置，故事设置覆盖默认值；白名单外调用按未知工具拒绝。
- T08 原生元数据：`LlmToolCall.native` 保存 `thoughtSignature`、`namespace`、`argumentsError`，助手消息 `native` 保存完整内容片段；pi 通道原样回放；Gemini 两轮工具调用 fixture 断言签名逐字节一致；新增 `*.live.test.ts`（`DRAMATICER_DEEP_LIVE=1`）。
- T09 运行中追加要求：core 暴露 `pushGuidance`（最多 5 条、每条 1–2,000 字）；server 维护运行句柄表；`POST /api/stories/:id/turns/:runId/steering`；`turn.started` 带 `runId`；SSE `turn.steering`；指引不写楼层；`steering` 事件写进运行日志。
- T10.a 界面：模式选择列出快/深、设置页深回合区段与模板字段、`turn.progress` 阶段文字。
- T10.b 界面：草稿区、追加要求输入、楼层运行时间线。web 的流式状态已经有 `liveDraft` 与 `committed` 字段可用。
- T99 验收：30 次真实深回合（失败率目标 ≤10%）、漂移率、时长对照 TauriTavern P50 66 秒/P90 147 秒、10 个分支点的快/深盲评增益；统计版 `docs/dev/reports/R3b.md`。

## 深回合实现起点（代码事实）
- 回合入口 `packages/core/src/chat/turn.ts`：`runChatTurn` 先 `resolveTurnMode`，再追加用户楼层、组装上下文、按模式调用 `runDeepTurn` 或 `runModelTurns`。深回合新建 `TurnDraftController` 与 `TurnNoteController`；`withDirectorNotes` 在组装后的消息之后追加一条系统消息（没有手记时不加）。正文解析在 `resolveTurnBody`：显式提交用草稿；正常结束但没有提交时把最后一次输出整份替换为草稿并自动提交，记 `drift: "missing_commit"`；中止、超时、工具次数上限或没有正文且没有提交时返回 null，运行标为 `failed` 并抛 `DeepTurnWithoutCommitError`（中止抛 `TurnAbortedError`，运行标为 `aborted`）。提交事务里先写助手楼层，再写手记 diff、台账 diff 与 Trace。快回合保持旧行为：中止且已有部分正文时仍写楼层。工具集合按模式选 `DEEP_TURN_TOOLS` 或 `FAST_TURN_TOOLS`；快回合只在函数调用或文本协议下暴露只读工具；`illustrate` 启用时加入，未启用时作为停用工具传入。
- 工具注册表 `packages/core/src/tools/registry.ts`、`read-tools.ts`、`write-tools.ts`、`draft-tools.ts`、`note-tools.ts`、`index.ts`：权限与进度文字声明、两个注册表、十个内置工具。`ledger_write` 的收集结果进入 `ModelTurnResult.proposedStateUpdates`，`note_write` 的收集结果留在 `TurnNoteController`，两者都在楼层事务里写入。深回合工具顺序为 memory_search、lore_lookup、state_get、ledger_read、history_read、note_read、ledger_write、note_write、draft_write、commit_draft。
- 导演手记 `packages/core/src/director/notes.ts`：`set`/`delete` 校验、`applyDirectorNoteDiffs` 累加、`formatDirectorNotes` 注入文本；存储层 `saveDirectorNotes`、`getDirectorNotes`、`readDirectorNoteEntries`。手记是模型的工作材料，不写 `state_diffs`，不参与结算。
- 草稿 `packages/core/src/chat/draft.ts`：`TurnDraftSnapshot { text, version }`；替换时版本加一，空正文与提交后的替换抛错；`commit(method)` 只允许一次，方式取 `tool` 或 `auto`。运行日志的 `draft.replace` 只记版本号与正文长度，`draft.commit` 记版本号、长度与方式。
- 手记控制器 `packages/core/src/chat/notes.ts`：`TurnNoteController.pending` 是本次运行的待提交 diff；`apply` 逐条校验并在累计超过 50 条时整批拒绝。
- 执行器 `packages/core/src/chat/executor.ts`：按注册表权限执行工具；`maxToolCalls` 计只读、propose、control 与 side_effect 的执行次数；`side_effect` 不强制下一轮，只登记；停用工具返回工具错误；未知工具记入 `rejected`（两种传输）；`maxDurationMs` 每次请求前检查；进度阶段去重后回调 `onToolProgress`；`TurnAbortedError` 带 `toolCallCount`。`control` 工具需要 `draft` 控制器，`draft_write` 与 `commit_draft` 走它；`propose` 里 `ledger_write` 进待提交集合、`note_write` 进手记控制器；提交后同一轮后续工具不再产生副作用，循环立即收束并把草稿正文作为最终结果。
- 运行日志 `packages/core/src/run-log.ts`：`TurnRunRecord`、`TurnRunEvent`、`TurnRunEventInput`、`TurnRunDetail`，状态五种、事件九种（`model.request`、`model.response`、`tool.call`、`tool.result`、`draft.replace`、`draft.commit`、`steering`、`limit`、`error`）。存储层事件序号由单条 `INSERT ... SELECT COALESCE(MAX(seq),0)+1` 分配；事件表触发器拒绝更新与删除；只能在 `running` 状态追加；`markInterruptedTurnRuns` 返回改动行数。`turn_runs.node_id` 在提交/中止保存楼层时写入，没有楼层时为空；唯一索引保证一个助手楼层最多一条运行。
- Trace `packages/core/src/trace.ts`：`TurnTrace.deep`（`TurnTraceDeep`，含 `stopReason`、`commit`、`drift`）、`TurnTrace.run`、`DeepTurnStopReason`、`TurnTraceToolCall.permission`；快回合 `deep` 与 `run` 都为 null；旧 Trace 读回时缺失的 `run` 补 null。
- server SSE `packages/server/src/turns.ts`：`turn.started`、`text.delta`、`blocks.replace`（100 毫秒节流）、`thinking.delta`、`tool.call`、`turn.progress`、`draft.replace`（100 毫秒节流）、`turn.committed`、`turn.error`、`turn.completed`；`turn.committed` 只带提交时的楼层 id、最终块与方式 `tool` 或 `auto`；`DeepTurnWithoutCommitError` 映射为 `internal` 错误并保留原因。`handleTurnStream` 在 `turn.completed` 后触发后台调度。协议事件名在 `packages/protocol/src/turn.ts`。
- server 只读接口 `packages/server/src/routes.ts`：`GET /api/nodes/:id/run` 返回 `NodeRunView`（`nodeId`、`run`、按 `seq` 升序的 `events`），楼层不存在或没有运行都 404。
- web `packages/web/src/chat/stream-state.ts` 处理 `turn.started`、`blocks.replace`、`tool.call`、`turn.progress`、`draft.replace`（写 `liveDraft`）与 `turn.committed`（写 `committed`）；聊天页每轮完成后重新取最近 60 楼。界面仍只展示快回合（R3b-T10.a 才放开）。

## 记忆与检索（R1 续）
- 父子分块：父段上限 1200 码点，按换行合并；单段超过上限时整楼退化成一个父段。小块 400 字符窗口、80 字符重叠。`StoryStore.open(path, { chunkStrategy })` 取 `parent-child`（默认）或 `fixed`。
- 重排序：`reranker` 段在 `channels.yaml`，`enabled` 当前 false；`OpenAiRerankClient` 默认把文档截断到 4,000 码点。融合权重默认 BM25 2、向量 1、实体 0.5、事件 0.5、最近块 1。
- 八段式压缩：表 `chapter_compressions`，固定八个键；槽位注入主线压缩与最近一条章节；`DEFAULT_COMPRESSION_TOKEN_LIMIT = 2_000`，散文摘要默认 800；完整八段实测 1,146/1,210/1,491 token。
- 世界书预筛：表 `lore_prefilter(node_id PRIMARY KEY, story_id, entry_ids, created_at)`；后台任务 `lore_prefilter` 只处理当前 head 路径最新助手楼层；槽位有记录时只注入常驻条目与记录选中的非恒常条目。
- 上下文包：表 `context_packs(node_id PRIMARY KEY, story_id, payload, created_at)`；指纹覆盖模板、预算、档位、导演强度与各槽位 `packKey`；引用失效时重新组装；玩家编辑产生新楼层，不继承旧包。
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
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`，只读、零模型调用；记忆检索段显示每一路的父段信息与注入范围；第 9 段显示运行状态与按 `seq` 排序的事件（包括草稿替换与提交）。
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
