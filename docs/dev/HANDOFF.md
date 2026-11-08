# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：167
- 任务：R5-T12 Playwright 端到端
- 结果：完成，门禁通过（145 个测试文件、1289 个测试通过，3 个 live 跳过，共 1292 个）；`pnpm e2e` 的 10 个用例在 390×844 与 1440×900 两种视口下各跑一次，20 个全部通过（1.2 分钟）。
  - 新增 `packages/web/playwright.config.ts`：mobile 390×844（`isMobile`、`hasTouch`）与 desktop 1440×900 两个 project；`workers: 1`；失败时保留 trace 与截图，输出到 `.devloop/scratch/e2e/artifacts`；`webServer` 运行 `node e2e/serve.mjs`，等待 `http://127.0.0.1:4517/api/health`。
  - 新增 `packages/web/e2e/serve.mjs`：每次运行清空 `.devloop/scratch/e2e/work`，启动随机端口的假 OpenAI 兼容渠道，写一份临时 `channels.yaml`（`writer` 渠道 `/writer/v1`、`background` 渠道 `/background/v1`，`writer-model` 用 `tools.transport: text`，`roles` 指向 writer/background 两个模型），用 `StoryStore` 建一个 130 楼的 `e2e-pagination` 故事（根到 head 的链），再以固定端口 4517、密码 `e2e-password` 启动 server；收到 SIGTERM/SIGINT 时关闭两个服务。
  - 新增 `packages/web/e2e/fake-channel.mjs`：按路径分流 writer 与 background。writer 返回正文、`<thinking>`、`<选项>`、`<状态栏>`、`state_update`（人物状态与线索）与 `plot_note`；用户消息含「读取状态」且还没有工具结果时返回 `<tool name="state_get">{}</tool>`，走文本工具传输。background 按 system/developer 提示词分派：结算与事件返回 JSON（事件按请求里的 `<楼层 id="…" role="assistant">` 生成），摘要、现场分析、NPC 议程返回文本或 `[]`，导演计划、候选行动、开局包与 3 条开场候选返回固定合法 JSON。pi-ai 把 system 消息发成 `developer`，`systemText` 必须同时匹配两种角色。
  - 新增 `packages/web/e2e/helpers.ts`：登录、通过 `page.request` 创建故事并导入 JSON 卡（卡名「林雪」）、打开故事面板、发送回合（先等 `path` 楼层数增加且发送按钮恢复，避免在流式期间重复发送）、`pathNodeCount`/`totalNodeCount`、用 `node:sqlite` 统计 `preference_events`、直接插入变更卡做夹具、最后助手楼层 id、横向溢出断言。
  - 新增 8 个 spec 文件（10 个用例）：`auth`、`chat`（两轮对话、思考折叠、选项 `choice`、文本读取工具、重新生成 `swipe`；深回合锁定被服务端拒绝且楼层数不变，玩家点「切回快回合」写回设置）、`branches`（编辑、改写、切 head、旧分支保留）、`ledger`（本楼写入、线索、事件、实体、世界书、变更卡批准与拒绝、`card_decision` 计数）、`director`（决策、5 条候选行动、Trace 的模型/工具/回合模式、计划编辑、兑现线索）、`settings-channels`（设置保存、模板复制后编辑、渠道保存与密钥不显示）、`openings`（自动候选、重新生成追加一批、选中成为根楼层）、`pagination`（130 楼向上分页到最早楼层）。
  - 根 `package.json` 新增 `e2e` 脚本；`packages/web/package.json` 新增 `e2e`（先 `pnpm --filter @dramaticer/server... --filter @dramaticer/web... build`，再 `playwright test`）与 `@playwright/test` 1.63.0 依赖；`docs/dev/README.md` 增加「端到端测试」一节。
  - 新增根 `vitest.config.ts`，用 `configDefaults.exclude` 加 `packages/web/e2e/**`，否则 vitest 会把 Playwright spec 当单元测试加载。
  - 修复分支页桌面端横向溢出：`button.branch-select`、`.branches-layout`、`.branches-tree-pane`、`.branches-detail-pane`、`.branch-detail-raw` 加 `min-width: 0` 与最大宽度，楼层预览恢复省略号截断。
  - 浏览器使用本机已安装的 `chromium-1243`（`@playwright/test` 1.63.0 的默认 revision），不需要再下载。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0-T01 至 R0-T05、R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、R1-T02.1、R1-T02.2、R1-T02.3、R1-T02.4、R1-T02.a、R1-T02.b、R1-T03、R1-T04.a、R1-T07、R1-T07.a、R1-T07.b.a、R1-T07.b.b、R1-T07.b.c、R1-T07.b.d、R1-T07.b.d.a、R1-T07.b.d.b、R1-T99、R3-T01、R3-T02、R3-T03、R3-T04、R3-T99、O-T01、O-T02、O-T03、O-T99、O-T01.a、O-T99.a、R2-T01、R2-T02、R2-T03、R2-T03.a、R2-T03.b、R2-T04、R2-T04.a、R2-T05、R2-T06、R2-T07、R2-T07.a、R2-T08、R2-T09.a、R2-T09.b、R2-T09.c、R2-T99、R5-T01、R5-T02、R5-T02.a、R5-T02.b、R5-T02.c、R5-T04、R5-T05.a、R5-T05.b、R5-T05.c、R5-T06、R5-T07、R5-T07.a、R5-T11、R5-T03、R5-T08、R5-T09、R5-T10、R5-T12、E-T01、R4-T00、R4-T01、R4-T02、R4-T03、R4-T04、R4-T05、R4-T06、R4-T07、R4-T08、R4-T99、R5-T00。完成记录与验收标准见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- **下一个可做任务是 R5-T13（自动试玩框架）**：依赖 R5-T12、R5-T01、R2-T02、R2-T07，全部满足。之后按 TASKS 顺序是 R5-T14、R5-T99。
