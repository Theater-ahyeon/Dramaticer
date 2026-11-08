# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：157
- 任务：R5-T05.b 聊天对话：路径、虚拟列表、块渲染与流式回合
- 结果：完成，门禁通过（132 个测试文件、1165 个测试通过，3 个 live 跳过，共 1168 个）。
  - 按 `GET /api/stories/:id/path` 渲染当前路径；向上滚动触发 `before` 分页，服务端页以当前最早楼层结尾，客户端按 id 去重向前拼接；加页后按旧楼层的新偏移恢复视口。
  - 虚拟列表每次渲染按 `ResizeObserver` 测量到的楼层高度（未测量按 200px 估算）算出可见区间，2000 楼夹具实测 DOM 里只有 9 个楼层；每次回合完成或 head 更新后重新取最新 60 楼并滚到底部，“回到底部”按钮只在离开底部时出现。
  - SSE 归并写在 `packages/web/src/chat/stream-state.ts`：`turn.started` 记用户楼层 id，正文与思考分别累加，`blocks.replace` 替换块快照，`tool.call` 追加，`turn.completed` 保留已收到的正文并在为空时用楼层原文补齐，`turn.error` 只记消息。停止用 AbortController；服务端保存部分正文，客户端轮询路径直到新助手楼层出现。
  - 失败后按 `resolveRetryAction` 三选一：没写用户楼层→重发；有用户楼层且有助手楼层→对该助手楼层重新生成；只有用户楼层→提示换一条行动，不提供会重复写楼层的按钮。
  - 块组件在 `packages/web/src/components/chat/BlockContent.tsx`：选项、页眉、悄悄话、旁白、备忘、状态栏、分析、图片各有原生呈现；`thinking` 折叠；`变量更新`、`state_update`、`plot_note` 不显示；未闭合块显示带开标签的原文；未注册标签由解析器保留为文本。图片块内容为单个 `data:image/` 或 http 地址时渲染 `<img>`，其他内容显示原文。
  - 选项行点击把该行原文填入输入框并调用 `recordChoice`（`POST /api/nodes/:id/choice`），不自动发送；实测写出一条 `choice` 记录，`nodeId` 为含该选项块的助手楼层。最新助手楼层（head 结尾）显示“重新生成”，实测走 SSE 后路径里旧楼层被新兄弟替换，并写出一条 `swipe` 记录。
  - 回合统计条显示 `stateDiffs` 条数、按线索 id 去重的新建（`status` 为 `open`）与兑现（`fulfilled`）条数、首字延迟。
  - 模式：输入框旁只有一个禁用的“快回合”下拉，单轮请求固定带 `mode: "fast"`；R3b 之前的深回合不在界面出现，任何服务端 400 都通过 `ErrorNotice` 显示原因。
  - core 新增浏览器安全入口 `@dramaticer/core/blocks`（`dist/blocks/index.js`，只含块解析、类型与选项行读取，不引入 better-sqlite3）；`readOptionLines` 同时被 `packages/st-compat/src/preferences/export.ts` 复用，选项配对规则只有一处。
  - `packages/web` 增加 `@dramaticer/core` 的 `workspace:*` 依赖（工作区依赖不登记 DEPENDENCIES）；`pnpm-lock.yaml` 已更新。
  - 新增 5 个 web 测试文件共 22 个测试（路径分页 3、虚拟窗口 5、流式归并 7、回合统计 2、块呈现 5），全部纯逻辑、零网络。
  - 冒烟：真实 server 加本地假 OpenAI 兼容渠道（`.devloop/scratch/`，已删除）跑通逐字流式、停止保留部分正文、失败提示、重新生成与选项点击；390×844 与 1280×900 无横向滚动。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0-T01 至 R0-T05、R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、R1-T02.1、R1-T02.2、R1-T02.3、R1-T02.4、R1-T02.a、R1-T02.b、R1-T03、R1-T04.a、R1-T07、R1-T07.a、R1-T07.b.a、R1-T07.b.b、R1-T07.b.c、R1-T07.b.d、R1-T07.b.d.a、R1-T07.b.d.b、R1-T99、R3-T01、R3-T02、R3-T03、R3-T04、R3-T99、O-T01、O-T02、O-T03、O-T99、O-T01.a、O-T99.a、R2-T01、R2-T02、R2-T03、R2-T03.a、R2-T03.b、R2-T04、R2-T04.a、R2-T05、R2-T06、R2-T07、R2-T07.a、R2-T08、R2-T09.a、R2-T09.b、R2-T09.c、R2-T99、R5-T01、R5-T02、R5-T02.a、R5-T02.b、R5-T02.c、R5-T04、R5-T05.a、R5-T05.b、E-T01、R4-T00、R4-T01、R4-T02、R4-T03、R4-T04、R4-T05、R4-T06、R4-T07、R4-T08、R4-T99、R5-T00。完成记录与验收标准见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- **下一个可做任务是 R5-T05.c（聊天候选：候选行动与开场候选）**：依赖 R5-T05.b、R5-T02.c、R5-T02，全部满足。执行顺序见 TASKS 的 R5 段落：R5-T05.c → R5-T06 → R5-T07 → R5-T11，然后第二段。
