# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：143
- 任务：R4-T03 短线层
- 结果：完成（`DONE`），门禁通过（121 个测试文件、1075 个测试通过，3 个 live 跳过，共 1078 个）。
  - 新增 `packages/core/src/director/intensity.ts`：`DIRECTOR_INTENSITIES`、`DirectorIntensity`、`isDirectorIntensity`、`assertDirectorIntensity`、`resolveDirectorIntensity`、`renderByIntensity`。`OpeningIntensity` 与 `OPENING_INTENSITIES` 已删除，全部引用改为 `DirectorIntensity`；开场导演的三档输出逐字节不变。
  - `DirectorConfig` 新增 `intensity`（默认 `natural`），`assertDirectorConfig` 校验，`DIRECTOR_CONFIG_KEYS` 收录；旧故事设置读取时按默认值补齐，写回包含该字段。
  - 新增 `director/beat.ts` 的 `createBeatMechanism`（`BEAT_PRIORITY = 23`，注册在开场之后）：`resolveCurrentBeat` 取当前拍，`setup` 只给目标与起始迹象，`natural` 再加契合点，`detonate` 再加「本楼必须出现可见变化」与三条方向（方向逐字取自目标、首条起始迹象与首条契合点）；`signals.beat` 写 `arcId`、`sequenceId`、`beatId`、`intensity`、`difficulty`、`usedFitPoints` 与 `floorDepth`。
  - `ChatTurnOptions.directorIntensity`：`runChatTurn` 在追加用户楼层之前解析并重建导演槽位，`generateAssistantTurn` 也解析一次；`createDirectorSlotProvider` 返回带 `config` 与 `mechanisms` 的 `DirectorSlotProvider`，`isDirectorSlotProvider` 用于覆盖。没有导演槽位或槽位不带配置时指定强度直接抛错。
  - `dramaticer chat --intensity <setup|natural|detonate>` 与 `POST /api/stories/:id/turns` 的请求体 `intensity` 走同一套校验；服务端非法值返回 400（`details.path` 为 `intensity`）且不建楼层；朴素模式传 `--intensity` 直接失败。
  - 新增 `packages/core/test/director-beat.test.ts`（8 个测试）；更新 `director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts` 的机制列表断言，`story-settings.test.ts` 的默认值与非法取值，`chat-cli.test.ts` 与 server `turns.test.ts` 各加一个用例。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0-T01 至 R0-T05、R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、R1-T02.1、R1-T02.2、R1-T02.3、R1-T02.4、R1-T02.a、R1-T02.b、R1-T03、R1-T04.a、R1-T07、R1-T07.a、R1-T07.b.a、R1-T07.b.b、R1-T07.b.c、R1-T07.b.d、R1-T07.b.d.a、R1-T07.b.d.b、R1-T99、R3-T01、R3-T02、R3-T03、R3-T04、R3-T99、O-T01、O-T02、O-T03、O-T99、O-T01.a、O-T99.a、R2-T01、R2-T02、R2-T03、R2-T03.a、R2-T03.b、R2-T04、R2-T04.a、R2-T05、R2-T06、R2-T07、R2-T07.a、R2-T08、R2-T09.a、R2-T09.b、R2-T09.c、R2-T99、R5-T01、R5-T02、E-T01、R4-T00、R4-T01、R4-T02、R4-T03。完成记录与验收标准见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- **下一个可做任务是 R4-T04 注入口**：依赖 R4-T03、R3-T03、M1-T04 均已满足。之后依次 R4-T05、R4-T06、R4-T07、R4-T08、R4-T99，然后 R5-T00。
