# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：166
- 任务：R5-T10 web 渠道管理面板
- 结果：完成，门禁通过（145 个测试文件、1289 个测试通过，3 个 live 跳过，共 1292 个）。
  - 新增 `packages/web/src/chat/channels-form.ts`：渠道、模型、嵌入提供方与四个岗位的草稿与整份更新；渠道 id、模型别名、嵌入 id 非空且唯一；服务地址非空；密钥字段只接受环境变量名（疑似密钥值直接被拒）；全部数值字段按服务端范围校验；模型渠道优先级按中英文逗号、顿号与空白拆分，引用必须存在且不重复；岗位别名必须存在且启用；writer 与 judge 用与服务端同一张关键词表检查模型家族；`describeChannelsPath` 把 `channels.*`、`models.*`、`embeddings.*`、`roles.*` 翻成中文；`describeProbe` 把体检的流式、函数调用、思考、预填充、用量、缓存统计与结构化输出翻成中文。
  - 协议 `ChannelsView` 新增 `configuredRoles`（显式配置的岗位），server 从 `config.roles` 直接读出。界面用它初始化岗位下拉：未配置的岗位保持空值，保存时不写回，缺省回落语义不被固定；`roles` 仍是实际生效别名，用于显示缺省回落。
  - `packages/web/src/api/client.ts` 新增 `getChannels`、`updateChannels`、`probeChannel`。`ChannelsPage` 重写：模型岗位四个下拉、模型卡片（别名、id、上下文、输出上限、渠道优先级、启用与思考开关、体检按钮与结果、删除）、渠道卡片（id、接口、地址、密钥变量名、四个限流参数、删除、密钥未设置的醒目提示）、只读嵌入提供方列表与保存/重置；保存前本地校验，服务端错误按字段路径显示；新增渠道与模型在保存后才能体检。
  - server 的 `POST /api/channels/probe` 现在把通道创建与体检抛出的错误转成 400，消息为 `渠道体检失败：<原因>`，`details.path` 为 `alias`；之前会落到 500「服务器内部错误」。
  - 新增 12 个 `channels-form` 测试、1 个 API 客户端测试与 1 个 server 体检失败测试。真实 server 加假通道与 Playwright 390×844 冒烟通过：未设置密钥提示、五项体检结果、体检失败原因、渠道修改保存后刷新仍在、新增渠道与新增模型、岗位显式值与缺省回落、writer 与 judge 同家族字段错误、`scrollWidth` 为 390。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0-T01 至 R0-T05、R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、R1-T02.1、R1-T02.2、R1-T02.3、R1-T02.4、R1-T02.a、R1-T02.b、R1-T03、R1-T04.a、R1-T07、R1-T07.a、R1-T07.b.a、R1-T07.b.b、R1-T07.b.c、R1-T07.b.d、R1-T07.b.d.a、R1-T07.b.d.b、R1-T99、R3-T01、R3-T02、R3-T03、R3-T04、R3-T99、O-T01、O-T02、O-T03、O-T99、O-T01.a、O-T99.a、R2-T01、R2-T02、R2-T03、R2-T03.a、R2-T03.b、R2-T04、R2-T04.a、R2-T05、R2-T06、R2-T07、R2-T07.a、R2-T08、R2-T09.a、R2-T09.b、R2-T09.c、R2-T99、R5-T01、R5-T02、R5-T02.a、R5-T02.b、R5-T02.c、R5-T04、R5-T05.a、R5-T05.b、R5-T05.c、R5-T06、R5-T07、R5-T07.a、R5-T11、R5-T03、R5-T08、R5-T09、R5-T10、E-T01、R4-T00、R4-T01、R4-T02、R4-T03、R4-T04、R4-T05、R4-T06、R4-T07、R4-T08、R4-T99、R5-T00。完成记录与验收标准见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- **下一个可做任务是 R5-T12（Playwright 端到端）**：依赖 R5-T01 至 R5-T11 与 R5-T02.a、R5-T02.b、R5-T02.c、R5-T05.a、R5-T07.a 子任务，全部满足。之后按 TASKS 顺序是 R5-T13、R5-T14、R5-T99。
