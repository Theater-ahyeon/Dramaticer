# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：136
- 任务：R2-T05 B1 历史回放基线
- 结果：完成（`DONE`），门禁通过（116 个测试文件、1025 个测试通过，3 个 live 跳过，共 1028 个）。
  - 新增 `packages/st-compat/src/evalset/historical-replay.ts` 与 `historical-replay-cli.ts`（入口 `pnpm --filter @dramaticer/st-compat replay-eval`）：复用 ADR-0027 的 `selectBranchPoints` 取点，默认间隔 100 楼、回放 1 轮、每对话上限 2；分支点之后第一条非空玩家消息的下一层助手楼层是历史回复。
  - 每个分支点按 `native` 与 `naive`（B0）各回放一次，head 指到分支点后用真实玩家消息调用 `runChatTurn`；只把第一段续写与历史回复配对，两侧取 `renderContextView(parseBlocks(raw))` 的显示视图，语境用 `formatPairwiseContext`（最近 6 楼）。
  - `PairwiseTask` 增加 `historical`（提示词不告诉裁判哪侧是历史回复）；同一对按 `generated-first` 与 `historical-first` 各判一次，严格 JSON、失败重试 3 次。历史回放的语境长，裁判输出上限默认改为 2048（512 会被思考占满）；命令行用 `--judge-max-tokens` 可改。
  - 样本元数据写 `eval-private/reports/R2-b1/samples.jsonl`，判定写 `records.jsonl`，评分写 `quality.jsonl`；评分复用 `runQualitySample`/`summarizeQuality`（续写在接受侧、历史回复在放弃侧）。报告按档位与对话给样本数、双向完成、胜率、平局率、位置偏差与失败；同模型子集单列，无同模型样本时明确写 B1 只作参考。
  - `samples.jsonl` 记录原始 head、生成与历史楼层 id、历史回复模型（聊天消息的 `extra.model`）、同模型（去掉 `auto/` 后逐字相同）与同家族（`modelFamily`）、前缀楼层、采样参数与是否有记忆与导演。不带 `--resume` 的重复运行也从元数据恢复原始 head，避免把生成楼层当成主路径；要完全重建就换一个 `--db-dir`。
  - 真实运行：`writer` 仍 503，使用 `main-fallback`（`auto/deepseek-v4.1-flash`），裁判 `judge`（`auto/glm-5.3`）；3 个 legacy 对话各 1 个分支点，共 6 个样本，12 次判定与 12 次评分 0 失败。总体 naive 续写胜 3/6（50.0%）、native 1/6（16.7%），平局 0，位置偏差 33.3%；同模型子集为空（历史回复分别是 Gemini 两个变体与 `deepseek-v4-pro`），B1 只作参考。评分均值：续写原创 3.33、人物 4.00、节奏 3.67、对话 3.67；历史回复 3.17、3.67、3.83、3.17。
  - 私有报告 `eval-private/reports/R2-b1.md`，统计版 `docs/dev/reports/R2-b1.md`；新增 9 个测试，零网络；ADR-0076。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0-T01 至 R0-T05、R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、R1-T02.1、R1-T02.2、R1-T02.3、R1-T02.4、R1-T02.a、R1-T02.b、R1-T03、R1-T04.a、R1-T07、R1-T07.a、R1-T07.b.a、R1-T07.b.b、R1-T07.b.c、R1-T07.b.d、R1-T07.b.d.a、R1-T07.b.d.b、R1-T99、R3-T01、R3-T02、R3-T03、R3-T04、R3-T99、O-T01、O-T02、O-T03、O-T99、O-T01.a、O-T99.a、R2-T01、R2-T02、R2-T03、R2-T03.a、R2-T03.b、R2-T04、R2-T04.a、R2-T05、R2-T07、R2-T07.a、R2-T08、R2-T09.a、R2-T09.b、R2-T09.c、R5-T01、R5-T02。完成记录与验收标准见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- **下一个可做任务是 R2-T06 记分牌与报告口径**：依赖 R2-T03、R2-T03.a、R2-T04、R2-T04.a、R2-T05，全部满足。之后是 R2-T99。R5-T00 仍被 R4-T99 阻塞；R5-T04 排在 R2 之后。
