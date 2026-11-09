# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话 189：检查 R5-T14.a 的监督进程（2026-11-09 08:42Z）
- 监督进程 pid 37352 存活，`supervisor.json` 的 `state` 是 `running`。第 1 次试玩调用从 08:13:07Z 开始，08:33:24Z 结束（退出码 0，14/60 轮）；第 2 次调用从 08:33:26Z 开始，20 分钟预算到 08:53Z 前后。
- 续跑文件 `eval-private/reports/r5-playtest.progress.json` 有 19 条 round 记录、0 个失败。第 2 次调用新增第 15–19 轮（第 19 轮 08:42:20Z），全部没有操作。
- 排期里的六项操作在第 3–9 轮全部完成：swipe 第 3、7 轮，edit 第 4、8 轮，branch 第 5、9 轮。`optionAt` 第 6、10 轮没有记录任何操作（这两轮没有出现选项块）。
- 候选行动面板没有出现：第 2 轮与第 6 轮（`schedule.candidateAt`）的 `candidateActions` 都是 `count: 0, visible: false`；第 14 轮起后台失败里新增 1 条 `candidate_actions`（此前 3 条失败都是 `scene`）。R5-T14.b 写报告时不能把这两项算作已验证。
- 开场候选只在第 1 轮出现（`count: 3, visible: true, pickedText: null`），第 2 轮起记录为 `null`。导演机制第 15–19 轮由 `beat` 命中（`beat-light-first`，`natural` 强度）；`opening` 未命中，原因是「当前路径已有 17 个助手楼层，不小于开场阈值 10」。
- 后台队列持续增长：第 1 轮 pending 3 → 第 19 轮 pending 145，running 1，failed 4。失败是 3 条 `scene`（`last_error` 为「现场分析返回了空内容」，每条已耗尽 3 次重试）与 1 条 `candidate_actions`。每轮 drain 上限 20 条，新增任务数持续超过执行数。
- 本会话没有启动第二个 server 或试玩，没有改代码；门禁沿用上次通过结果（148 个测试文件通过、3 个跳过，1301 个通过、3 个 live 跳过）。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T07.b.d.a 与 R1-T07.b.d.b）、R3、O、R2、E、R4、R5-T01 至 R5-T13。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- **R5-T14.a 正在进行，由会话外的监督进程执行**（2026-11-09 08:42Z：pid 37352，19/60 轮，0 失败）：
  - 状态文件 `.devloop/scratch/R5-T14/supervisor.json`；日志 `.devloop/scratch/R5-T14/supervisor.log`；续跑文件 `eval-private/reports/r5-playtest.progress.json`。
  - 会话只读状态：以 `supervisor.json` 的 `state` 为准，轮数以 `eval-private/reports/r5-playtest.progress.json` 里 `kind` 为 `round` 的 `records` 条目数为准（状态里的 `rounds` 只在每次调用结束时刷新）。`running` → 把当前轮数写进本文件并提交，结果 `PARTIAL`；`completed` → 核对 60 条 round 记录与两份报告，标记 `[x]`；`failed` → 读日志修复后重新启动监督进程。
  - 不要在会话里再启动 server 或直接跑 `pnpm playtest`；不要删除 `supervisor.lock`（除非确认进程已死）。
  - 需要重启监督进程时用：
    `powershell -NoProfile -Command '$p = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList "scripts/r5-playtest-supervisor.mjs","--config",".devloop/scratch/R5-T14/supervisor-config.json" -WorkingDirectory "E:\agentcoding\Dramaticer" -WindowStyle Hidden -PassThru; $p.Id'`
  - 配置：60 轮、每次调用 20 分钟、专用数据库与渠道、`maxInvocations` 20、连续失败上限 3、停滞上限 3。
  - 之后是 R5-T14.b（核对报告、写 `docs/dev/reports/R5.md`）与 R5-T99。