- v3 阶段顺序：R3 快回合 → O 开局与方向 → R2 评测底座 → E 排障 → R4 → R5（界面）→ M6 生图第一批 → R1 续 记忆增强 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078。
- HUMAN-09 待处理（不阻塞）：`data/channels.yaml` 已有 `bg-fallback`、`main-fallback`、`codex`，`channels.example.yaml` 还没有这三个别名。
- HUMAN-10 待处理（不阻塞）：插件不变量是否加进 AGENTS.md。
- HUMAN-11 待处理（不阻塞）：`.env` 的正文模型 `opendesign/deepseek-v4.1-flash` 返回 membership entitlement 错误。
- HUMAN-12 待处理（不阻塞）：HUMAN.md 条目仍描述 `roles.judge` 指向 `codex`，实际配置已是 `judge`（`auto/glm-5.3`）。
- HUMAN-13 待处理（不阻塞）：`catie` 的 `rp`（`agy-gemini-3.8-flash-medium`）返回 503「没有可用的 Antigravity 凭证」，影响 `roles.writer`；凭证恢复后可用 `node scripts/r2-legacy-forgetting.mjs run-all --concurrency 3` 补齐 45 道失败题。
- 数据库 schema 版本 33（v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 历史块策略、v23 事件抽取记录、v24 变更卡、v25 合并调用开关与执行记录、v26 间隙档位阈值与丢弃状态、v27 合并调用丢弃条目、v28 回合模式与读取工具软上限、v29 开局包与故事级后台任务、v30 首楼开场候选、v31 偏好记录、v32 导演计划与拍状态、v33 导演候选行动）；R1 续原计划的 v32–v35 顺延为 v34–v37。
- server 的回合路径会补建并执行后台任务：`handleTurnStream` 在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain，故事之间先来先做。`schedule` 的 drain 只跑 `resolveStoryBackgroundKinds` 过滤后的类型，并带 `sessionEnded: true`，所以每轮结束后延后档（事件、摘要、NPC 议程、导演计划）也会执行。
- 故事级任务入队：`StoryStore.enqueueStoryBackgroundJobs` 按种类写入 `node_id` 为空的 `background_jobs` 行；创建故事与导入卡的路由先调用 `enqueueOpeningBackgroundJobs`（按两个 `needsRun` 过滤）再 `schedule`。`POST /api/stories/:id/openings/generate` 无条件入队一条 `opening_candidates`（仅要求故事无楼层），同一行已完成时翻回 `pending`。
- 分支与面板接口已可用。`GET /api/nodes/:id/ledger` 返回 `{state, facts, diffs}`，`facts` 来自 `readLedgerFacts`，`diffs` 只含该楼层自己的写入。`GET /api/nodes/:id/events` 的 `limit` 默认 100、回显实际 `limit` 与 `offset`；`GET /api/nodes/:id/compressions` 返回 `{nodeId, compressions}`。
- 变更卡接口：`GET /api/stories/:id/proposals?status=` 默认 `pending`，接受 `all` 与四个状态；`POST /api/proposals/:id/approve|reject|rollback` 复用 core 的三个函数，返回 `{card, ledger}`。`LedgerChangeCardError` 的 `not_found` 映射 404、`invalid_status` 映射 409；批准玩家来源卡片会同时写 `userWill`；回滚只恢复 `before` 里的路径。
- 路径接口：`GET /api/stories/:id/path?nodeId=&limit=&before=`，返回 `{storyId, headNodeId, nodes, hasMore}`。`nodeId` 是锚点、缺省 head，锚点节点包含在返回路径里；`before` 必须在本故事且在该锚点的路径上，返回它之前的 `limit` 楼；`hasMore` 只在返回页之前还有楼层时为真。`limit=1` 且带 `nodeId` 时只返回锚点自己。
- 分支接口的 head 语义：`appendNode` 自带把 head 移到新节点，所以 `swipeNode`、`editNode`、重新生成写完楼层后 head 已经是新楼层，不需要再调用 `POST /head`；`setHead` 只在树里主动切分支时使用。
- 块载荷：`DisplayedContent` 是协议层的渲染载荷，`display` 为 `null` 表示没有显示策略、按原文显示；`html` 模板的 `{{content}}` 由 web 用 `escapeHtml` 替换，模板字符串只进入 iframe 的 `srcdoc`。本地历史楼层仍然在客户端用 `parseBlocks(node.raw)` 再 `toDisplayedBlocks`。
- web 包结构：`src/api/{client,sse,index}.ts`；`src/chat/{path-state,virtual-window,stream-state,turn-summary,blocks,sandbox,candidate-actions,opening-candidates,branch-tree,ledger-view,proposal-view,director-view,composer-draft,settings-form,template-form,channels-form,format}.ts`（纯逻辑）；`src/components/…`、`src/pages/*`、`src/pages/story/*`、`src/styles.css`。`@dramaticer/core/blocks` 是浏览器安全子路径；web 不要从 `@dramaticer/core` 根入口导入运行时函数。
- 聊天页每轮生成完成后重新取最新 60 楼并丢弃旧的向上分页；`PAGE_SIZE` 60、分页阈值 240px、自动贴底阈值 96px、楼层高度估算 200px、overscan 600px。候选行动与开场候选的轮询间隔都是 2 秒、上限 15 次；两个面板在聊天面板里最高占 40vh。
- 聊天页的回合模式取自 `GET settings` 的 `turnMode` 并作为 `mode` 发送；settings 尚未取到时按 `fast`。锁定为深回合时下拉框只显示当前值（不可选），旁边出现「切回快回合」按钮走 `PUT settings`；深回合不在可选项里（DESIGN §10.1）。
- 分支页：路径高亮按完整路径 id 集合；head 行用 `focusSignal` 触发 `scrollIntoView`（0 表示还没加载）。树里只有 `childIds.length > 0` 才能折叠；`describeHeadSwitch` 是切换提示的唯一文案来源。
- 台账页：楼层选择复用 `BranchTree`，`focusSignal` 固定 0；`selectedId` 变化时并行取 ledger、events 第一页与 compressions，`requestRef` 序号防止旧响应覆盖；故事级 clues/entities/lore 与 `proposals?status=all` 只在 storyId 变化时取一次。事件每页 20，下一页 offset 等于已收到条数，`appendEventPage` 按 id 去重。facts 的「写入时间」取树节点的 `createdAt`。
- 台账页变更卡：按状态分组展示，待审卡有批准与拒绝、已批准卡有回滚、已拒绝显示拒绝原因；`cardBusyId` 请求期间禁用全部按钮，`storyEpoch` 丢弃切故事后的响应。
- 导演页：楼层选择同样复用 `BranchTree`；`selectedId` 变化时并行取 `director`、`actions` 与 `trace`；故事级设置、计划与线索只在 storyId 变化时取一次。决策记录写在生成时的消息楼层上（助手楼层的父楼层），选中助手楼层时 `GET director` 通常返回 `decision: null`。盲盒模式下服务端省略整个 `signals`，前端不得推断指令。
- 导演页的计划编辑器直接操作 `DirectorPlan` 对象：新增条目的标题与拍内容为空，保存时由服务端 `parseDirectorPlan` 拒绝并返回字段路径；`ErrorNotice` 显示 `details.path`。保存成功后 `plan` 与 `draftPlan` 同时替换。
- 跨面板候选行动：`setComposerDraft(storyId, text)` 写入模块级 Map，导演页随后 `navigate` 到聊天页；`ChatPage` 用 `composerStoryRef` 保证每个故事只消费一次（StrictMode 会重复执行 mount effect），读取后立即清空。草稿不持久化，刷新丢失。
- 偏好记录已闭环：记录写入（四种信号）→ `POST /api/nodes/:id/choice` → `preferences export` 产出回复对 → `pairwise` 盲测与评分 → `scoreboard` 汇总。重新生成与 `swipeNode` 都写 `swipe`；`card_decision` 在批准与拒绝时由 `updateLedgerChangeCardStatus` 写入，回滚不写。
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
- 后台路由现状（2026-11-08）：`main-fallback`（`auto/deepseek-v4.1-flash`）可用；`opendesign/deepseek-v4.1-flash` 曾返回 membership entitlement 错误；`catie` 的 `rp` 返回 503（HUMAN-13）。`data/channels.yaml` 现在是 `writer: rp`、`judge: judge`（`auto/glm-5.3`）；`roles.planner` 未配置，回退到 `background`。
- 快照：`eval-private/raw/` 有 94 个文件；`eval-private/reference/` 有 5 部参照小说。私有数据只写 `eval-private/`，报告不用原文。
- F0 的私有产物：`eval-private/f0/`；R3 的产物：`docs/dev/reports/R3.md`、`R3-fast.md`；O 的产物：`docs/dev/reports/O-opening.md`；R2 的产物：`docs/dev/reports/R2.md`、`R2-judge.md`、`R2-pairwise.md`、`R2-b1.md`、`R2-forgetting.md`、`docs/dev/SCOREBOARD.md`；R4 的产物：`docs/dev/reports/R4.md`。
- HUMAN-03（事件题抽查）仍未完成，不阻塞。M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。
- 插件系统在 DESIGN §19 是唯一权威；C 线兼容插件任务依赖 P2。记忆增强任务（R1-T03.a、R1-T03.b、R1-T04.b、R1-T05、R1-T06、R1-T08）都依赖 R5-T99。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包。
- 整轮门禁在 Windows 上并行跑 100 多个测试文件时，单个测试耗时可以比单独运行高十几倍。数据库或文件系统测试必须显式设置超时（`it("…", { timeout: 30_000 }, async () => …)`）；`afterEach` 删除临时目录用 `rmSync` 时带 `maxRetries` 与 `retryDelay`。
- `packages/core/test/` 与 `packages/st-compat/test/` 下的 `.tmp-*` 目录会被测试创建；它们在 gitignore 里，不要提交。
- `packages/st-compat` 与 `packages/server` 在测试里通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这两个包的测试前先执行 `pnpm run typecheck`。web 的 `typecheck` 与 `build` 会先构建 core 与 protocol。
- 沙箱消息的浏览器约束：srcdoc 沙箱在不带 `allow-same-origin` 时 `event.origin` 是字符串 `"null"`，读 `document.cookie` 会直接抛 `SecurityError`；Playwright 里要捕获这个异常。
- 聊天页、分支页、台账页、导演页、设置页与渠道页的手工冒烟脚本在 `.devloop/scratch/R5-T08`、`R5-T09`、`R5-T10`；`playwright-core` 在 `E:/agentcoding/node_modules` 可解析，Chromium 在 `%LOCALAPPDATA%/ms-playwright/chromium-1243/`。