- v3 阶段顺序：R3 快回合 → O 开局与方向 → R2 评测底座 → E 排障 → R4 → R5（最小界面先做）→ M6 生图第一批 → R1 续 记忆增强 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045。
- HUMAN-09 待处理（不阻塞）：`data/channels.yaml` 已有 `bg-fallback`、`main-fallback`、`codex`，`channels.example.yaml` 还没有这三个别名。
- HUMAN-10 待处理（不阻塞）：插件不变量是否加进 AGENTS.md。
- HUMAN-11 待处理（不阻塞）：`.env` 的正文模型 `opendesign/deepseek-v4.1-flash` 返回 membership entitlement 错误。
- HUMAN-12 待处理（不阻塞）：HUMAN.md 条目仍描述 `roles.judge` 指向 `codex`，实际配置已是 `judge`（`auto/glm-5.3`）。
- HUMAN-13 待处理（不阻塞）：`catie` 的 `rp`（`agy-gemini-3.8-flash-medium`）返回 503「没有可用的 Antigravity 凭证」，影响 `roles.writer`；B1 实测改用 `main-fallback`。
- 数据库 schema 版本 31（v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 历史块策略、v23 事件抽取记录、v24 变更卡、v25 合并调用开关与执行记录、v26 间隙档位阈值与丢弃状态、v27 合并调用丢弃条目、v28 回合模式与读取工具软上限、v29 开局包与故事级后台任务、v30 首楼开场候选、v31 偏好记录）；后续编号：v32 父子分块、v33 章节压缩、v34 世界书预筛、v35 上下文包；插入新迁移时后续编号一起顺延。
- server 的回合路径会补建并执行后台任务：`handleTurnStream` 在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain，故事之间先来先做。
- 分支与面板接口已可用；`packages/web` 尚未创建。`GET /api/nodes/:id/ledger` 返回 `{state, facts, diffs}`，`facts` 来自 `readLedgerFacts`，`diffs` 只含该楼层自己的写入。
- 偏好记录已闭环：记录写入（四种信号）→ `POST /api/nodes/:id/choice` → `preferences export` 产出回复对 → `pairwise` 盲测与评分。