- v3 阶段顺序：R3 快回合 → O 开局与方向 → R2 评测底座 → E 排障 → R4 → R5（界面）→ M6 生图第一批 → R1 续 记忆增强 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078。
- HUMAN-09 待处理（不阻塞）：`data/channels.yaml` 已有 `bg-fallback`、`main-fallback`、`codex`，`channels.example.yaml` 还没有这三个别名。
- HUMAN-10 待处理（不阻塞）：插件不变量是否加进 AGENTS.md。
- HUMAN-11 待处理（不阻塞）：`.env` 的正文模型 `opendesign/deepseek-v4.1-flash` 返回 membership entitlement 错误。
- HUMAN-12 待处理（不阻塞）：HUMAN.md 条目仍描述 `roles.judge` 指向 `codex`，实际配置已是 `judge`（`auto/glm-5.3`）。
- HUMAN-13 待处理（不阻塞）：`catie` 的 `rp`（`agy-gemini-3.8-flash-medium`）返回 503「没有可用的 Antigravity 凭证」，影响 `roles.writer`；凭证恢复后可用 `node scripts/r2-legacy-forgetting.mjs run-all --concurrency 3` 补齐 45 道失败题。真实 60 轮试玩使用 `.devloop/scratch/R5-T14/channels.yaml`，其中 `roles.writer` 指向 `main-fallback`；`data/channels.yaml` 的 `roles.writer` 也已改为 `main-fallback`。
- HUMAN-14 待处理（不阻塞）：用户当前的 TauriTavern 使用 `gemini-4-argon`（Vertex AI 服务账号）。本项目渠道只支持 OpenAI 兼容接口，不能直接复用该路由；如需 Gemini 4 作为正文模型，请提供一个 OpenAI 兼容端点与密钥变量。
- 数据库 schema 版本 33（v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 历史块策略、v23 事件抽取记录、v24 变更卡、v25 合并调用开关与执行记录、v26 间隙档位阈值与丢弃状态、v27 合并调用丢弃条目、v28 回合模式与读取工具软上限、v29 开局包与故事级后台任务、v30 首楼开场候选、v31 偏好记录、v32 导演计划与拍状态、v33 导演候选行动）；R1 续原计划的 v32–v35 顺延为 v34–v37。
- server 的回合路径会补建并执行后台任务：`handleTurnStream` 在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain，故事之间先来先做。`schedule` 的 drain 只跑 `resolveStoryBackgroundKinds` 过滤后的类型，并带 `sessionEnded: true`，所以每轮结束后延后档（事件、摘要、NPC 议程、导演计划）也会执行。
- 故事级任务入队：`StoryStore.enqueueStoryBackgroundJobs` 按种类写入 `node_id` 为空的 `background_jobs` 行；创建故事与导入卡的路由先调用 `enqueueOpeningBackgroundJobs`（按两个 `needsRun` 过滤）再 `schedule`。`POST /api/stories/:id/openings/generate` 无条件入队一条 `opening_candidates`（仅要求故事无楼层），同一行已完成时翻回 `pending`。
- 分支与面板接口已可用。`GET /api/nodes/:id/ledger` 返回 `{state, facts, diffs}`，`facts` 来自 `readLedgerFacts`，`diffs` 只含该楼层自己的写入。`GET /api/nodes/:id/events` 的 `limit` 默认 100、回显实际 `limit` 与 `offset`；`GET /api/nodes/:id/compressions` 返回 `{nodeId, compressions}`。
- 变更卡接口：`GET /api/stories/:id/proposals?status=` 默认 `pending`，接受 `all` 与四个状态；`POST /api/proposals/:id/approve|reject|rollback` 复用 core 的三个函数，返回 `{card, ledger}`。`LedgerChangeCardError` 的 `not_found` 映射 404、`invalid_status` 映射 409；批准玩家来源卡片会同时写 `userWill`；回滚只恢复 `before` 里的路径。
- 路径接口：`GET /api/stories/:id/path?nodeId=&limit=&before=`，返回 `{storyId, headNodeId, nodes, hasMore}`。`nodeId` 是锚点、缺省 head，锚点节点包含在返回路径里；`before` 必须在本故事且在该锚点的路径上，返回它之前的 `limit` 楼；`hasMore` 只在返回页之前还有楼层时为真。`limit=1` 且带 `nodeId` 时只返回锚点自己。自动试玩用这个口径逐轮取用户与助手楼层，以及编辑/分支目标。
- 分支接口的 head 语义：`appendNode` 自带把 head 移到新节点，所以 `swipeNode`、`editNode`、重新生成写完楼层后 head 已经是新楼层，不需要再调用 `POST /head`；`setHead` 只在树里主动切分支时使用。
- 块载荷：`DisplayedContent` 是协议层的渲染载荷，`display` 为 `null` 表示没有显示策略、按原文显示；`html` 模板的 `{{content}}` 由 web 用 `escapeHtml` 替换，模板字符串只进入 iframe 的 `srcdoc`。本地历史楼层仍然在客户端用 `parseBlocks(node.raw)` 再 `toDisplayedBlocks`。
- web 包结构：`src/api/{client,sse,index}.ts`；`src/chat/{path-state,virtual-window,stream-state,turn-summary,blocks,sandbox,candidate-actions,opening-candidates,branch-tree,ledger-view,proposal-view,director-view,composer-draft,settings-form,template-form,channels-form,format}.ts`；`src/playtest/{records,stats,report,user,progress}.ts`（纯逻辑，Node 与浏览器都可导入）；`src/components/…`、`src/pages/*`、`src/pages/story/*`、`src/styles.css`。`@dramaticer/core/blocks` 是浏览器安全子路径；web 的界面代码不要从 `@dramaticer/core` 根入口导入运行时函数（`src/playtest` 只导入类型）。
- 聊天页每轮生成完成后重新取最新 60 楼并丢弃旧的向上分页；`PAGE_SIZE` 60、分页阈值 240px、自动贴底阈值 96px、楼层高度估算 200px、overscan 600px。候选行动与开场候选的轮询间隔都是 2 秒、上限 15 次；两个面板在聊天面板里最高占 40vh。
- 聊天页的回合模式取自 `GET settings` 的 `turnMode` 并作为 `mode` 发送；settings 尚未取到时按 `fast`。锁定为深回合时下拉框只显示当前值（不可选），旁边出现「切回快回合」按钮走 `PUT settings`；深回合不在可选项里（DESIGN §10.1）。
- 分支页：路径高亮按完整路径 id 集合；head 行用 `focusSignal` 触发 `scrollIntoView`（0 表示还没加载）。树里只有 `childIds.length > 0` 才能折叠；`describeHeadSwitch` 是切换提示的唯一文案来源。自动试玩编辑时先点 `.branch-row-head .branch-select`，等 `.branch-detail-raw` 出现再点「编辑正文」；分支切换按 `.branch-preview` 的精确文本定位兄弟节点，再「切换到此楼层」→「确认切换」。
- 台账页：楼层选择复用 `BranchTree`，`focusSignal` 固定 0；`selectedId` 变化时并行取 ledger、events 第一页与 compressions，`requestRef` 序号防止旧响应覆盖；故事级 clues/entities/lore 与 `proposals?status=all` 只在 storyId 变化时取一次。事件每页 20，下一页 offset 等于已收到条数，`appendEventPage` 按 id 去重。facts 的「写入时间」取树节点的 `createdAt`。
- 台账页变更卡：按状态分组展示，待审卡有批准与拒绝、已批准卡有回滚、已拒绝显示拒绝原因；`cardBusyId` 请求期间禁用全部按钮，`storyEpoch` 丢弃切故事后的响应。
- 导演页：楼层选择同样复用 `BranchTree`；`selectedId` 变化时并行取 `director`、`actions` 与 `trace`；故事级设置、计划与线索只在 storyId 变化时取一次。决策记录写在生成时的消息楼层上（助手楼层的父楼层），选中助手楼层时 `GET director` 通常返回 `decision: null`。盲盒模式下服务端省略整个 `signals`，前端不得推断指令。
- 导演页的计划编辑器直接操作 `DirectorPlan` 对象：新增条目的标题与拍内容为空，保存时由服务端 `parseDirectorPlan` 拒绝并返回字段路径；`ErrorNotice` 显示 `details.path`。保存成功后 `plan` 与 `draftPlan` 同时替换。
- 跨面板候选行动：`setComposerDraft(storyId, text)` 写入模块级 Map，导演页随后 `navigate` 到聊天页；`ChatPage` 用 `composerStoryRef` 保证每个故事只消费一次（StrictMode 会重复执行 mount effect），读取后立即清空。草稿不持久化，刷新丢失。
- 偏好记录已闭环：记录写入（四种信号）→ `POST /api/nodes/:id/choice` → `preferences export` 产出回复对 → `pairwise` 盲测与评分 → `scoreboard` 汇总。重新生成与 `swipeNode` 都写 `swipe`；`editNode` 写 `edit`；`card_decision` 在批准与拒绝时由 `updateLedgerChangeCardStatus` 写入，回滚不写。
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`，只读、零模型调用；导演决策从助手楼层的父楼层读；`retrieval` 只在槽位真正注入内容时写进 Trace。`explain` 不受导演模式影响。
- 导演计划接口：`readDirectorPlan` 按 `ordinal` 还原弧线、序列、节拍；`--set` 与 `PUT /api/stories/:id/director/plan` 都整份替换并把所有行标为 `player`，`mergePlannedArcs` 只更新或追加 `model`/`import` 行，永不删除、不覆盖 `player` 行。`resolveCurrentBeat` 沿路径最近一条 `director_beat_states` 前进；`readDirectorPlan` 与 `resolveCurrentBeat` 的入参是 `Pick<StoryStore, …>`。
- 导演规划器（R4-T02）：`directorPlanNeedsRun` 需要角色卡或台账素材；计划为空时补建，head 上 `resolveCurrentBeat` 返回 null 时补建，head 为空或当前拍仍可解析时不补建。`plannerClient` 在 `dramaticer work` 与 server 里用 `roles.planner` 建立，缺省回退到 `background`。
- 导演强度与注入（R4-T03、R4-T04）：`DirectorConfig.intensity` 与 `openingIntensity` 共用 `DirectorIntensity`；机制优先级固定为重复正文 40、开场 35、线索过老 30、场景重复 25、节拍 23、线索过多 20、事件池 10、节奏 5；`createDirectorSlotProvider` 返回带 `config`、`mechanisms` 的 `DirectorSlotProvider`；组装器在预算裁剪后把 suffix 接在最后一条 user 消息末尾，Trace 记 `appendedTo: "last-user"`。
- 导演模式（R4-T05）：`DirectorConfig.mode` 取 `off`、`transparent`、`blind`，默认 `transparent`。节拍完成检测（R4-T06）：结算窗口的 `beats` 按楼层父节点解析；模型没有给该楼层条目、楼层被拒绝、或按路径解析出的拍与提示词里的拍不同时不写状态。
- 候选行动（R4-T07）：`candidate_actions` 按 `settled` 为每个已生成完成的助手楼层建任务，档位 `gap`；`parseCandidateActionsResponse` 是唯一校验口；写入顺序固定为 4 条 `action` 再 1 条 `scene_change`；`GET /api/nodes/:id/actions` 只按楼层读取，不跟随 head。
- `extensions.dramaticer` 有三个键：`events`、`npcAgendas`、`arcs`；`arcs` 的校验全部复用 `parseDirectorPlan`，导入来源固定为 `import`。R4 验收的链路证据在 `packages/core/test/director-acceptance.test.ts` 与 `docs/dev/reports/R4.md`。
- 设置页（R5-T09）：`GET /api/stories/:id/template` 返回故事实际使用的模板；内置默认模板不能直接保存，先「复制为新模板并设为默认」再编辑。「故事使用的模板」下拉只改表单草稿。模板校验（`assertContextTemplate`）也校验 `when`；server 把模板校验错误映射为 `details.path: "template"`。
- 设置表单校验与服务端同一套范围：`budgetTokens ≥ 0`、`maxTokens ≥ 1`、`temperature` 0–2、`maxReadRounds ≥ 0`、`gapPlanSeconds ≥ 0`、导演参数范围见 `DIRECTOR_NUMBER_FIELDS`；服务端错误路径由 `describeSettingsPath` 显示成中文名。
- 渠道角色（`writer`、`settler`、`planner`、`judge`）与消息角色不同；`createLlmClient` 校验 judge 与 writer 的模型家族不同。`resolveModelForRole` 缺省 writer→main、其余→background。模型 `enabled` 默认 true；停用后不能作为故事模型、角色目标或路由。
- 渠道管理接口（R5-T03、R5-T10）：三条路由只在 `channels.path` 存在时可用。`GET` 每次重读文件；`PUT` 是整份替换，没出现的渠道、模型、嵌入提供方与岗位都会被删除；`models` 里不写 `tools`/`probe`（保留原值），`enabled: true` 不落盘。`POST /api/channels/probe` 的 `channel` 缺省取模型第一个渠道；通道创建或体检抛错时返回 400 `渠道体检失败：<原因>`，`details.path` 为 `alias`。`ServerChannelsOptions.env` 同时用于解析 `${VAR}` 与报告 `apiKeySet`；变量完全不存在时 `GET` 直接 400。运行时缓存指纹包含 `roles`。
- 工具传输：`resolveToolTransport` 在未显式配置时按 `probe.functionCalling` 决定；文本协议是 `core/src/chat/tool-protocol.ts`，工具说明只插进发给模型的消息副本。e2e 的 writer 为确定性使用 `tools.transport: text`。
- 写作规则：`WRITING_CONTRACT` 是四条原则；`protocol` 是固定 id 的静态段，`assertContextTemplate` 要求它是最后一个片段。
- 已注册的槽位是十一个：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol。默认模板顺序：character、lore、state、summary、memory、scene、director、user_will、history、（可选的 block_format）、protocol。`director` 槽位只返回 suffix；组装器的 suffix 用 `\n\n` 与玩家原文分隔，多个 suffix 之间用 `\n` 连接。
- 原生块类型是 12 个（`thinking`、`选项`、`状态栏`、`变量更新`、`分析`、`图片`、`页眉`、`悄悄话`、`旁白`、`备忘`、`state_update`、`plot_note`）；`thinking`、`变量更新`、`state_update`、`plot_note` 的上下文策略是删除。`图片` 的显示策略是沙箱 HTML 模板。
- 历史槽位默认策略：更早楼层省略五个显示类块，最近 1 楼不套用这层省略；`full` 是改动前行为。设置项 `historyBlockPolicy` 存在 `story_settings.history_block_policy`。
- 结算窗口以 head 为终点（ADR-0046），取**最旧的** N 个未结算助手楼层；冲突检查窗口取 head 路径最后 `conflictWindowFloors` 楼。现场分析以被分析的楼层为锚点。`scene` 任务显式传 200 token 上限。
- 结算提示词只在 `SettlementWindow.beats` 非空时提 `beatCompleted`；`beatCompleted` 非布尔时该楼层整条拒绝，修复记录的 `path` 是 `["-"]`。
- 后台任务分两档：`gap` 每次间隙执行，`deferred`（`events`、`summary`、`npc_agenda`、`director_plan`）只在会话结束或间隙达到 `gapPlanSeconds` 时执行。`gap_pass` 默认关闭；`candidate_actions` 是 `gap` 档。后台任务连续失败 3 次才放弃；需要等待其它任务时抛 `BackgroundJobDeferredError`。
- 模型响应的磁盘缓存键包含 `max_tokens` **只在请求显式带 maxTokens 时**；改渠道配置的 `maxTokens` 后必须换一个 `--cache` 目录。后台 `background` 模型的输出上限是 32,768。
- 后台路由现状（2026-11-09）：`main-fallback`（`auto/deepseek-v4.1-flash`）与 `background` 可用；`opendesign/deepseek-v4.1-flash` 曾返回 membership entitlement 错误；`catie` 的 `rp` 返回 503（HUMAN-13）；网关的 `auto/gemini-3.8-flash` 返回 400「not allowed for user type personal_free_user」。`data/channels.yaml` 现在是 `writer: main-fallback`、`settler/planner: background`、`judge: judge`（`auto/glm-5.3`）。
- 快照：`eval-private/raw/` 有 94 个文件；`eval-private/reference/` 有 5 部参照小说。私有数据只写 `eval-private/`，报告不用原文。
- F0 的私有产物：`eval-private/f0/`；R3 的产物：`docs/dev/reports/R3.md`、`R3-fast.md`；O 的产物：`docs/dev/reports/O-opening.md`；R2 的产物：`docs/dev/reports/R2.md`、`R2-judge.md`、`R2-pairwise.md`、`R2-b1.md`、`R2-forgetting.md`、`docs/dev/SCOREBOARD.md`；R4 的产物：`docs/dev/reports/R4.md`；R5 的自动试玩产物在 R5-T14.a 生成。
- HUMAN-03（事件题抽查）仍未完成，不阻塞。M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。
- 插件系统在 DESIGN §19 是唯一权威；C 线兼容插件任务依赖 P2。记忆增强任务（R1-T03.a、R1-T03.b、R1-T04.b、R1-T05、R1-T06、R1-T08）都依赖 R5-T99。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包。
- 整轮门禁在 Windows 上并行跑 100 多个测试文件时，单个测试耗时可以比单独运行高十几倍。数据库或文件系统测试必须显式设置超时（`it("…", { timeout: 30_000 }, async () => …)`）；`afterEach` 删除临时目录用 `rmSync` 时带 `maxRetries` 与 `retryDelay`。
- `packages/core/test/` 与 `packages/st-compat/test/` 下的 `.tmp-*` 目录会被测试创建；它们在 gitignore 里，不要提交。
- `packages/st-compat` 与 `packages/server` 在测试里通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这两个包的测试前先执行 `pnpm run typecheck`。web 的 `typecheck` 与 `build` 会先构建 core 与 protocol。
- 沙箱消息的浏览器约束：srcdoc 沙箱在不带 `allow-same-origin` 时 `event.origin` 是字符串 `"null"`，读 `document.cookie` 会直接抛 `SecurityError`；Playwright 里要捕获这个异常。
- 聊天页、分支页、台账页、导演页、设置页与渠道页的手工冒烟脚本在 `.devloop/scratch/R5-T08`、`R5-T09`、`R5-T10`；`playwright-core` 在 `E:/agentcoding/node_modules` 可解析，Chromium 在 `%LOCALAPPDATA%/ms-playwright/chromium-1243/`。

## 下一步
- **R5-T14.a**：先读 `.devloop/scratch/R5-T14/supervisor.json` 的 `state`，轮数以 `eval-private/reports/r5-playtest.progress.json` 里 `kind` 为 `round` 的 `records` 条目数为准（本次为 19/60，第 2 次调用仍在进行，预算到 08:53Z 左右，结束后监督进程会自动开始下一次调用）。`running` 时只把当前轮数写进本文件、提交、结果写 `PARTIAL`，不要启动第二个 server 或试玩；`completed` 时核对续跑文件 60 条 round 记录、0 个失败与两份报告，标记 `[x]`；`failed` 时读 `supervisor.log` 修复后重新启动监督进程。
- **R5-T14.b**：核对统计版字段与 ADR-0033 口径（对比胜率、矛盾率、节拍余弦没有信号时保持「未证实」），在 `docs/dev/reports/R5.md` 引用统计版并写明模型别名、轮数与操作次数；重跑 `pnpm check`。按本次观察写清三处缺失：候选行动在第 2、6 轮都是 `count: 0`，后台积压且第 14 轮已有 1 条 `candidate_actions` 失败，不能算作已验证；开场候选只在第 1 轮出现（`count: 3, visible: true`），第 2 轮起记录为 `null`，第 6、10 轮没有选项块操作；`scene` 任务有 3 条因「现场分析返回了空内容」耗尽重试，不能把缺失算成零分析。
- 之后 R5-T99（R5 验收；会重跑 `pnpm check`、`pnpm e2e` 与 60 轮报告）。
- 引用评测数字时：B1 必须同时说明同模型子集为空、每个对话每档只有 1 个样本；遗忘矛盾率必须同时说明失败题数与可判定样本数；偏好一致率当前没有样本。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 记分牌重新生成（仓库根目录执行）：
  `node packages/st-compat/dist/evalset/scoreboard-cli.js --playtest eval-private/reports/forgetting/playtest --playtest eval-private/reports/forgetting/legacy/playtest --forgetting eval-private/reports/forgetting/runs --forgetting eval-private/reports/forgetting/legacy/runs --b1-samples eval-private/reports/R2-b1/samples.jsonl --b1-records eval-private/reports/R2-b1/records.jsonl --b1-quality eval-private/reports/R2-b1/quality.jsonl --out docs/dev/SCOREBOARD.md`
  或把同样参数交给 `pnpm --filter @dramaticer/st-compat scoreboard`；`pnpm --filter` 的工作目录是包目录，相对路径会按包目录解析。
- 记分牌日期取输入最新时间戳；输入都无时间戳时必须显式传 `--date`。
- B1 历史回放的入口是 `pnpm --filter @dramaticer/st-compat replay-eval`；分支点从导入历史的末端取，不跟随已生成的续写楼层；续跑用 `--resume`，只重算报告用 `--report-only`。
- 真实渠道实跑用 `--model main-fallback --judge-model judge`（`rp` 仍 503）；R2-T99 的分支点验证样本为第 401 楼、naive 档。
- `pairwise` 的样本语境是两份续写的共同父楼层路径（最近 6 楼）；B1 用同一个 `formatPairwiseContext`。评分提示词的 system 段包含 `TTCW` 字样，测试里的假客户端靠它区分判定请求与评分请求；改提示词时同步 `pairwise.test.ts`、`historical-replay.test.ts` 与 `scoreboard.test.ts`。
- 质量评分同样本同一侧有多行时取最后一行；失败记录只计数，不进入均值。
- `preferences export` 的 `--db` 是必填；选项选择按所选正文与同一选项块里未选中的行配对，重 roll 按被放弃与被接受楼层配对。选项行切分统一用 core 的 `readOptionLines`。
- 遗忘评测（R2-T09.a）：`playtest --head` 只接受当前故事里存在的助手楼层，且不能与 `--resume` 同时使用；跑后批测必须同时给 `--questions-out` 与至少一个题目文件，题目文件里的 `story` 必须与 `--story` 一致。证据楼层不在当前路径上的题目记 `skipped`；遗忘分层固定为 `<100`、`100-199`、`200-299`、`300+`。
- `forgetting-report` 的 `--input` 可以是一个 JSON 或包含 JSON 的目录。
- legacy 导入与运行驱动在 `scripts/r2-legacy-forgetting.mjs`：`import`、`branches`、`run`、`run-all`、`finalize`；续跑必须带 `--resume true`。
- 基准的入口是 `pnpm --filter @dramaticer/st-compat benchmark --generate|--validate|--import --db <path>`；`benchmarks/` 是生成产物，**不要手改**。
- 开局包的读取入口是 `readOpeningPack(store, storyId)`；校验用 `validateOpeningPackPayload(value, known)`；首楼候选解析用 `parseOpeningCandidatesResponse(text, expectedCount)`。
- 自动试玩的 CLI 入口是 `pnpm --filter @dramaticer/st-compat playtest`（纯 CLI 试玩，不驱动界面）；界面自动试玩是 `pnpm playtest`（R5-T13），两者不要混淆。CLI 试玩的每轮顺序是读间隙积压 → 模拟用户 → `runChatTurn` → swipe/edit/branch → 间隙后台任务 → 一致性探针 → 每轮裁判 → 写记录。
- 界面自动试玩（R5-T13）：`pnpm e2e` 会收集但跳过 `e2e/playtest/playtest.spec.ts`；`pnpm playtest` 先构建再跑 mobile project；`PLAYTEST_LIVE=1` 时 `playwright.config.ts` 不启动假 server，baseURL 默认 8787，`.env` 在用例里加载；模拟用户取 `roles.settler` 模型；报告默认路径见 `config.ts`（Windows 大小写不敏感，冒烟两份报告文件名不能只差大小写）；失败截图在 `.devloop/scratch/e2e/playtest/screenshots`。分支切换按 `.branch-preview` 精确文本定位，编辑会加〔试玩编辑第N轮〕前缀，保证预览可区分。
- 自动试玩续跑（2026-11-09）：live 默认 `PLAYTEST_RESUME=1`；续跑文件默认 `eval-private/reports/r5-playtest.progress.json`，每轮写完落盘，记录故事 id、数据库、渠道、标题、排期与全部轮次。续跑时复用故事，从上次编辑操作还原两个兄弟楼层，失败记录在下次运行时丢弃并重试该轮；跑满 60 轮才写报告。`PLAYTEST_RESUME=0` 新开一次，`PLAYTEST_TIME_BUDGET_MS` 控制单次调用预算。
- 会话外监督进程（R5-T14.a）：`scripts/r5-playtest-supervisor.mjs` 读 `.devloop/scratch/R5-T14/supervisor-config.json`；状态 `supervisor.json`、日志 `supervisor.log`、锁 `supervisor.lock`。它负责构建一次、启动 server、反复调用试玩直到 60 轮，完成后停掉 server。会话只用 `Start-Process` 启动它并读状态，不要再启动 server 或试玩。`baseUrl` 非空时复用已有服务（假 server 冒烟用）。
- 续跑文件、私有报告与截图都是私有产物，不能提交；它们分别在 `eval-private/` 与 `.devloop/scratch/`。
- 开场导演的楼层深度按当前路径助手楼层数计算；`openingFloors` 为 0 关闭。节拍机制的楼层深度用同一口径。
- 故事设置缺省值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 4096、`reasoning` `low`、`turnMode` `fast`、`maxReadRounds` 3、`historyBlockPolicy` `{mode:"default",overrides:{}}`、`gapPassEnabled` false、`gapPlanSeconds` 212、导演默认配置（`mode` `transparent`、`openingFloors` 10、`openingIntensity` `natural`、`intensity` `natural`）。
- 回合模式的解析口只有 core 的 `resolveTurnMode`：单轮参数优先于故事设置，深回合直接抛错。server 在写楼层之前调用它，深回合返回 400，`details.path` 在请求给 `mode` 时是 `mode`，否则是 `turnMode`。
- e2e 的假渠道细节（R5-T12）：`serve.mjs` 用固定端口 4517，`playwright.config.ts` 的 baseURL 与 webServer 都读 `E2E_APP_PORT`；假渠道用随机端口并写进每次重建的 `channels.yaml`。数据库固定在 `.devloop/scratch/e2e/work/e2e.db`，测试直接用 `node:sqlite` 读 `preference_events` 或插变更卡；Playwright 的 `page.request` 与浏览器共享登录 cookie。`vitest.config.ts` 必须继续排除 `packages/web/e2e/**`（但 `packages/web/src/playtest` 与 `packages/web/test/playtest-*` 的纯逻辑测试会进入门禁）。`@playwright/test` 固定 1.63.0，浏览器 revision 1243 已在本机，不要再升级到需要新浏览器的版本。
- `.devloop/scratch/` 已被 git 忽略，e2e 的临时数据库、截图与 trace、自动试玩的报告与截图都在里面。