## 下一步
- **R5-T13 自动试玩框架**：在 `packages/web/e2e/playtest/` 用 Playwright 驱动真实界面；模拟用户由 `background` 模型生成（严格 JSON `{message}`，失败重试 3 次后终止并记录）；60 轮内至少 2 次重新生成、2 次编辑、2 次分支切换，并按配置点击候选行动与选项块（只填入输入框、不发送），轮次位置可配置。每轮记录序号、节点 id、用户与助手原文、回合模式、首字毫秒、用量、台账 diff 数、新建与兑现线索、导演决策、候选行动与开场候选的显示结果、截图路径；报告头写模型别名、配置与样本数。私有报告 `eval-private/reports/r5-playtest.md`，统计版 `docs/dev/reports/R5-playtest.md`，字段按 ADR-0033 §九并另加 `swipe`、`choice`、`edit`、`card_decision` 四种偏好信号条数（来自 `preference_events`）；统计版不出现故事名、角色名、原文与题目文本。验收要求假渠道下 5 轮冒烟跑通且不联网。可以复用 `e2e/serve.mjs`、`e2e/fake-channel.mjs` 与 `helpers.ts`，但 60 轮真实模型运行要单独的驱动入口。
- 之后 R5-T14（真实 60 轮试玩与报告）、R5-T99（R5 验收；会重跑 `pnpm e2e`）。
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
- 自动试玩的 CLI 入口是 `pnpm --filter @dramaticer/st-compat playtest`：每轮顺序是读间隙积压 → 模拟用户 → `runChatTurn` → swipe/edit/branch → 间隙后台任务 → 一致性探针 → 每轮裁判 → 写记录。`--seed` 只决定模拟用户的提示顺序与探针事实选择。
- 开场导演的楼层深度按当前路径助手楼层数计算；`openingFloors` 为 0 关闭。节拍机制的楼层深度用同一口径。
- 故事设置缺省值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 4096、`reasoning` `low`、`turnMode` `fast`、`maxReadRounds` 3、`historyBlockPolicy` `{mode:"default",overrides:{}}`、`gapPassEnabled` false、`gapPlanSeconds` 212、导演默认配置（`mode` `transparent`、`openingFloors` 10、`openingIntensity` `natural`、`intensity` `natural`）。
- 回合模式的解析口只有 core 的 `resolveTurnMode`：单轮参数优先于故事设置，深回合直接抛错。server 在写楼层之前调用它，深回合返回 400，`details.path` 在请求给 `mode` 时是 `mode`，否则是 `turnMode`。
- e2e 的假渠道细节（R5-T12）：`serve.mjs` 用固定端口 4517，`playwright.config.ts` 的 baseURL 与 webServer 都读 `E2E_APP_PORT`；假渠道用随机端口并写进每次重建的 `channels.yaml`。数据库固定在 `.devloop/scratch/e2e/work/e2e.db`，测试直接用 `node:sqlite` 读 `preference_events` 或插变更卡；Playwright 的 `page.request` 与浏览器共享登录 cookie。`vitest.config.ts` 必须继续排除 `packages/web/e2e/**`。`@playwright/test` 固定 1.63.0，浏览器 revision 1243 已在本机，不要再升级到需要新浏览器的版本。
- `.devloop/scratch/` 已被 git 忽略，e2e 的临时数据库、截图与 trace 都在里面。