## 下一步
- **R2-T06 记分牌与报告口径**：新增 `docs/dev/SCOREBOARD.md` 与 `scoreboard` 命令行，从私有 JSONL（`pairwise` 的 `records.jsonl`/`quality.jsonl`、遗忘报告、试玩记录、`R2-b1` 的样本与判定）聚合字段：日期、阶段、profile、模型别名、样本数、对比胜率、矛盾率、编造回忆率、偏好一致率（接受/放弃回复对，切回较早 swipe 单列）、叙事质量四项、重复度、首字延迟 P50/P95、截断率、间隙未完成率、每轮成本、结论与下一步。只含聚合数字，同一批输入重复生成逐字节相同。
- R2-T06 直接调用 `summarizePreferenceComparisons`、`summarizeQuality` 与 `summarizeHistoricalReplay`，不自行解释胜率或评分；B1 的数字受“同模型子集为空”限制，记分牌要照原样标注。
- R2-T99 最后验收；门槛规则：没赢过基线就自动生成改进任务并重评，最多三轮，之后写 HUMAN.md。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- B1 的默认报告与数据路径：`eval-private/reports/R2-b1.md`、`docs/dev/reports/R2-b1.md`、`eval-private/reports/R2-b1/{samples,records,quality}.jsonl`、种子库 `eval-private/reports/R2-b1/db/`。`--report-only` 不读渠道与模型；`--resume` 复用元数据与已有判定（失败也算已记录）；要重试失败项就不带 `--resume`，但会重新生成续写。
- B1 的分支点取法与 ADR-0027 一致；间隔 100 时 3 个 legacy 对话的第一个有效分支点分别是 401、201、201 楼。每个对话的路径长度不同，换间隔后先看日志里“没有满足条件的分支点”。
- B1 的“同模型”是去掉 `auto/` 前缀后模型 id 逐字相同；“同家族”用 `modelFamily`。当前 3 个历史回复模型都与 `main-fallback` 不同名，同模型子集为空；引用胜率时必须同时说明这一点与每个对话只有 1 个样本。
- `pairwise` 的样本语境是两份续写的共同父楼层路径（最近 6 楼）；B1 用同一个 `formatPairwiseContext`。历史回放判定新增 `PairwiseTask` 的 `historical`，`quality.ts` 的记录解析也接受该值。
- 评分提示词的 system 段包含 `TTCW` 字样，测试里的假客户端靠它区分判定请求与评分请求；改提示词时同步 `pairwise.test.ts` 与 `historical-replay.test.ts` 的假客户端。
- 质量评分同样本同一侧有多行时取最后一行；失败记录只计数，不进入均值；统计版不含故事 id、样本 id、理由与原文。
- `preferences export` 的 `--db` 是必填；`pnpm --filter` 的脚本工作目录是 `packages/st-compat`，相对路径会按包目录解析，冒烟时传绝对路径。私有库里目前没有任何 `preference_events`（48 个数据库都查过）。
- 真实偏好与评分数字要等玩家操作产生记录后重新导出并跑 `pairwise`；`docs/dev/reports/R2-pairwise.md` 与 `R2-b1.md` 的数字来自小样本，不能作为效果结论。
- 遗忘评测（R2-T09.a）：`playtest --head` 只接受当前故事里存在的助手楼层，且不能与 `--resume` 同时使用；起点深度是设置 head 之后的 `getPathToHead` 长度。跑后批测必须同时给 `--questions-out` 与至少一个题目文件，题目文件里的 `story` 必须与 `--story` 一致。
- 跑后批测在最终 head 上提问；证据楼层不在当前路径上的题目记 `skipped`。遗忘分层固定为 `<100`、`100-199`、`200-299`、`300+`，用起点深度判定；编造数按「编造题且裁判判为矛盾」计算。
- `forgetting-report` 的 `--input` 可以是一个 JSON 或包含 JSON 的目录；私有版默认写 `eval-private/reports/R2-forgetting.md`，统计版默认写 `docs/dev/reports/R2-forgetting.md`，统计版不出现故事 id、题目与回答。
- legacy 导入与运行驱动在 `scripts/r2-legacy-forgetting.mjs`：`import`、`branches`、`run`、`run-all`、`finalize`；续跑必须带 `--resume true`。R2-T09.c 的失败题里 84 道是作答返回空文本、45 道是 `catie` 的 `rp` 路由 503；引用 native 矛盾率时必须同时说明失败题数与可判定样本数。
- 基准的入口是 `pnpm --filter @dramaticer/st-compat benchmark --generate|--validate|--import --db <path>`，`--root` 指定基准目录；校验默认把临时库建在 `.devloop/scratch`，`--scratch` 可以改。`benchmarks/` 是生成产物，**不要手改**。
- 开局包的读取入口是 `readOpeningPack(store, storyId)`；校验用 `validateOpeningPackPayload(value, known)`；首楼候选解析用 `parseOpeningCandidatesResponse(text, expectedCount)`，不要另写一套。
- 自动试玩的入口是 `pnpm --filter @dramaticer/st-compat playtest`：每轮顺序是读间隙积压 → 模拟用户 → `runChatTurn` → swipe/edit/branch → 间隙后台任务 → 一致性探针 → 每轮裁判 → 写记录。`--seed` 只决定模拟用户的提示顺序与探针事实选择。
- 开场导演的楼层深度按当前路径助手楼层数计算；`openingFloors` 为 0 关闭；强度 `setup`、`natural`、`detonate` 的字段范围见 DESIGN §8.4。
- 故事设置缺省值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 4096、`reasoning` `low`、`turnMode` `fast`、`maxReadRounds` 3、`historyBlockPolicy` `{mode:"default",overrides:{}}`、`gapPassEnabled` `false`、`gapPlanSeconds` 212、导演默认配置（含 `openingFloors` 10 与 `openingIntensity` `natural`）。
- 已注册的槽位是十一个：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol。默认模板顺序：character、lore、state、summary、memory、scene、director、user_will、history、（可选的 block_format）、protocol。
- 原生块类型是 12 个（`thinking`、`选项`、`状态栏`、`变量更新`、`分析`、`图片`、`页眉`、`悄悄话`、`旁白`、`备忘`、`state_update`、`plot_note`）；`thinking`、`变量更新`、`state_update`、`plot_note` 的上下文策略是删除。
- 历史槽位默认策略：更早楼层省略五个显示类块，最近 1 楼不套用这层省略；`full` 是改动前行为。设置项 `historyBlockPolicy` 存在 `story_settings.history_block_policy`。
- 结算窗口以 head 为终点（ADR-0046），取**最旧的** N 个未结算助手楼层；冲突检查窗口取 head 路径最后 `conflictWindowFloors` 楼。现场分析以被分析的楼层为锚点。`scene` 任务显式传 200 token 上限。
- 后台任务分两档：`gap` 每次间隙执行，`deferred`（`events`、`summary`、`npc_agenda`）只在会话结束或间隙达到 `gapPlanSeconds` 时执行。`gap_pass` 默认关闭；`dramaticer work` 与 server 调度都不为关闭的故事补建。
- 后台任务连续失败 3 次才放弃；`user_will` 的 `sourceQuote` 必须逐字出现在玩家楼层里。后台任务需要等待其它任务时抛 `BackgroundJobDeferredError`；取消本轮时 `drain` 用 `options.signal`。
- 模型响应的磁盘缓存键包含 `max_tokens` **只在请求显式带 maxTokens 时**；改渠道配置的 `maxTokens` 后必须换一个 `--cache` 目录。后台 `background` 模型的输出上限是 32,768；不要把这些结构化请求改回 8,192。
- 后台路由现状（2026-11-08）：`main-fallback`（`auto/deepseek-v4.1-flash`）可用；`opendesign/deepseek-v4.1-flash` 曾返回 membership entitlement 错误；`catie` 的 `rp` 返回 503（HUMAN-13）。`data/channels.yaml` 现在是 `writer: rp`、`judge: judge`（`auto/glm-5.3`）。
- 渠道角色（`writer`、`settler`、`planner`、`judge`）与消息角色不同；`createLlmClient` 校验 judge 与 writer 的模型家族不同。
- 工具传输：`resolveToolTransport` 在未显式配置时按 `probe.functionCalling` 决定；文本协议是 `core/src/chat/tool-protocol.ts`，工具说明只插进发给模型的消息副本。
- 写作契约：`WRITING_CONTRACT` 是四条原则；`protocol` 是固定 id 的静态段，`assertContextTemplate` 要求它是最后一个片段。
- 快照：`eval-private/raw/` 有 94 个文件；`eval-private/reference/` 有 5 部参照小说。私有数据只写 `eval-private/`，报告不用原文。
- F0 的私有产物：`eval-private/f0/` 下的 pairs、attribution、judge、fulltext 系列与 `llm-cache/`；R3 的产物：`docs/dev/reports/R3.md`、`R3-fast.md`；O 的产物：`docs/dev/reports/O-opening.md`；R2-T03.b 的私有产物：`eval-private/reports/r2-judge/`；R2-T09.b/c 的私有产物：`eval-private/reports/forgetting/`。
- HUMAN-03（事件题抽查）仍未完成，不阻塞。M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。
- 插件系统在 DESIGN §19 是唯一权威；C 线兼容插件任务依赖 P2。记忆增强任务（R1-T03.a、R1-T03.b、R1-T04.b、R1-T05、R1-T06、R1-T08）都依赖 R5-T99。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包、ST 语义只在兼容插件里实现。
- I10 的扫描会把测试文件里出现的 `privatePath` 字样当成私有数据路径；测试变量不要用这个名字。
- 整轮门禁在 Windows 上并行跑 100 多个测试文件时，单个测试耗时可以比单独运行高十几倍。新建要跑数据库或文件系统的测试必须显式设置超时；`afterEach` 删除临时目录用 `rmSync` 时带上 `maxRetries` 与 `retryDelay`。