- v3 阶段顺序：R3 快回合 → O 开局与方向 → R2 评测底座 → E 排障 → R4 → R5（最小界面先做）→ M6 生图第一批 → R1 续 记忆增强 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → P3/P4 → M5 → P5 → M7。
- R5-T00 仍被 R4-T99 阻塞；R5-T04 依赖 M4-T05、M4-T06、M4-T01，可以排在 R4 之后。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045。
- HUMAN-09 待处理（不阻塞）：`data/channels.yaml` 已有 `bg-fallback`、`main-fallback`、`codex`，`channels.example.yaml` 还没有这三个别名。
- HUMAN-10 待处理（不阻塞）：插件不变量是否加进 AGENTS.md。
- HUMAN-11 待处理（不阻塞）：`.env` 的正文模型 `opendesign/deepseek-v4.1-flash` 返回 membership entitlement 错误。
- HUMAN-12 待处理（不阻塞）：HUMAN.md 条目仍描述 `roles.judge` 指向 `codex`，实际配置已是 `judge`（`auto/glm-5.3`）。
- HUMAN-13 待处理（不阻塞）：`catie` 的 `rp`（`agy-gemini-3.8-flash-medium`）返回 503「没有可用的 Antigravity 凭证」，影响 `roles.writer`；R2-T99 的真实分支点验证改用 `main-fallback`。凭证恢复后可用 `node scripts/r2-legacy-forgetting.mjs run-all --concurrency 3` 补齐 45 道失败题。
- 数据库 schema 版本 32（v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 历史块策略、v23 事件抽取记录、v24 变更卡、v25 合并调用开关与执行记录、v26 间隙档位阈值与丢弃状态、v27 合并调用丢弃条目、v28 回合模式与读取工具软上限、v29 开局包与故事级后台任务、v30 首楼开场候选、v31 偏好记录、v32 导演计划与拍状态）；R4-T07 使用 v33（候选行动）；R1 续原计划的 v32–v35 顺延为 v34–v37；插入新迁移时后续编号一起顺延。
- server 的回合路径会补建并执行后台任务：`handleTurnStream` 在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain，故事之间先来先做。
- 分支与面板接口已可用；`packages/web` 尚未创建。`GET /api/nodes/:id/ledger` 返回 `{state, facts, diffs}`，`facts` 来自 `readLedgerFacts`，`diffs` 只含该楼层自己的写入。
- 偏好记录已闭环：记录写入（四种信号）→ `POST /api/nodes/:id/choice` → `preferences export` 产出回复对 → `pairwise` 盲测与评分 → `scoreboard` 汇总。私有库目前没有任何 `preference_events`。
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`。只读、零模型调用；导演决策从助手楼层的父楼层读（`director_decisions` 写在生成时的消息楼层上）。记忆槽位的 `retrieval` 只在槽位真正注入内容时写进 Trace；没有命中时该槽位记为 `missing-slot`。
- 导演计划接口：`readDirectorPlan` 按 `ordinal` 还原弧线、序列、节拍；`--set` 与 `PUT /api/stories/:id/director/plan` 都整份替换并把所有行标为 `player`，`mergePlannedArcs` 只更新或追加 `model`/`import` 行，永不删除、不覆盖 `player` 行。`resolveCurrentBeat` 沿路径最近一条 `director_beat_states` 前进：完成则到下一拍（跨序列），未完成停在原地，无状态取第一拍，耗尽返回 null；记录指向已不存在的节拍时跳过该记录，仍无有效记录则回到第一拍。
- 导演规划器（R4-T02）：`directorPlanNeedsRun` 需要角色卡或台账素材；计划为空时补建，head 上 `resolveCurrentBeat` 返回 null 时补建，head 为空或当前拍仍可解析时不补建。输入读取 `head` 处的 `listLedgerEntities`、`item` 与 `userWill` 子树及 `getValidSummaries` 的第一条（有章节摘要时取最近章节，否则最近主线）。`plannerClient` 在 `dramaticer work` 与 server 里用 `roles.planner` 建立，缺省回落到 `background`；注册表未收到 `plannerClient` 时使用任务上下文的后台客户端。`--generate` 与后台任务走同一个 `generateDirectorPlan`，写入的行来源都是 `model`。
- 导演强度（R4-T03 之后、R4-T04 之前）：`DirectorConfig.intensity` 与 `openingIntensity` 共用 `DirectorIntensity`（`setup`、`natural`、`detonate`），前者只作用于节拍建议，后者只作用于开场导演；`resolveDirectorIntensity` 让单轮参数覆盖配置。机制优先级固定为重复正文 40、开场 35、线索过老 30、场景重复 25、节拍 23、线索过多 20、事件池 10、节奏 5；默认机制注册顺序是 clue、opening、beat、repetition、event_pool、pacing。`createDirectorSlotProvider` 仍产生一条以 `【导演】` 开头的 system 消息，但返回类型是带 `config`、`mechanisms` 的 `DirectorSlotProvider`。`GET /api/nodes/:id/director` 直接返回完整决策。
- `extensions.dramaticer` 目前只有 `events` 与 `npcAgendas` 两个键；R4-T08 新增 `arcs` 时必须同步更新严格校验与 st-compat 的导入测试。

## 下一步
- **R4-T04 注入口**：`ContextSlotContent` 增加 `suffix?: string`，`ContextTraceEntry` 增加 `appendedTo?: "last-user"`；组装器在预算裁剪之后把 `suffix` 接在最后一条 `user` 消息末尾，Trace 记来源、token 与 `appendedTo`。`createDirectorSlotProvider` 改为返回 suffix（`【导演】<directive>` 加固定尾注 `玩家行动优先，你可以按剧情需要调整。`，尾注导出为常量），不再返回 system 消息；预算不足时整个 suffix 标记 `budget-dropped`；没有玩家消息时记 `missing-slot`；`dramaticer explain` 显示 `appendedTo`。依赖与验收见 TASKS。
- R4-T04 之后依次 R4-T05（模式）、R4-T06（落拍）、R4-T07（候选行动，v33）、R4-T08（卡扩展）、R4-T99，然后 R5-T00。
- 引用评测数字时：B1 必须同时说明同模型子集为空、每个对话每档只有 1 个样本；遗忘矛盾率必须同时说明失败题数与可判定样本数；偏好一致率当前没有样本。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 记分牌重新生成（仓库根目录执行）：
  `node packages/st-compat/dist/evalset/scoreboard-cli.js --playtest eval-private/reports/forgetting/playtest --playtest eval-private/reports/forgetting/legacy/playtest --forgetting eval-private/reports/forgetting/runs --forgetting eval-private/reports/forgetting/legacy/runs --b1-samples eval-private/reports/R2-b1/samples.jsonl --b1-records eval-private/reports/R2-b1/records.jsonl --b1-quality eval-private/reports/R2-b1/quality.jsonl --out docs/dev/SCOREBOARD.md`
  或把同样参数交给 `pnpm --filter @dramaticer/st-compat scoreboard`；`pnpm --filter` 的工作目录是包目录，相对路径会按包目录解析，冒烟时用绝对路径。
- 记分牌日期取输入最新时间戳；输入都无时间戳时必须显式传 `--date`。测试覆盖“不传 `--date` 时从输入推导”。
- B1 历史回放的入口是 `pnpm --filter @dramaticer/st-compat replay-eval`（或直接跑 `packages/st-compat/dist/evalset/historical-replay-cli.js`）。分支点从导入历史的末端（消息序号最大的节点）取，不跟随已经生成的续写楼层，因此同一个种子库重复运行取到同样的分支点；续跑用 `--resume`，只重算报告用 `--report-only`。
- 真实渠道实跑用 `--model main-fallback --judge-model judge`（`rp` 仍 503）；R2-T99 的分支点验证样本为第 401 楼、naive 档，数字见 `docs/dev/reports/R2.md`。
- B1 的默认报告与数据路径：`eval-private/reports/R2-b1.md`、`docs/dev/reports/R2-b1.md`、`eval-private/reports/R2-b1/{samples,records,quality}.jsonl`、种子库 `eval-private/reports/R2-b1/db/`。
- B1 的“同模型”是去掉 `auto/` 前缀后模型 id 逐字相同；“同家族”用 `modelFamily`。当前 3 个历史回复模型都与 `main-fallback` 不同名，同模型子集为空。
- `pairwise` 的样本语境是两份续写的共同父楼层路径（最近 6 楼）；B1 用同一个 `formatPairwiseContext`。历史回放判定新增 `PairwiseTask` 的 `historical`。
- 评分提示词的 system 段包含 `TTCW` 字样，测试里的假客户端靠它区分判定请求与评分请求；改提示词时同步 `pairwise.test.ts`、`historical-replay.test.ts` 与 `scoreboard.test.ts`。
- 质量评分同样本同一侧有多行时取最后一行；失败记录只计数，不进入均值；统计版不含故事 id、样本 id、理由与原文。
- `preferences export` 的 `--db` 是必填；导出结果在同一数据库上逐字节相同；选项选择按所选正文与同一选项块里未选中的行配对，重 roll 按被放弃与被接受楼层配对。
- 遗忘评测（R2-T09.a）：`playtest --head` 只接受当前故事里存在的助手楼层，且不能与 `--resume` 同时使用；起点深度是设置 head 之后的 `getPathToHead` 长度。跑后批测必须同时给 `--questions-out` 与至少一个题目文件，题目文件里的 `story` 必须与 `--story` 一致。
- 跑后批测在最终 head 上提问；证据楼层不在当前路径上的题目记 `skipped`。遗忘分层固定为 `<100`、`100-199`、`200-299`、`300+`，用起点深度判定；编造数按「编造题且裁判判为矛盾」计算。
- `forgetting-report` 的 `--input` 可以是一个 JSON 或包含 JSON 的目录；私有版默认写 `eval-private/reports/R2-forgetting.md`，统计版默认写 `docs/dev/reports/R2-forgetting.md`。
- legacy 导入与运行驱动在 `scripts/r2-legacy-forgetting.mjs`：`import`、`branches`、`run`、`run-all`、`finalize`；续跑必须带 `--resume true`。
- 基准的入口是 `pnpm --filter @dramaticer/st-compat benchmark --generate|--validate|--import --db <path>`，`--root` 指定基准目录；`benchmarks/` 是生成产物，**不要手改**。
- 开局包的读取入口是 `readOpeningPack(store, storyId)`；校验用 `validateOpeningPackPayload(value, known)`；首楼候选解析用 `parseOpeningCandidatesResponse(text, expectedCount)`，不要另写一套。
- 自动试玩的入口是 `pnpm --filter @dramaticer/st-compat playtest`：每轮顺序是读间隙积压 → 模拟用户 → `runChatTurn` → swipe/edit/branch → 间隙后台任务 → 一致性探针 → 每轮裁判 → 写记录。`--seed` 只决定模拟用户的提示顺序与探针事实选择。
- 开场导演的楼层深度按当前路径助手楼层数计算；`openingFloors` 为 0 关闭；开局强度 `setup`、`natural`、`detonate` 的字段范围见 DESIGN §8.4。节拍机制的楼层深度用同一口径。
- 故事设置缺省值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 4096、`reasoning` `low`、`turnMode` `fast`、`maxReadRounds` 3、`historyBlockPolicy` `{mode:"default",overrides:{}}`、`gapPassEnabled` `false`、`gapPlanSeconds` 212、导演默认配置（含 `openingFloors` 10、`openingIntensity` `natural` 与 `intensity` `natural`）。
- 已注册的槽位是十一个：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol。默认模板顺序：character、lore、state、summary、memory、scene、director、user_will、history、（可选的 block_format）、protocol。R4-T04 起 `director` 槽位改为 suffix，不再产生 system 消息；不新增 `beat` 槽位。
- 原生块类型是 12 个（`thinking`、`选项`、`状态栏`、`变量更新`、`分析`、`图片`、`页眉`、`悄悄话`、`旁白`、`备忘`、`state_update`、`plot_note`）；`thinking`、`变量更新`、`state_update`、`plot_note` 的上下文策略是删除。
- 历史槽位默认策略：更早楼层省略五个显示类块，最近 1 楼不套用这层省略；`full` 是改动前行为。设置项 `historyBlockPolicy` 存在 `story_settings.history_block_policy`。
- 结算窗口以 head 为终点（ADR-0046），取**最旧的** N 个未结算助手楼层；冲突检查窗口取 head 路径最后 `conflictWindowFloors` 楼。现场分析以被分析的楼层为锚点。`scene` 任务显式传 200 token 上限。
- 后台任务分两档：`gap` 每次间隙执行，`deferred`（`events`、`summary`、`npc_agenda`、`director_plan`）只在会话结束或间隙达到 `gapPlanSeconds` 时执行。`gap_pass` 默认关闭；`dramaticer work` 与 server 调度都不为关闭的故事补建。
- 后台任务连续失败 3 次才放弃；`user_will` 的 `sourceQuote` 必须逐字出现在玩家楼层里。后台任务需要等待其它任务时抛 `BackgroundJobDeferredError`；取消本轮时 `drain` 用 `options.signal`。
- 模型响应的磁盘缓存键包含 `max_tokens` **只在请求显式带 maxTokens 时**；改渠道配置的 `maxTokens` 后必须换一个 `--cache` 目录。后台 `background` 模型的输出上限是 32,768。
- 后台路由现状（2026-11-08）：`main-fallback`（`auto/deepseek-v4.1-flash`）可用；`opendesign/deepseek-v4.1-flash` 曾返回 membership entitlement 错误；`catie` 的 `rp` 返回 503（HUMAN-13）。`data/channels.yaml` 现在是 `writer: rp`、`judge: judge`（`auto/glm-5.3`）；`roles.planner` 未配置，回落到 `background`。
- 渠道角色（`writer`、`settler`、`planner`、`judge`）与消息角色不同；`createLlmClient` 校验 judge 与 writer 的模型家族不同。server 运行时为 writer、settler、planner 各建一个客户端；`dramaticer work` 建 settler 与 planner 两个客户端。
- 工具传输：`resolveToolTransport` 在未显式配置时按 `probe.functionCalling` 决定；文本协议是 `core/src/chat/tool-protocol.ts`，工具说明只插进发给模型的消息副本。
- 写作契约：`WRITING_CONTRACT` 是四条原则；`protocol` 是固定 id 的静态段，`assertContextTemplate` 要求它是最后一个片段。
- 快照：`eval-private/raw/` 有 94 个文件；`eval-private/reference/` 有 5 部参照小说。私有数据只写 `eval-private/`，报告不用原文。
- F0 的私有产物：`eval-private/f0/` 下的 pairs、attribution、judge、fulltext 系列与 `llm-cache/`；R3 的产物：`docs/dev/reports/R3.md`、`R3-fast.md`；O 的产物：`docs/dev/reports/O-opening.md`；R2 的产物：`docs/dev/reports/R2.md`、`R2-judge.md`、`R2-pairwise.md`、`R2-b1.md`、`R2-forgetting.md`、`docs/dev/SCOREBOARD.md`。
- HUMAN-03（事件题抽查）仍未完成，不阻塞。M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。
- 插件系统在 DESIGN §19 是唯一权威；C 线兼容插件任务依赖 P2。记忆增强任务（R1-T03.a、R1-T03.b、R1-T04.b、R1-T05、R1-T06、R1-T08）都依赖 R5-T99。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包、ST 语义只在兼容插件里实现。
- I10 的扫描会把测试文件里出现的 `privatePath` 字样当成私有数据路径；测试变量不要用这个名字。
- 整轮门禁在 Windows 上并行跑 100 多个测试文件时，单个测试耗时可以比单独运行高十几倍。新建要跑数据库或文件系统的测试必须显式设置超时；`afterEach` 删除临时目录用 `rmSync` 时带上 `maxRetries` 与 `retryDelay`。
- `packages/core/test/` 与 `packages/st-compat/test/` 下的 `.tmp-*` 目录会被测试创建；它们在 gitignore 里，不要提交。