- R5 的已知接口缺口（R5-T00 定下的任务范围，尚未做的部分）：
  - 变更卡只有 `GET /api/stories/:id/proposals`，没有批准、拒绝与回滚接口（R5-T07.a）；CLI 用 `approveLedgerChangeCard`、`rejectLedgerChangeCard`、`rollbackLedgerChangeCard`。
  - 故事设置接口是 `GET`/`PUT /api/stories/:id/settings`（不是 PATCH）。
  - 渠道管理接口 `GET`/`PUT /api/channels` 还没有（R5-T03）。
  - `blocks.replace` 的 `ParsedContent` 不含块显示策略；`BlockDisplayStrategy` 在 core 的块注册表里，R5-T11 负责把它带进事件载荷。
- v3 阶段顺序：R3 快回合 → O 开局与方向 → R2 评测底座 → E 排障 → R4 → R5（最小界面先做）→ M6 生图第一批 → R1 续 记忆增强 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045。
- HUMAN-09 待处理（不阻塞）：`data/channels.yaml` 已有 `bg-fallback`、`main-fallback`、`codex`，`channels.example.yaml` 还没有这三个别名。
- HUMAN-10 待处理（不阻塞）：插件不变量是否加进 AGENTS.md。
- HUMAN-11 待处理（不阻塞）：`.env` 的正文模型 `opendesign/deepseek-v4.1-flash` 返回 membership entitlement 错误。
- HUMAN-12 待处理（不阻塞）：HUMAN.md 条目仍描述 `roles.judge` 指向 `codex`，实际配置已是 `judge`（`auto/glm-5.3`）。
- HUMAN-13 待处理（不阻塞）：`catie` 的 `rp`（`agy-gemini-3.8-flash-medium`）返回 503「没有可用的 Antigravity 凭证」，影响 `roles.writer`；R2-T99 的真实分支点验证改用 `main-fallback`。凭证恢复后可用 `node scripts/r2-legacy-forgetting.mjs run-all --concurrency 3` 补齐 45 道失败题。
- 数据库 schema 版本 33（v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 历史块策略、v23 事件抽取记录、v24 变更卡、v25 合并调用开关与执行记录、v26 间隙档位阈值与丢弃状态、v27 合并调用丢弃条目、v28 回合模式与读取工具软上限、v29 开局包与故事级后台任务、v30 首楼开场候选、v31 偏好记录、v32 导演计划与拍状态、v33 导演候选行动）；R1 续原计划的 v32–v35 顺延为 v34–v37；插入新迁移时后续编号一起顺延。
- server 的回合路径会补建并执行后台任务：`handleTurnStream` 在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain，故事之间先来先做。`schedule` 的 drain 只跑 `resolveStoryBackgroundKinds` 过滤后的类型。
- 故事级任务入队：`StoryStore.enqueueStoryBackgroundJobs` 按种类写入 `node_id` 为空的 `background_jobs` 行；创建故事与导入卡的路由先调用 `enqueueOpeningBackgroundJobs`（按两个 `needsRun` 过滤）再 `schedule`。`POST /api/stories/:id/openings/generate` 无条件入队一条 `opening_candidates`（仅要求故事无楼层），同样的 `enqueueStoryBackgroundJobs` 在任务已完成时把同一行翻回 `pending`，所以连续手动生成的 `jobId` 相同。
- 开场候选自动入队只在有素材、无楼层且无待选候选时发生；生成处理器本身只检查“故事没有楼层”，手动任务与生成接口每次追加一批。
- 分支与面板接口已可用。`GET /api/nodes/:id/ledger` 返回 `{state, facts, diffs}`，`facts` 来自 `readLedgerFacts`，`diffs` 只含该楼层自己的写入。
- 路径接口：`GET /api/stories/:id/path?nodeId=&limit=&before=`，返回 `{storyId, headNodeId, nodes, hasMore}`。`nodeId` 是锚点、缺省 head，锚点节点包含在返回路径里；`before` 必须在本故事且在该锚点的路径上，返回它之前的 `limit` 楼；`hasMore` 只在返回页之前还有楼层时为真。响应里 `nodes` 一定是根到页末楼的连续顺序。
- web 包结构：`src/api/{client,sse,index}.ts`；`src/chat/{path-state,virtual-window,stream-state,turn-summary,blocks}.ts`（纯逻辑）；`src/components/chat/{ChatFloorList,ChatFloorView,BlockContent,StreamingBubble,Composer}.tsx`；`src/pages/*`、`src/pages/story/*`、`src/components/ErrorNotice.tsx`、`src/styles.css`。`src/api/index.ts` 导出单例 `api`。开发用 `pnpm --filter @dramaticer/web dev`（Vite 默认 5173，`/api` 代理到 `http://127.0.0.1:8787`）；server 默认从 `packages/web/dist` 提供静态文件，找不到文件回退 `index.html`。
- 聊天页每轮生成完成后重新取最新 60 楼并丢弃旧的向上分页；`PAGE_SIZE` 60、分页阈值 240px、自动贴底阈值 96px、楼层高度估算 200px、overscan 600px。
- 偏好记录已闭环：记录写入（四种信号）→ `POST /api/nodes/:id/choice` → `preferences export` 产出回复对 → `pairwise` 盲测与评分 → `scoreboard` 汇总。重新生成与 `swipeNode` 都写 `swipe`；私有库目前没有任何 `preference_events`。
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`。只读、零模型调用；导演决策从助手楼层的父楼层读（`director_decisions` 写在生成时的消息楼层上）。记忆槽位的 `retrieval` 只在槽位真正注入内容时写进 Trace；没有命中时该槽位记为 `missing-slot`。上下文分段行会显示 suffix 槽位的 `appendedTo`。`explain` 不受导演模式影响，盲盒下仍然显示完整指令与信号。第 7 段显示当前拍与 `director_beat_states` 记录（节拍 id、完成楼层、`completed`、是否已前进），只读。
- 导演计划接口：`readDirectorPlan` 按 `ordinal` 还原弧线、序列、节拍；`--set` 与 `PUT /api/stories/:id/director/plan` 都整份替换并把所有行标为 `player`，`mergePlannedArcs` 只更新或追加 `model`/`import` 行，永不删除、不覆盖 `player` 行。`resolveCurrentBeat` 沿路径最近一条 `director_beat_states` 前进：完成则到下一拍（跨序列），未完成停在原地，无状态取第一拍，耗尽返回 null；记录指向已不存在的节拍时跳过该记录，仍无有效记录则回到第一拍。`readDirectorPlan` 与 `resolveCurrentBeat` 的入参是 `DirectorPlanReader`/`DirectorBeatResolver`（`Pick<StoryStore, …>`）。
- 导演规划器（R4-T02）：`directorPlanNeedsRun` 需要角色卡或台账素材；计划为空时补建，head 上 `resolveCurrentBeat` 返回 null 时补建，head 为空或当前拍仍可解析时不补建。`plannerClient` 在 `dramaticer work` 与 server 里用 `roles.planner` 建立，缺省回退到 `background`。
- 导演强度与注入（R4-T03、R4-T04）：`DirectorConfig.intensity` 与 `openingIntensity` 共用 `DirectorIntensity`（`setup`、`natural`、`detonate`）；机制优先级固定为重复正文 40、开场 35、线索过老 30、场景重复 25、节拍 23、线索过多 20、事件池 10、节奏 5；`createDirectorSlotProvider` 返回带 `config`、`mechanisms` 的 `DirectorSlotProvider`，`provide` 返回空的 `messages` 与 `suffix`（`【导演】` 加指令与 `DIRECTOR_SUFFIX_NOTE`）；组装器在预算裁剪后把 suffix 接在最后一条 user 消息末尾，Trace 记 `appendedTo: "last-user"`。
- 导演模式（R4-T05）：`DirectorConfig.mode` 取 `off`、`transparent`、`blind`，默认 `transparent`；旧配置的 `enabled` 在读取时映射后丢弃。`GET /api/nodes/:id/director` 返回 `{nodeId, mode, decision}`，盲盒下 `decision.directive` 为 null 且没有 `signals`。
- 节拍完成检测（R4-T06）：结算窗口的 `beats` 按楼层父节点解析；`applySettlementProposals` 写 `director_beat_states` 的时机在结算记录之后、同一事务内。模型没有给该楼层条目、楼层被拒绝、或按路径解析出的拍与提示词里的拍不同时不写状态。
- 候选行动（R4-T07）：`candidate_actions` 按 `settled` 为每个已生成完成的助手楼层建任务，档位 `gap`；`parseCandidateActionsResponse` 是唯一校验口；写入顺序固定为 4 条 `action` 再 1 条 `scene_change`；`GET /api/nodes/:id/actions` 只按楼层读取，不跟随 head。
- `extensions.dramaticer` 有三个键：`events`、`npcAgendas`、`arcs`；`arcs` 的校验全部复用 `parseDirectorPlan`，导入来源固定为 `import`。
- R4 验收的链路证据在 `packages/core/test/director-acceptance.test.ts` 与 `docs/dev/reports/R4.md`。

## 下一步
- **R5-T05.c 聊天候选**：回合完成后读 `GET /api/nodes/:id/actions`，按楼层显示 4 条行动与 1 条场景变化，点击只填输入框不自动发送；故事无助手楼层时读 `GET /api/stories/:id/openings?status=pending` 显示候选原文，选中走 `POST /api/stories/:id/openings/:id/pick` 后刷新路径，“重新生成”走 `POST /api/stories/:id/openings/generate` 并轮询到新一批；模式锁定写 `PUT /api/stories/:id/settings` 的 `turnMode`，只由玩家操作。聊天页插入候选区域的接线点在 `packages/web/src/pages/story/ChatPage.tsx`，`api.getActions`、`api.getOpenings`、`api.generateOpenings`、`api.pickOpening`、`api.updateSettings` 已存在于 `ApiClient`。
- 之后按顺序做 R5-T06（分支视图，依赖 R5-T05 整段）、R5-T07（台账只读）、R5-T11（沙箱块渲染）；再进入第二段 R5-T03、R5-T07.a、R5-T08、R5-T09、R5-T10。
- R5-T08 只依赖 R5-T04、R5-T02、R4-T99，计划、决策、候选与线索接口已经可用。
- 引用评测数字时：B1 必须同时说明同模型子集为空、每个对话每档只有 1 个样本；遗忘矛盾率必须同时说明失败题数与可判定样本数；偏好一致率当前没有样本。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 记分牌重新生成（仓库根目录执行）：
  `node packages/st-compat/dist/evalset/scoreboard-cli.js --playtest eval-private/reports/forgetting/playtest --playtest eval-private/reports/forgetting/legacy/playtest --forgetting eval-private/reports/forgetting/runs --forgetting eval-private/reports/forgetting/legacy/runs --b1-samples eval-private/reports/R2-b1/samples.jsonl --b1-records eval-private/reports/R2-b1/records.jsonl --b1-quality eval-private/reports/R2-b1/quality.jsonl --out docs/dev/SCOREBOARD.md`
  或把同样参数交给 `pnpm --filter @dramaticer/st-compat scoreboard`；`pnpm --filter` 的工作目录是包目录，相对路径会按包目录解析，冒烟时用绝对路径。
- 记分牌日期取输入最新时间戳；输入都无时间戳时必须显式传 `--date`。测试覆盖“不传 `--date` 时从输入推导”。
- B1 历史回放的入口是 `pnpm --filter @dramaticer/st-compat replay-eval`（或直接跑 `packages/st-compat/dist/evalset/historical-replay-cli.js`）。分支点从导入历史的末端（消息序号最大的节点）取，不跟随已经生成的续写楼层；续跑用 `--resume`，只重算报告用 `--report-only`。
- 真实渠道实跑用 `--model main-fallback --judge-model judge`（`rp` 仍 503）；R2-T99 的分支点验证样本为第 401 楼、naive 档，数字见 `docs/dev/reports/R2.md`。
- B1 的默认报告与数据路径：`eval-private/reports/R2-b1.md`、`docs/dev/reports/R2-b1.md`、`eval-private/reports/R2-b1/{samples,records,quality}.jsonl`、种子库 `eval-private/reports/R2-b1/db/`。
- B1 的“同模型”是去掉 `auto/` 前缀后模型 id 逐字相同；“同家族”用 `modelFamily`。当前 3 个历史回复模型都与 `main-fallback` 不同名，同模型子集为空。
- `pairwise` 的样本语境是两份续写的共同父楼层路径（最近 6 楼）；B1 用同一个 `formatPairwiseContext`。历史回放判定新增 `PairwiseTask` 的 `historical`。
- 评分提示词的 system 段包含 `TTCW` 字样，测试里的假客户端靠它区分判定请求与评分请求；改提示词时同步 `pairwise.test.ts`、`historical-replay.test.ts` 与 `scoreboard.test.ts`。
- 质量评分同样本同一侧有多行时取最后一行；失败记录只计数，不进入均值；统计版不含故事 id、样本 id、理由与原文。
- `preferences export` 的 `--db` 是必填；导出结果在同一数据库上逐字节相同；选项选择按所选正文与同一选项块里未选中的行配对，重 roll 按被放弃与被接受楼层配对。选项行切分统一用 core 的 `readOptionLines`（聊天界面与导出共用）。重新生成写入的 `swipe` 与被放弃楼层同父，导出侧不需要额外字段。
- 遗忘评测（R2-T09.a）：`playtest --head` 只接受当前故事里存在的助手楼层，且不能与 `--resume` 同时使用；起点深度是设置 head 之后的 `getPathToHead` 长度。跑后批测必须同时给 `--questions-out` 与至少一个题目文件，题目文件里的 `story` 必须与 `--story` 一致。
- 跑后批测在最终 head 上提问；证据楼层不在当前路径上的题目记 `skipped`。遗忘分层固定为 `<100`、`100-199`、`200-299`、`300+`，用起点深度判定；编造数按「编造题且裁判判为矛盾」计算。
- `forgetting-report` 的 `--input` 可以是一个 JSON 或包含 JSON 的目录；私有版默认写 `eval-private/reports/R2-forgetting.md`，统计版默认写 `docs/dev/reports/R2-forgetting.md`。
- legacy 导入与运行驱动在 `scripts/r2-legacy-forgetting.mjs`：`import`、`branches`、`run`、`run-all`、`finalize`；续跑必须带 `--resume true`。
- 基准的入口是 `pnpm --filter @dramaticer/st-compat benchmark --generate|--validate|--import --db <path>`，`--root` 指定基准目录；`benchmarks/` 是生成产物，**不要手改**。
- 开局包的读取入口是 `readOpeningPack(store, storyId)`；校验用 `validateOpeningPackPayload(value, known)`；首楼候选解析用 `parseOpeningCandidatesResponse(text, expectedCount)`，不要另写一套。
- 自动试玩的入口是 `pnpm --filter @dramaticer/st-compat playtest`：每轮顺序是读间隙积压 → 模拟用户 → `runChatTurn` → swipe/edit/branch → 间隙后台任务 → 一致性探针 → 每轮裁判 → 写记录。`--seed` 只决定模拟用户的提示顺序与探针事实选择。
- 开场导演的楼层深度按当前路径助手楼层数计算；`openingFloors` 为 0 关闭；开局强度 `setup`、`natural`、`detonate` 的字段范围见 DESIGN §8.4。节拍机制的楼层深度用同一口径。
- 故事设置缺省值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 4096、`reasoning` `low`、`turnMode` `fast`、`maxReadRounds` 3、`historyBlockPolicy` `{mode:"default",overrides:{}}`、`gapPassEnabled` `false`、`gapPlanSeconds` 212、导演默认配置（含 `mode` `transparent`、`openingFloors` 10、`openingIntensity` `natural` 与 `intensity` `natural`）。
- 回合模式的解析口只有 core 的 `resolveTurnMode`（已导出）：单轮参数优先于故事设置，深回合直接抛错。server 在 `handleTurnStream` 里、建用户楼层之前先调用它，深回合按 400 返回，`details.path` 在请求给 `mode` 时是 `mode`，否则是 `turnMode`；`generateAssistantTurn` 收到解析后的模式并写进 Trace。web 聊天页目前固定发送 `mode: "fast"`，界面不展示深回合。
- 已注册的槽位是十一个：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol。默认模板顺序：character、lore、state、summary、memory、scene、director、user_will、history、（可选的 block_format）、protocol。`director` 槽位只返回 suffix，不产生 system 消息；不新增 `beat` 槽位。组装器的 suffix 用 `\n\n` 与玩家原文分隔；多个 suffix 之间用 `\n` 连接。
- 原生块类型是 12 个（`thinking`、`选项`、`状态栏`、`变量更新`、`分析`、`图片`、`页眉`、`悄悄话`、`旁白`、`备忘`、`state_update`、`plot_note`）；`thinking`、`变量更新`、`state_update`、`plot_note` 的上下文策略是删除。
- 历史槽位默认策略：更早楼层省略五个显示类块，最近 1 楼不套用这层省略；`full` 是改动前行为。设置项 `historyBlockPolicy` 存在 `story_settings.history_block_policy`。
- 结算窗口以 head 为终点（ADR-0046），取**最旧的** N 个未结算助手楼层；冲突检查窗口取 head 路径最后 `conflictWindowFloors` 楼。现场分析以被分析的楼层为锚点。`scene` 任务显式传 200 token 上限。
- 结算提示词只在 `SettlementWindow.beats` 非空时提 `beatCompleted`；`beatCompleted` 非布尔时该楼层整条拒绝，修复记录的 `path` 是 `["-"]`。`applySettlementProposals` 写拍状态的条件：该楼层出现在模型产出里、没有被拒绝、父节点处解析出的拍与提示词里的拍相同。
- 后台任务分两档：`gap` 每次间隙执行，`deferred`（`events`、`summary`、`npc_agenda`、`director_plan`）只在会话结束或间隙达到 `gapPlanSeconds` 时执行。`gap_pass` 默认关闭；`dramaticer work` 与 server 调度都不为关闭的故事补建。`candidate_actions` 是 `gap` 档。
- 后台任务连续失败 3 次才放弃；`user_will` 的 `sourceQuote` 必须逐字出现在玩家楼层里。后台任务需要等待其它任务时抛 `BackgroundJobDeferredError`；取消本轮时 `drain` 用 `options.signal`。
- 模型响应的磁盘缓存键包含 `max_tokens` **只在请求显式带 maxTokens 时**；改渠道配置的 `maxTokens` 后必须换一个 `--cache` 目录。后台 `background` 模型的输出上限是 32,768。
- 后台路由现状（2026-11-08）：`main-fallback`（`auto/deepseek-v4.1-flash`）可用；`opendesign/deepseek-v4.1-flash` 曾返回 membership entitlement 错误；`catie` 的 `rp` 返回 503（HUMAN-13）。`data/channels.yaml` 现在是 `writer: rp`、`judge: judge`（`auto/glm-5.3`）；`roles.planner` 未配置，回退到 `background`。
- 渠道角色（`writer`、`settler`、`planner`、`judge`）与消息角色不同；`createLlmClient` 校验 judge 与 writer 的模型家族不同。server 运行时为 writer、settler、planner 各建一个客户端；`dramaticer work` 建 settler 与 planner 两个客户端。
- 工具传输：`resolveToolTransport` 在未显式配置时按 `probe.functionCalling` 决定；文本协议是 `core/src/chat/tool-protocol.ts`，工具说明只插进发给模型的消息副本。
- 写作规则：`WRITING_CONTRACT` 是四条原则；`protocol` 是固定 id 的静态段，`assertContextTemplate` 要求它是最后一个片段。
- 快照：`eval-private/raw/` 有 94 个文件；`eval-private/reference/` 有 5 部参照小说。私有数据只写 `eval-private/`，报告不用原文。
- F0 的私有产物：`eval-private/f0/` 下的 pairs、attribution、judge、fulltext 系列与 `llm-cache/`；R3 的产物：`docs/dev/reports/R3.md`、`R3-fast.md`；O 的产物：`docs/dev/reports/O-opening.md`；R2 的产物：`docs/dev/reports/R2.md`、`R2-judge.md`、`R2-pairwise.md`、`R2-b1.md`、`R2-forgetting.md`、`docs/dev/SCOREBOARD.md`；R4 的产物：`docs/dev/reports/R4.md`。
- HUMAN-03（事件题抽查）仍未完成，不阻塞。M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。
- 插件系统在 DESIGN §19 是唯一权威；C 线兼容插件任务依赖 P2。记忆增强任务（R1-T03.a、R1-T03.b、R1-T04.b、R1-T05、R1-T06、R1-T08）都依赖 R5-T99。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包、ST 语义只在兼容插件里实现。
- I10 的扫描会把测试文件里出现的 `privatePath` 字样当成私有数据路径；测试变量不要用这个名字。**测试文件里也不能出现 http 地址**（包括字符串字面量），图片地址用 `data:image/...`。
- 整轮门禁在 Windows 上并行跑 100 多个测试文件时，单个测试耗时可以比单独运行高十几倍。跑数据库或文件系统的测试必须显式设置超时（写 `it("…", { timeout: 30_000 }, async () => …)`，第三个参数的超时写法在 vitest 4 会报废弃），`afterEach` 删除临时目录用 `rmSync` 时带上 `maxRetries` 与 `retryDelay`。
- `packages/core/test/` 与 `packages/st-compat/test/` 下的 `.tmp-*` 目录会被测试创建；它们在 gitignore 里，不要提交。
- `packages/st-compat` 与 `packages/server` 在测试里通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这两个包的测试前先执行 `pnpm run typecheck`（`tsc -b` 重新构建），否则会读到旧代码。
- web 的 `typecheck` 与 `build` 会先构建 core 与 protocol；单独跑 web 测试前同样需要这两个包的 `dist`（`packages/web` 通过 `@dramaticer/protocol` 与 `@dramaticer/core/blocks` 的 `dist` 解析）。
- `@dramaticer/core/blocks` 是浏览器安全子路径，只导出块解析、类型、视图与选项行读取；web 不要从 `@dramaticer/core` 根入口导入运行时函数（会带进 better-sqlite3）。
- web 的 Vite 开发服务器在当前环境只监听 `localhost`（IPv6 `::1`），用 `http://localhost:5173` 访问；`127.0.0.1` 会被拒绝连接。
- 聊天页的冒烟方式：用 `StoryStore` 造一个 2000 楼的故事库，`node packages/server/dist/cli.js --db <库> --port 8799 --web packages/web/dist --channels <假渠道配置>`；假渠道配置的 `apiKey` 必须写成 `${环境变量名}`，启动时给环境变量。流式界面验证用本地 OpenAI 兼容假渠道，不访问真实模型。