- v3 阶段顺序：R3 快回合 → O 开局与方向 → R2 评测底座 → E 排障 → R4 → R5（最小界面先做）→ M6 生图第一批 → R1 续 记忆增强 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078。
- HUMAN-09 待处理（不阻塞）：`data/channels.yaml` 已有 `bg-fallback`、`main-fallback`、`codex`，`channels.example.yaml` 还没有这三个别名。
- HUMAN-10 待处理（不阻塞）：插件不变量是否加进 AGENTS.md。
- HUMAN-11 待处理（不阻塞）：`.env` 的正文模型 `opendesign/deepseek-v4.1-flash` 返回 membership entitlement 错误。
- HUMAN-12 待处理（不阻塞）：HUMAN.md 条目仍描述 `roles.judge` 指向 `codex`，实际配置已是 `judge`（`auto/glm-5.3`）。
- HUMAN-13 待处理（不阻塞）：`catie` 的 `rp`（`agy-gemini-3.8-flash-medium`）返回 503「没有可用的 Antigravity 凭证」，影响 `roles.writer`；R2-T99 的真实分支点验证改用 `main-fallback`。凭证恢复后可用 `node scripts/r2-legacy-forgetting.mjs run-all --concurrency 3` 补齐 45 道失败题。
- 数据库 schema 版本 33（v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 历史块策略、v23 事件抽取记录、v24 变更卡、v25 合并调用开关与执行记录、v26 间隙档位阈值与丢弃状态、v27 合并调用丢弃条目、v28 回合模式与读取工具软上限、v29 开局包与故事级后台任务、v30 首楼开场候选、v31 偏好记录、v32 导演计划与拍状态、v33 导演候选行动）；R1 续原计划的 v32–v35 顺延为 v34–v37；插入新迁移时后续编号一起顺延。
- server 的回合路径会补建并执行后台任务：`handleTurnStream` 在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain，故事之间先来先做。`schedule` 的 drain 只跑 `resolveStoryBackgroundKinds` 过滤后的类型。
- 故事级任务入队：`StoryStore.enqueueStoryBackgroundJobs` 按种类写入 `node_id` 为空的 `background_jobs` 行；创建故事与导入卡的路由先调用 `enqueueOpeningBackgroundJobs`（按两个 `needsRun` 过滤）再 `schedule`。`POST /api/stories/:id/openings/generate` 无条件入队一条 `opening_candidates`（仅要求故事无楼层），同样的 `enqueueStoryBackgroundJobs` 在任务已完成时把同一行翻回 `pending`，所以连续手动生成的 `jobId` 相同。
- 开场候选自动入队只在有素材、无楼层且无待选候选时发生；生成处理器本身只检查“故事没有楼层”，手动任务与生成接口每次追加一批。
- 分支与面板接口已可用。`GET /api/nodes/:id/ledger` 返回 `{state, facts, diffs}`，`facts` 来自 `readLedgerFacts`，`diffs` 只含该楼层自己的写入。`GET /api/nodes/:id/events` 的 `limit` 默认 100、返回体回显实际 `limit` 与 `offset`；`GET /api/nodes/:id/compressions` 返回 `{nodeId, compressions}`。
- 变更卡接口：`GET /api/stories/:id/proposals?status=` 默认 `pending`，接受 `all` 与四个状态；`POST /api/proposals/:id/approve|reject|rollback` 复用 core 的三个函数，返回 `{card, ledger}`。`LedgerChangeCardError` 的 `not_found` 映射 404、`invalid_status` 映射 409；其余错误仍走 500。批准玩家来源卡片会同时写 `userWill`；回滚只恢复 `before` 里的路径，不会撤销那条 `userWill`（core 既有行为）。
- 路径接口：`GET /api/stories/:id/path?nodeId=&limit=&before=`，返回 `{storyId, headNodeId, nodes, hasMore}`。`nodeId` 是锚点、缺省 head，锚点节点包含在返回路径里；`before` 必须在本故事且在该锚点的路径上，返回它之前的 `limit` 楼；`hasMore` 只在返回页之前还有楼层时为真。响应里 `nodes` 一定是根到页末楼的连续顺序。`limit=1` 且带 `nodeId` 时只返回锚点自己，分支页用它读任意楼层原文。
- 分支接口的 head 语义：`appendNode` 自带把 head 移到新节点，所以 `swipeNode`、`editNode`、重新生成写完楼层后 head 已经是新楼层，不需要再调用 `POST /head`；`setHead` 只在树里主动切分支时使用。
- 块载荷：`DisplayedContent` 是协议层的渲染载荷，`display` 为 `null` 表示没有显示策略、按原文显示；`html` 模板的 `{{content}}` 由 web 用 `escapeHtml` 替换，模板字符串只进入 iframe 的 `srcdoc`。本地历史楼层仍然在客户端用 `parseBlocks(node.raw)` 再 `toDisplayedBlocks`，因此与流式载荷共用同一套渲染类型。协议测试会扫描 `dist`，`turn.js` 不能引用 core 的运行时代码。
- web 包结构：`src/api/{client,sse,index}.ts`；`src/chat/{path-state,virtual-window,stream-state,turn-summary,blocks,sandbox,candidate-actions,opening-candidates,branch-tree,ledger-view,proposal-view,director-view,composer-draft,settings-form,template-form,channels-form,format}.ts`（纯逻辑）；`src/components/chat/{ChatFloorList,ChatFloorView,BlockContent,SandboxBlock,StreamingBubble,Composer,CandidateActions,OpeningCandidates}.tsx`、`src/components/branches/BranchTree.tsx`、`src/components/ledger/{LedgerValue,StateTree,ProposalList}.tsx`、`src/components/director/{DirectorDecision,PlanEditor,TracePanel}.tsx`、`src/components/settings/{TemplateEditor,ConditionEditor}.tsx`、`src/components/ErrorNotice.tsx`；`src/pages/*`、`src/pages/story/*`、`src/styles.css`。`src/api/index.ts` 导出单例 `api`。开发用 Vite（`pnpm --filter @dramaticer/web dev`）。
- 渠道页（R5-T10）：`ChannelsFormDraft` 的渠道/模型带不写入配置的 `key`，供 React 列表稳定身份；`buildChannelsDraft` 从 `ChannelsView` 生成，`newChannelDraft`/`newModelDraft` 提供默认值。保存是整份替换，`parseChannelsDraft` 始终带上现有的嵌入提供方，避免 `applyChannelsUpdate` 把它们删掉。`configuredRoles` 为空表示缺省回落；界面显示生效别名但不写回。未设置密钥的提示只在视图里 `apiKeySet` 为 false 时出现；环境变量完全不存在时 `GET /api/channels` 会直接 400，不会返回视图。体检按钮只对已保存的模型可用。
- 聊天页每轮生成完成后重新取最新 60 楼并丢弃旧的向上分页；`PAGE_SIZE` 60、分页阈值 240px、自动贴底阈值 96px、楼层高度估算 200px、overscan 600px。候选行动与开场候选的轮询间隔都是 2 秒、上限 15 次；候选行动面板与开场候选面板在聊天面板里最高占 40vh、内部滚动。
- 聊天页的回合模式取自 `GET settings` 的 `turnMode` 并作为 `mode` 发送；settings 尚未取到时按 `fast`。锁定为深回合时下拉框只显示当前值（不可选），旁边出现“切回快回合”按钮走 `PUT settings`。深回合仍不在可选项里（DESIGN §10.1）。
- 分支页：路径高亮按完整路径 id 集合；head 行用 `focusSignal` 触发 `scrollIntoView`（0 表示还没加载）。树里只有 `childIds.length > 0` 才能折叠；`describeHeadSwitch` 是切换提示的唯一文案来源。
- 台账页：楼层选择复用 `BranchTree`，`focusSignal` 固定 0；`selectedId` 变化时并行取 ledger、events 第一页与 compressions，`requestRef` 序号防止旧响应覆盖；故事级 clues/entities/lore 与 `proposals?status=all` 只在 storyId 变化时取一次。状态树只按完整路径高亮本楼写入，`hasHighlightedDescendant` 决定子树默认展开。事件每页 20，下一页 offset 等于已收到条数，`appendEventPage` 按 id 去重。facts 的“写入时间”取树节点的 `createdAt`（`LedgerFact` 本身没有 createdAt）。
- 台账页变更卡：按状态分组展示，待审卡有批准与拒绝、已批准卡有回滚、已拒绝显示拒绝原因；`cardBusyId` 在请求期间禁用全部按钮，`storyEpoch` 丢弃切故事后的响应；批准或回滚的响应里 head 台账与当前选中楼层一致时直接采用，否则等下次选楼重新读取。
- 导演页：楼层选择同样复用 `BranchTree`（`focusSignal` 固定 0），`selectedId` 变化时并行取 `director`、`actions` 与 `trace`，`requestRef` 序号丢弃旧响应；故事级设置、计划与线索只在 storyId 变化时取一次。决策记录写在生成时的消息楼层上（助手楼层的父楼层），所以选中助手楼层时 `GET director` 通常返回 `decision: null`，界面按“本楼没有评估”显示；要看决策请选中对应的消息楼层。`DirectorDecisionView.signals` 在盲盒模式被服务端整个省略，前端不得再根据机制原因推断指令。
- 导演页的计划编辑器直接操作 `DirectorPlan` 对象：新增条目的标题与拍内容为空，保存时由服务端 `parseDirectorPlan` 拒绝并返回字段路径；`ErrorNotice` 显示 `details.path`。保存成功后 `plan` 与 `draftPlan` 同时替换，`dirty` 用 `JSON.stringify` 比较。设置保存后页面只重取当前楼的 `director`（模式导致的脱敏立即生效），不重取整页。
- 跨面板候选行动：`setComposerDraft(storyId, text)` 写入模块级 Map，导演页随后 `navigate` 到聊天页；`ChatPage` 用 `composerStoryRef` 保证每个故事只消费一次（StrictMode 会重复执行 mount effect），读取后立即清空。草稿不持久化，刷新丢失。
- 偏好记录已闭环：记录写入（四种信号）→ `POST /api/nodes/:id/choice` → `preferences export` 产出回复对 → `pairwise` 盲测与评分 → `scoreboard` 汇总。重新生成与 `swipeNode` 都写 `swipe`；`card_decision` 在批准与拒绝时由 `updateLedgerChangeCardStatus` 写入，回滚不写。
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`。只读、零模型调用；导演决策从助手楼层的父楼层读（`director_decisions` 写在生成时的消息楼层上）。记忆槽位的 `retrieval` 只在槽位真正注入内容时写进 Trace；没有命中时该槽位记为 `missing-slot`。上下文分段行会显示 suffix 槽位的 `appendedTo`。`explain` 不受导演模式影响，盲盒下仍然显示完整指令与信号。第 7 段显示当前拍与 `director_beat_states` 记录（节拍 id、完成楼层、`completed`、是否已前进），只读。
- 导演计划接口：`readDirectorPlan` 按 `ordinal` 还原弧线、序列、节拍；`--set` 与 `PUT /api/stories/:id/director/plan` 都整份替换并把所有行标为 `player`，`mergePlannedArcs` 只更新或追加 `model`/`import` 行，永不删除、不覆盖 `player` 行。`resolveCurrentBeat` 沿路径最近一条 `director_beat_states` 前进：完成则到下一拍（跨序列），未完成停在原地，无状态取第一拍，耗尽返回 null；记录指向已不存在的节拍时跳过该记录，仍无有效记录则回到第一拍。`readDirectorPlan` 与 `resolveCurrentBeat` 的入参是 `DirectorPlanReader`/`DirectorBeatResolver`（`Pick<StoryStore, …>`）。
- 导演规划器（R4-T02）：`directorPlanNeedsRun` 需要角色卡或台账素材；计划为空时补建，head 上 `resolveCurrentBeat` 返回 null 时补建，head 为空或当前拍仍可解析时不补建。`plannerClient` 在 `dramaticer work` 与 server 里用 `roles.planner` 建立，缺省回退到 `background`。
- 导演强度与注入（R4-T03、R4-T04）：`DirectorConfig.intensity` 与 `openingIntensity` 共用 `DirectorIntensity`（`setup`、`natural`、`detonate`）；机制优先级固定为重复正文 40、开场 35、线索过老 30、场景重复 25、节拍 23、线索过多 20、事件池 10、节奏 5；`createDirectorSlotProvider` 返回带 `config`、`mechanisms` 的 `DirectorSlotProvider`，`provide` 返回空的 `messages` 与 `suffix`（`【导演】` 加指令与 `DIRECTOR_SUFFIX_NOTE`）；组装器在预算裁剪后把 suffix 接在最后一条 user 消息末尾，Trace 记 `appendedTo: "last-user"`。
- 导演模式（R4-T05）：`DirectorConfig.mode` 取 `off`、`transparent`、`blind`，默认 `transparent`；旧配置的 `enabled` 在读取时映射后丢弃。`GET /api/nodes/:id/director` 返回 `{nodeId, mode, decision}`，盲盒下 `decision.directive` 为 null 且没有 `signals`。
- 节拍完成检测（R4-T06）：结算窗口的 `beats` 按楼层父节点解析；`applySettlementProposals` 写 `director_beat_states` 的时机在结算记录之后、同一事务内。模型没有给该楼层条目、楼层被拒绝、或按路径解析出的拍与提示词里的拍不同时不写状态。
- 候选行动（R4-T07）：`candidate_actions` 按 `settled` 为每个已生成完成的助手楼层建任务，档位 `gap`；`parseCandidateActionsResponse` 是唯一校验口；写入顺序固定为 4 条 `action` 再 1 条 `scene_change`；`GET /api/nodes/:id/actions` 只按楼层读取，不跟随 head。
- `extensions.dramaticer` 有三个键：`events`、`npcAgendas`、`arcs`；`arcs` 的校验全部复用 `parseDirectorPlan`，导入来源固定为 `import`。
- R4 验收的链路证据在 `packages/core/test/director-acceptance.test.ts` 与 `docs/dev/reports/R4.md`。
- 设置页（R5-T09）：`GET /api/stories/:id/template` 返回故事实际使用的模板。内置默认模板不能直接保存；先“复制为新模板并设为默认”再编辑。“故事使用的模板”下拉只改表单草稿，点“设为故事默认”或“保存故事设置”才写入；写入后整页重取。模板段落的 `block_format` 复选框用服务端给的 `blockFormatSegment` 新增，文本按打开页面时的 `structuredOutput` 生成，之后可以编辑；改 `structuredOutput` 不会自动改写已有段落。
- 模板校验：`assertContextTemplate` 现在也校验 `when`（`assertContextCondition`）：switch 名字非空且 `equals` 是布尔、state 路径是非空字符串数组且 `op` 属于三种、all/any 的 `conditions` 是数组、not 必须有子条件、未知类型直接拒绝。server 把模板校验错误映射为 `details.path: "template"`，界面上按路径逐条列出。
- 设置表单校验与服务端同一套范围：`budgetTokens ≥ 0`、`maxTokens ≥ 1`、`temperature` 0–2、`maxReadRounds ≥ 0`、`gapPlanSeconds ≥ 0`、导演参数范围见 `DIRECTOR_NUMBER_FIELDS`；客户端校验不通过时不发请求。服务端错误路径（含 `directorConfig.<key>`）由 `describeSettingsPath` 显示成中文名。
- 设置页的深回合选项只在故事当前已锁定为 `deep` 时出现（DESIGN §10.1）；快回合是唯一可选的新值。

## 下一步
- **R5-T12 Playwright 端到端**：安装 `@playwright/test` 与 Chromium；`packages/web/e2e/` 配置 `pnpm e2e`，先构建 server 与 web，再启动本地假 OpenAI 兼容渠道与 server，覆盖思考、块、台账写入、线索、候选行动、开场候选与读取工具调用；用例含密码登录、创建故事、导入合成卡、两轮对话、模式开关、选项点击记录偏好、重新生成、swipe、编辑、分支切换、台账与记忆面板、变更卡批准与拒绝、导演与 Trace 面板、模板编辑、渠道编辑、开场候选选取与重新生成、路径分页；390×844 与桌面两种视口；失败截图与 trace 写进 `.devloop/scratch/e2e/`。
- 之后 R5-T13（自动试玩框架）、R5-T14（真实 60 轮试玩与报告）、R5-T99（R5 验收）。
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
- 回合模式的解析口只有 core 的 `resolveTurnMode`（已导出）：单轮参数优先于故事设置，深回合直接抛错。server 在 `handleTurnStream` 里、建用户楼层之前先调用它，深回合按 400 返回，`details.path` 在请求给 `mode` 时是 `mode`，否则是 `turnMode`；`generateAssistantTurn` 收到解析后的模式并写进 Trace。web 聊天页发送设置里的 `turnMode`，界面只列快回合。
- 已注册的槽位是十一个：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol。默认模板顺序：character、lore、state、summary、memory、scene、director、user_will、history、（可选的 block_format）、protocol。`director` 槽位只返回 suffix，不产生 system 消息；不新增 `beat` 槽位。组装器的 suffix 用 `\n\n` 与玩家原文分隔；多个 suffix 之间用 `\n` 连接。
- 原生块类型是 12 个（`thinking`、`选项`、`状态栏`、`变量更新`、`分析`、`图片`、`页眉`、`悄悄话`、`旁白`、`备忘`、`state_update`、`plot_note`）；`thinking`、`变量更新`、`state_update`、`plot_note` 的上下文策略是删除。`图片` 的显示策略是沙箱 HTML 模板，其余原生块用 React 组件；`thinking` 在界面里仍可折叠查看。
- 历史槽位默认策略：更早楼层省略五个显示类块，最近 1 楼不套用这层省略；`full` 是改动前行为。设置项 `historyBlockPolicy` 存在 `story_settings.history_block_policy`。
- 结算窗口以 head 为终点（ADR-0046），取**最旧的** N 个未结算助手楼层；冲突检查窗口取 head 路径最后 `conflictWindowFloors` 楼。现场分析以被分析的楼层为锚点。`scene` 任务显式传 200 token 上限。
- 结算提示词只在 `SettlementWindow.beats` 非空时提 `beatCompleted`；`beatCompleted` 非布尔时该楼层整条拒绝，修复记录的 `path` 是 `["-"]`。`applySettlementProposals` 写拍状态的条件：该楼层出现在模型产出里、没有被拒绝、父节点处解析出的拍与提示词里的拍相同。
- 后台任务分两档：`gap` 每次间隙执行，`deferred`（`events`、`summary`、`npc_agenda`、`director_plan`）只在会话结束或间隙达到 `gapPlanSeconds` 时执行。`gap_pass` 默认关闭；`dramaticer work` 与 server 调度都不为关闭的故事补建。`candidate_actions` 是 `gap` 档。
- 后台任务连续失败 3 次才放弃；`user_will` 的 `sourceQuote` 必须逐字出现在玩家楼层里。后台任务需要等待其它任务时抛 `BackgroundJobDeferredError`；取消本轮时 `drain` 用 `options.signal`。
- 模型响应的磁盘缓存键包含 `max_tokens` **只在请求显式带 maxTokens 时**；改渠道配置的 `maxTokens` 后必须换一个 `--cache` 目录。后台 `background` 模型的输出上限是 32,768。
- 后台路由现状（2026-11-08）：`main-fallback`（`auto/deepseek-v4.1-flash`）可用；`opendesign/deepseek-v4.1-flash` 曾返回 membership entitlement 错误；`catie` 的 `rp` 返回 503（HUMAN-13）。`data/channels.yaml` 现在是 `writer: rp`、`judge: judge`（`auto/glm-5.3`）；`roles.planner` 未配置，回退到 `background`。
- 渠道角色（`writer`、`settler`、`planner`、`judge`）与消息角色不同；`createLlmClient` 校验 judge 与 writer 的模型家族不同。server 运行时为 writer、settler、planner 各建一个客户端；`dramaticer work` 建 settler 与 planner 两个客户端。
- 渠道管理接口（R5-T03、R5-T10）：三条路由只在 `channels.path` 存在时可用。`GET` 每次重读文件；`PUT` 是整份替换，请求里没出现的渠道、模型、嵌入提供方与岗位都会被删除；`models` 里不写 `tools`/`probe`（保留原值），`enabled: true` 不落盘。`POST /api/channels/probe` 的 `channel` 缺省取模型第一个渠道；通道创建或体检抛错时返回 400 `渠道体检失败：<原因>`，`details.path` 为 `alias`。`ServerChannelsOptions.env` 同时用于解析 `${VAR}` 与报告 `apiKeySet`；`apiKeySet` 只在变量存在但为空串时为 false——变量完全不存在时 `GET` 直接 400。运行时的缓存指纹包含 `roles`，写入后下一回合重建。
- 模型 `enabled` 语义：默认 true；停用后不能作为故事模型、角色目标或路由，`resolveModelForRole` 与 `StoryRuntimeManager` 对显式指向停用的角色抛错；后台角色缺省回落的 `background` 停用时后台客户端为空。程序化构造 `LlmModelConfig` 时必须写 `enabled`。
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
- `@dramaticer/core/blocks` 是浏览器安全子路径，只导出块解析、类型、视图与选项行读取；web 不要从 `@dramaticer/core` 根入口导入运行时函数（会带进 better-sqlite3）。只用 `import type` 从根入口取类型是允许的（`Composer.tsx`、`LedgerPage.tsx`、`DirectorPage.tsx`、`settings-form.ts`、`template-form.ts`、`channels-form.ts` 都这么做）。web 侧的槽位名与 `protocol`、`block_format` id 在 `template-form.ts` 里本地声明，避免引入 core 运行时。
- `@dramaticer/protocol` 的运行时入口可以给 web 与 server 共用（`toDisplayedBlocks`、`SSE_EVENT_NAMES`），它只引用 core 的类型；protocol 测试会扫描 `dist`，确认 JavaScript 里没有 `@dramaticer/core`。
- `TurnCompletedPayload` 现在有必填的 `blocks`，构造完整事件夹具时要带上；`TurnDraft.blocks` 的类型是 `DisplayedContent[]`。
- 沙箱消息的浏览器约束：srcdoc 沙箱在不带 `allow-same-origin` 时 `event.origin` 是字符串 `"null"`，读 `document.cookie` 会直接抛 `SecurityError`；Playwright 的 `frame.evaluate` 里要捕获这个异常，不能当成空字符串。
- web 的 Vite 开发服务器在当前环境只监听 `localhost`（IPv6 `::1`），用 `http://localhost:5173` 访问；`127.0.0.1` 会被拒绝连接。
- 聊天页、分支页、台账页、导演页、设置页与渠道页的冒烟方式：从 `packages/core/dist` 与 `packages/server/dist` 用 `pathToFileURL` 引入（Windows 上直接 `import("E:/…")` 会报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`），用 `StoryStore` 造故事与楼层、按需写入状态 diff、事件、摘要、实体、世界书、变更卡、导演决策、Trace、候选行动、计划与上下文模板；渠道页需要给 `startServer` 传 `channels: { path, env, createChannel }`，用假通道提供体检结果，并把 `env` 的密钥变量设成空串来触发“变量存在但未设置”的提示（变量完全不存在会让 `GET` 直接 400）。`--web` 指向 `packages/web/dist` 后浏览器用 `http://127.0.0.1:<端口>/stories/<id>/settings` 等路径。`playwright-core` 已在根 `node_modules` 里可解析，未改动根 `package.json` 与 `pnpm-lock.yaml`；可用 `LOCALAPPDATA/ms-playwright/chromium-1243/chrome-win64/chrome.exe` 作为 `executablePath`。
- R5-T09 的冒烟脚本在 `.devloop/scratch/R5-T09/smoke.mjs`，R5-T10 的冒烟脚本在 `.devloop/scratch/R5-T10/smoke.mjs`（都在 git 忽略的 `scratch` 下）；R5-T10 的脚本把临时文件放在同目录的 `work/`，不要像它第一版那样删掉自己所在的目录。
