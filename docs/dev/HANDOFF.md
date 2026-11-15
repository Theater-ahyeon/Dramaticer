# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-14 会话 429：完成 W7-T03（剧透选项与蓝图导出）。迁移 v67 给故事设置增加 `blueprint_spoilers`（`show`/`hide`，默认 `show`），新建 `story_blueprint_baselines(story_id PRIMARY KEY, entries, created_at)` 作为卡导入的默认蓝图。`saveStoryBlueprintBaseline` 用 `assertBlueprintEntries` 整批校验、按 id 排序后替换，条目为空时删行；`readStoryBlueprintBaseline` 没有时返回空。`listBlueprintVersions` 与 `readBlueprintEntries` 从默认蓝图开始累加，版本列表仍只列楼层批次，锁定检查覆盖默认蓝图。core 新增 `blueprint/spoilers.ts` 的 `readBlueprintView(entries, mode)`：`hide` 时只返回玩家写的条目，`hidden` 给出 `{premise, volume, milestone, total}`，没有隐藏任何内容时为 null，玩家条目不改写字段。服务端新增 `GET /api/stories/:id/blueprint`（`nodeId` 省略取 head，还没有楼层时取默认蓝图）按故事设置过滤；protocol 新增 `StoryBlueprintView`，web 客户端新增 `getStoryBlueprint`。卡扩展新增 `extensions.dramaticer.blueprint`，`importDramaticerExtension` 导入时整批恢复默认蓝图并返回 `blueprint.entries` 条数；st-compat 新增 `attachBlueprintExtension`、`readCardBlueprint` 与 `blueprint-export` 命令行。ADR-0159；`pnpm check` 通过（301 个测试文件、2,616 个测试、5 个跳过）。

## 下一步（会话 430 先做）
1. 选下一个可做的任务：**W8-T01 三层开关与档位**（依赖 W4-T03、W6-T02、W7-T02，全部完成）→ **W8-T02** → **W9-T01 至 W9-T99**。W8-T01 先读 DESIGN §22 与 ADR-0139：档位（轻量、标准、沉浸）映射到开关集合；临时开关只影响一轮；默认值按卡的能力自动判断；开关状态存故事设置（新增设置字段要迁移 v68 并同步 `assistant-store.test.ts` 的版本断言）。
2. **R6-T99** 仍被 HUMAN-19 阻塞（`bg` 渠道额度 2026-11-17T11:44:35Z 重置）。恢复后先跑 `r6-replay`、`r6-instrument`、`r6-compare`、`r6-deep`、`r6-preference`、`r6-funnel`，再用 `r6-gate --dir eval-private/reports/r6` 判定；报告写 `docs/dev/SCOREBOARD.md` 与 `docs/dev/reports/R6.md`，只写聚合数字与 slug。
3. **W3-T02.e** 被 HUMAN-22 阻塞：原样模式目前按导入字段注入；完整酒馆激活需要原始世界书入库并把 `st-content` 接进 server 运行时。
4. **W2-T04** 继续被 HUMAN-19 阻塞。额度恢复后用 `pnpm --filter @dramaticer/st-compat scene-log-compare`（默认读 `eval-private/reports/scene-log/samples.json`，24 个楼层 ≥ 20）跑真实对照。不达标时保留独立任务并写 ADR。
5. 阻塞检查：M6-T99 仍等 HUMAN-15；HUMAN-03、HUMAN-16、HUMAN-17、HUMAN-18、HUMAN-20、HUMAN-21、HUMAN-22 不阻塞其他任务；HUMAN-19 阻塞 R6-T06、R6-T99、W2-T04。

## 当前状态
- 已完成：F0、M0–M3、D、M4-T00 至 M4-T06、R0、R1（含 R1-T99、R1-T99.a）、R3、O、R2、E、R4、R5、V-T01、M6-T00 至 M6-T05、R3b、P1–P4、C-T01 至 C-T05、H-T00 至 H-T99、X1.a 至 X1.e、X2.a 至 X2.d、R6-T00 至 R6-T05、R6-T07、R6-T07.a、R6-T07.b、R6-T07.c、R6-T07.d、W0-T00、W0-T01、W1-T01、W2-T01、W2-T02、W2-T03、W3-T01、W3-T02.a、W3-T02.b、W3-T02.c、W3-T02.d、W3-T03.a、W3-T03.b、W3-T03、W4-T01、W4-T02、W4-T03、W5-T01、W5-T02、W6-T01、W6-T02、W6-T03.a、W6-T03.b、W6-T03.c、W6-T03.d、W7-T01、W7-T02.a、W7-T02.b、W7-T02.c、W7-T02.d、W7-T02.e、W7-T02.f、W7-T03。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 设计版本 v0.4（ADR-0139、ADR-0142、ADR-0143、ADR-0144、ADR-0145、ADR-0146、ADR-0147、ADR-0148、ADR-0149、ADR-0150、ADR-0151、ADR-0152、ADR-0153、ADR-0154、ADR-0155、ADR-0156、ADR-0157、ADR-0158、ADR-0159）。W 阶段任务顺序：W0（完成）→ W1（完成）→ W2（T01–T03 完成，T04 被阻塞）→ W3（T01、T02.a–T02.d、T03.a、T03.b、T03 完成，T02.e 被 HUMAN-22 阻塞）→ W4（完成）→ R6 段（T07.a 至 T07.d 完成，T99 被 HUMAN-19 阻塞）→ W5（完成）→ W6（完成）→ W7（完成）→ W8 → W9。
- 数据库 schema 版本 67（v51 `story_media`、v52 `story_settings.contextLayout`、v53 `scene_logs` 与 `scene_log_enabled`、v54 `scene_archives`、v55 `import_audit_entries` 与 `story_settings.import_mode`、v56 `import_audit_entries.memory`、v57 `story_rules`、v58 `director_lines`、v59 `director_chapter_reviews`、v60 `story_settings` 重建并允许 `director_organization = lines`、v61 `scene_logs.scene_card`、v62 `scene_controls` 与 `scene_archives` 重建、v63 `scene_archives.profiles` 与 `scene_archives.informed`、v64 `story_blueprints`、v65 `story_blueprints` 重建为 `(node_id, seq)`、v66 蓝图建议请求与建议、v67 蓝图剧透设置与 `story_blueprint_baselines`）。
- 故事蓝图：`blueprint/story-blueprint.ts` 是结构与校验的唯一来源；`BlueprintEntry` 是 `premise`（`coreQuestion`、`tone`、`endings`、`redLines`、`tension`）、`volume`（`title`、`coreQuestion`、`startState`、`endState`）、`milestone`（`volumeId`、`want`、`prerequisites`、`after`、`hardness` 取 `hard`/`soft`）的联合；`BLUEPRINT_ENTRY_KIND_LABELS`、`BLUEPRINT_SOURCE_LABELS`、`BLUEPRINT_MILESTONE_HARDNESS_LABELS`、`BLUEPRINT_TENSION_LABELS` 是中文措辞来源。`applyBlueprintDiffs` 依次应用 `set`/`delete` 并按 id 排序，`planBlueprintRollback` 给出「删多出来的、重写内容不同的」修改，`assertBlueprintWriteAllowed` 只拦 AI 对锁定条目的修改。
- 蓝图拉力：`BLUEPRINT_TENSIONS` 是 `loose`、`medium`、`tight`，`DEFAULT_BLUEPRINT_TENSION` 是 `medium`；`assertBlueprintTension` 对缺失字段返回默认档，非法值报 `label.tension`；`readBlueprintTension(entries)` 取总纲的档位，没有总纲返回 null。导演动作引擎按它重排候选，玩家让位与手动推进档位优先（ADR-0158）。
- 蓝图剧透：`BLUEPRINT_SPOILER_MODES` 是 `show`、`hide`，默认 `show`，标签 `BLUEPRINT_SPOILER_MODE_LABELS`；故事设置字段 `blueprintSpoilers`。`readBlueprintView(entries, mode)` 在 `hide` 时只保留来源不是 AI 的条目，`hidden` 是 `{premise, volume, milestone, total}`，没有隐藏任何内容时为 null。过滤只用于给玩家看的读取入口；导演、章级规划、动作引擎与接受建议都读完整蓝图（ADR-0159）。
- 蓝图默认蓝图：`story_blueprint_baselines(story_id PRIMARY KEY, entries, created_at)` 是故事级、与楼层无关的卡导入内容；`saveStoryBlueprintBaseline` 整批替换（空条目删行、按 id 排序），`readStoryBlueprintBaseline` 没有时返回空。`listBlueprintVersions` 以默认蓝图作为起点累加，版本列表只列楼层批次；`readBlueprintEntries` 在没有楼层记录时返回默认蓝图。默认蓝图参加锁定检查；替换或清空它不删除楼层记录。
- 蓝图存储：`story_blueprints(node_id, seq, story_id, source, diffs, created_at)`，主键是 `(node_id, seq)`，记录只追加；同一楼层可以有多批修改，`seq` 从 1 起递增。`saveStoryBlueprint` 在写入前校验故事归属、非空 diffs、来源、锁定与结果合法性，返回带 `seq` 的记录；`getStoryBlueprintRecord` 取该楼层最后一批，`listStoryBlueprintRecords` 取全部批次；`listBlueprintVersions` 沿当前路径从根开始累加，按路径深度与批次序号给每一版 `{nodeId, seq, source, diffs, createdAt, entries}`，`readBlueprintEntries` 取最后一版；`rollbackStoryBlueprint` 以玩家来源把某一版写成新楼层的记录，`versionSeq` 可定位同一楼层上的某一批，省略时取最后一批。分支之间互不影响。
- 蓝图建议：`blueprint/suggestions.ts` 定义五个操作 `complete`、`find-flaws`、`three-directions`、`expand-volume`、`recent-update` 与 `BLUEPRINT_SUGGESTION_OPERATION_LABELS`；请求表 `blueprint_suggestion_requests`，建议表 `blueprint_suggestions`（状态 `pending`、`accepted`、`rejected`）。两张表的内容与归属不可改，只有状态与对应时间可写。后台任务 `blueprint_suggestion` 是故事级、`gap` 档、`planner` 客户端，一次取最早一条待处理请求，读 head 蓝图与最近十二个楼层，一次调用后把建议与请求状态写进同一事务；生成不写蓝图。接受走 `acceptBlueprintSuggestion`：按当前蓝图重新校验、过滤锁定条目、用 `saveStoryBlueprint({source:"player"})` 追加一批并标 `accepted`；拒绝只改状态。建议提示词的 premise 字段清单带 `tension`，省略时按 `medium`。
- 蓝图建议接口：`POST /api/stories/:id/blueprint/suggestions` 登记请求后调用 `enqueueStoryBackgroundJobs({kinds:["blueprint_suggestion"]})`，201 返回 `{request, jobId}`；`GET` 默认 `status=pending`，可用 `accepted`、`rejected` 或 `all`；`POST /api/blueprint-suggestions/:id/accept` 省略 `nodeId` 时写到 head，返回 `{suggestion, record, blueprint}`；`reject` 不读请求体。protocol 与 web 客户端四个方法已就位。蓝图页在 W9-T05 接入。
- 蓝图读取视图：`GET /api/stories/:id/blueprint[?nodeId=]` 返回 `{storyId, nodeId, spoilers, entries, hidden}`；`nodeId` 省略取 head，故事还没有楼层时取默认蓝图、`nodeId` 为 null。protocol 是 `StoryBlueprintView`，web 客户端是 `getStoryBlueprint(storyId, nodeId?)`。
- 蓝图导出：卡扩展 `extensions.dramaticer.blueprint` 存整份条目（与楼层条目同构，`assertBlueprintEntries` 校验），导入时整批恢复默认蓝图，`importDramaticerExtension` 结果的 `blueprint.entries` 是写入条数。`attachBlueprintExtension(card, entries)` 深拷贝 `raw`、V1 写根节点、V2/V3 写 `data` 节点，只改这一个字段，条目为空时删掉字段；`readCardBlueprint(card)` 读回。命令行 `blueprint-export` 把指定楼层或 head 的蓝图写进原卡导出新 JSON。
- 里程碑铺垫：`blueprint/milestones.ts` 的 `milestonePromiseLineId(milestoneId, prerequisite)` 是线 id 的唯一来源；`readMilestoneProgress(entries, states, historyLineIds)` 按 `after` 排序给出 `lineIds`、`missingLineIds`、`openLineIds` 与 `reached`；`selectActiveMilestone` 取第一个未达成，`readActiveMilestone` 是蓝图加线状态的组合入口，`planMilestonePromiseDiffs` 只补写 `missingLineIds`。没有前提条件的里程碑作为方向但不生成线。
- 里程碑偏离：`blueprint/deviations.ts` 的 `MILESTONE_DEVIATION_STATES` 是 `achieved`、`reachable`、`blocked`、`lost`，`MILESTONE_DEVIATION_OPTIONS` 是 `adjust-blueprint`、`pull-back`、`abandon`。`checkMilestoneDeviation(entries, states, historyLineIds, {retiredLineIds, floorDepth, clueAgeWarning})` 逐条判定；`readMilestoneDeviation(store, storyId, nodeId)` 读路径上的章末清点 `retire` 记录与导演配置阈值。检查只读，不写蓝图与线。接口 `GET /api/stories/:id/blueprint/deviation`。
- 写作上下文的蓝图摘要：`blueprint/summary.ts` 的 `readWritingBlueprintSummary(entries, states, historyLineIds)` 给出 `volume`、`milestone` 与 `seeds`；`formatWritingBlueprintSummary` 拼出注入文本与来源描述，三项都没有可写内容时返回 null。`createBlueprintSlotProvider` 只读蓝图与伏笔账；槽位 `blueprint`（插件 `slot.blueprint`）默认模板放在 `scene_card` 与 `director` 之间。
- 章级规划：`CHAPTER_PLAN_JOB_KIND = "chapter_plan"` 在 `director/chapter-plan.ts`；`DirectorConfig.chapterFloors` 默认 20；入队条件见 `chapterPlanNeedsRun`。`collectChapterPlanInput` 带 `milestone: MilestoneProgress | null`；处理器解析模型输出后先 `assertChapterPlanKeepsMilestone`，再把模型修改与 `planMilestonePromiseDiffs` 合并，交给 `saveDirectorChapterPlan` 一次写入；`retire` 的伏笔由 `chapterReviewLineDiffs` 补 delete。
- 动作引擎：`DIRECTOR_ORGANIZATION_KINDS` 是 `mechanisms`、`bits`、`lines`，默认 `mechanisms`。`selectDirectorAction` 只接受内存输入；常规回合顺序为让位、闯入、兑现、揭示、转场、喘息、加码、接球；有拉力时按档位重排，`push` 优先。
- 推进三档：`DIRECTOR_PUSH_KINDS` 是 `advance`、`quick`、`jump`；候选集合按档位替换，让位始终第一。单轮参数从 `POST /api/stories/:id/turns` 的请求体进入，写进 `packKey` 与决策记录。
- 线的存储：`director_lines(node_id PRIMARY KEY, story_id, diffs, created_at)`；`saveDirectorLines` 同楼层重复写入失败，`readDirectorLineStates` 沿路径累加并给出 `openedDepth`/`lastTouchedDepth`；`listDirectorLinesAlongPath(nodeId)` 只用于历史线 id，`collectDirectorLineHistoryIds` 把记录展开成线 id 列表。深度单位是当前路径上的助手楼层数。
- 伏笔账：`DirectorConfig.maxOpenPromises` 默认 5；`saveDirectorLines` 用 `assertPromiseBudget` 拒绝会让未兑现伏笔增加且超过上限的整批修改。
- 章末清点：`director_chapter_reviews(node_id PRIMARY KEY, story_id, payload, created_at)` 只追加；`payload = {promises: [{lineId, disposition}], focus: [lineId…]}`，`disposition` 取 `carry` 或 `retire`，`focus` 固定 2–3 条。写入前用 `assertChapterReviewMatchesLines` 对照当前路径。
- 变更卡：`ledger/cards.ts` 的 `createPlayerLedgerChangeCard` 是玩家直接编辑的唯一入口；接口 `POST /api/stories/:id/proposals`、`GET /api/stories/:id/proposals[?status=]`、`POST /api/proposals/:id/{approve,reject,rollback}`。
- 连载视图与导出：`serial/view.ts` 的 `readSerialView` 是前情提要、章节目录、人物关系页与时间线的唯一派生入口；`serial/book.ts` 的 `exportSerialBook` 按章末清点切段，正文逐字取 `TimelineNode.raw`。接口 `GET /api/stories/:id/serial[?nodeId=]` 与 `GET /api/stories/:id/serial/export[?nodeId=]`；web 连载页与导出按钮已接入。
- 就地纠正与场面控制：`chat/correction.ts` 的 `locateCorrectionSpan`/`applyCorrectionSpan`/`rewriteFloorSegment`；`ledger/scene-control.ts` 的 `endSceneAt`、`jumpSceneTime`、`setScenePace`；接口 `POST /api/nodes/:id/correct` 与 `POST /api/nodes/:id/scene-control`。
- 人物档案与知情：`ledger/character-profile.ts` 的 `CHARACTER_PROFILE_FIELDS`、`readCharacterProfiles`、`readSceneKnowledge`；归档表 `scene_archives.profiles` 与 `.informed`。`profile` 槽位只注入当前在场人物与最近三场有不知情者的标注。
- 重逢注入：`ledger/reunion.ts` 的 `readReunionCandidates`、`selectReunionMentions`、`formatReunionMention`；`reunion` 槽位只在命中时返回一条 system 消息。
- 场面卡：`SceneLog.sceneCard` 为 `{present: [{who, want}], change}` 或 null；只在开新场的第一楼要求卡，其余楼层出现时丢弃并记 `repairs`。`scene_card` 槽位在场次未结束时注入。
- 采样种子与 R6 工具：`LlmRequest`/`LlmProviderRequest`/`ChatTurnOptions`/`ModelTurnOptions` 有可选 `seed`；`evalset/r6-replay.ts`、`r6-funnel.ts`、`r6-gate.ts` 与 CLI 就位。R6 真实批次仍被 HUMAN-19 阻塞。
- 变更卡、连载页、就地纠正、场面控制、人物档案、重逢注入、场记、导入审计、规则、状态定义等其余细节保持上一次会话的状态；完成记录见 TASKS。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成；`st-content` 的世界书激活只在共存评测里使用，没有接进 server 运行时。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`、`H.md`、`X1.md`、`X2.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；需要恢复原始预设时用 `sandbox --replace` 重建。
- ADR-0088 至 ADR-0159 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染、覆盖率口径、应用内助手、世界模型接口、实体档案、时序图谱、对比运行器、X1 判定、导演组织方式、剧情小品、X2 对比运行器、X2 判定、R6 预注册、评测调用输出预算、结算提示词楼层 id、v4 设计合并、故事图片、导入模式与初始记忆、规则声明与状态定义、线与八种动作的程序判断口径、推进三档与伏笔账与章末清点的程序口径、场面卡与章级规划的程序口径、重 roll 点回放与采样种子的程序口径、遗忘漏斗的归因口径与探针上下文记录、推进按钮与带原因的重 roll 的程序口径、就地纠正与场面控制的程序口径、场次归档人物档案与知情推导的程序口径、重逢注入按名字触发与注入内容的程序口径、蓝图按楼层存 diff 与锁定与版本回看的程序口径、蓝图建议独立存放与逐条接受的程序口径、里程碑前提条件进伏笔账与章级规划读最近里程碑的程序口径、写作上下文只注入蓝图摘要的程序口径、拉力映射导演候选顺序与里程碑四态只读检查的程序口径、剧透读取视图与蓝图随卡导出恢复为默认蓝图的程序口径。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 至 HUMAN-18、HUMAN-20 至 HUMAN-22 待处理（HUMAN-22 阻塞 W3-T02.e，其余不阻塞）。
- HUMAN-19 待处理（阻塞 R6-T06、R6-T99、W2-T04）：`bg` 渠道 402 `insufficient_balance`，额度 2026-11-17T11:44:35Z 重置；或把 `roles.settler`/`roles.planner` 指到可用路由。

## 可重复命令
- 门禁：`pnpm check`。
- 全量 e2e：`pnpm e2e`（会先构建 server 与 web；跑两个项目）。
- 蓝图结构与存储目标测试：`pnpm exec vitest run packages/core/test/story-blueprint.test.ts`。
- 蓝图剧透、默认蓝图与剧透设置目标测试：`pnpm exec vitest run packages/core/test/blueprint-spoilers.test.ts`。
- 蓝图导出与导入目标测试：`pnpm exec vitest run packages/st-compat/test/blueprint-export.test.ts packages/st-compat/test/blueprint-export-cli.test.ts`。
- 蓝图读取视图接口目标测试：`pnpm exec vitest run packages/server/test/blueprint-suggestions.test.ts packages/web/test/api-client.test.ts`（server 用例先 `pnpm run typecheck`）。
- 写作上下文蓝图摘要目标测试：`pnpm exec vitest run packages/core/test/blueprint-summary.test.ts`。
- 里程碑铺垫目标测试：`pnpm exec vitest run packages/core/test/blueprint-milestones.test.ts packages/core/test/chapter-plan.test.ts`。
- 里程碑四态与偏离目标测试：`pnpm exec vitest run packages/core/test/blueprint-deviation.test.ts`。
- 拉力三档目标测试：`pnpm exec vitest run packages/core/test/director-lines.test.ts`。
- 蓝图建议目标测试：`pnpm exec vitest run packages/core/test/blueprint-suggestions.test.ts`。
- 线与动作目标测试：`pnpm exec vitest run packages/core/test/director-lines.test.ts`。
- 场面卡与章级规划目标测试：`pnpm exec vitest run packages/core/test/scene-card.test.ts packages/core/test/chapter-plan.test.ts`。
- 连载视图目标测试：`pnpm exec vitest run packages/core/test/serial.test.ts`。
- 导出成书目标测试：`pnpm exec vitest run packages/core/test/serial-book.test.ts packages/server/test/serial.test.ts packages/web/test/api-client.test.ts`（server 用例先 `pnpm run typecheck`）。
- 连载页面目标测试：`pnpm exec vitest run packages/web/test/serial-view.test.ts`。
- 连载页 e2e：`cd packages/web && pnpm exec playwright test serial.spec.ts`（需要先构建 server 与 web）。
- 玩家编辑变更卡与接口目标测试：`pnpm exec vitest run packages/core/test/ledger-cards.test.ts packages/server/test/panels.test.ts packages/web/test/api-client.test.ts`（server 用例先 `pnpm run typecheck`）。
- 人物档案与知情标注目标测试：`pnpm exec vitest run packages/core/test/character-profile.test.ts packages/core/test/scene-archive.test.ts`。
- 重逢注入目标测试：`pnpm exec vitest run packages/core/test/reunion.test.ts`。
- 推进档位接口目标测试：`pnpm exec vitest run packages/server/test/turns.test.ts -t "推进档位"`（先 `pnpm run typecheck`）。
- 重 roll 原因目标测试：`pnpm exec vitest run packages/core/test/reroll-reason.test.ts packages/core/test/preferences.test.ts packages/server/test/turns.test.ts packages/web/test/api-client.test.ts packages/web/test/push-reroll.test.ts`。
- 推进与重 roll 的 e2e：`cd packages/web && pnpm exec playwright test chat.spec.ts`（需要先 `pnpm --filter @dramaticer/server... --filter @dramaticer/web... build`）。
- 就地纠正与场面控制目标测试：`pnpm exec vitest run packages/core/test/scene-control.test.ts packages/server/test/branches.test.ts packages/server/test/turns.test.ts packages/web/test/scene-control.test.ts`。
- 检定工具与工具注册表目标测试：`pnpm exec vitest run packages/core/test/rule-tool.test.ts packages/core/test/plugin-background-tools.test.ts packages/core/test/deep-tools.test.ts packages/web/test/deep-turn.test.ts`。
- 结算与合并调用目标测试：`pnpm exec vitest run packages/core/test/ledger-settle.test.ts packages/core/test/gap-pass.test.ts`。
- 导入体检与模式目标测试：`pnpm exec vitest run packages/core/test/import-audit-report.test.ts packages/core/test/lore.test.ts packages/core/test/import-kind-suggest.test.ts packages/server/test/import-audit.test.ts`。
- 世界书分型目标测试：`pnpm exec vitest run packages/st-compat/test/worldbook-classify.test.ts`。
- 场记与对照目标测试：`pnpm exec vitest run packages/core/test/scene-log.test.ts packages/st-compat/test/scene-log-compare.test.ts packages/st-compat/test/scene-log-compare-batch.test.ts`。
- G0 仪器目标测试：`pnpm exec vitest run packages/st-compat/test/r6-instrument.test.ts`。
- 重 roll 回放目标测试：`pnpm exec vitest run packages/st-compat/test/r6-replay.test.ts`（约 7 秒）。
- 遗忘漏斗目标测试：`pnpm exec vitest run packages/st-compat/test/r6-funnel.test.ts packages/st-compat/test/probe.test.ts`。
- 门槛判定目标测试：`pnpm exec vitest run packages/st-compat/test/r6-gate.test.ts`。
- 门槛判定：`pnpm --filter @dramaticer/st-compat r6-gate --dir eval-private/reports/r6 [--instrument <path>] [--replay <path>] [--compare <path>]… [--deep <path>] [--preference <path>] [--funnel <path>] [--b1 <path>]… [--json <path>] [--report <path>]`。
- 蓝图导出到卡：`pnpm --filter @dramaticer/st-compat blueprint-export --card <路径> --db <路径> --story <id> --out <路径> [--node <id>]`。
- X2.d 重跑（断点续跑）：`node .devloop/scratch/X2.d/run-compare.mjs`；指标汇总：`node .devloop/scratch/X2.d/summarize.mjs`。
- 不变量检查：`node scripts/check-invariants.mjs`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。R6 与 X1、X2 的 JSON 含回复与答案，只能放在私有目录。场记对照的报告含楼层 id 与台账值，只能放在 `eval-private/`。
- 迁移 v67 之后 `assistant-store.test.ts` 的版本断言是 67；新增迁移要同步这个数字。
- 默认蓝图只由卡导入写入（`saveStoryBlueprintBaseline`），是故事级、与楼层无关的起点；不要把它写成楼层记录，也不要为了导入蓝图创建假楼层。条目按 id 排序后保存，读取顺序与 `applyBlueprintDiffs` 一致。
- 默认蓝图参加锁定检查：AI 不能改卡里锁定的条目。替换或清空默认蓝图不删除楼层上的修改记录；版本列表不把默认蓝图算成一版。
- 剧透过滤只在 `GET /api/stories/:id/blueprint` 上生效；不要把 `readBlueprintView` 的过滤结果写回存储，也不要让导演、章级规划、动作引擎或建议接受读过滤后的视图。建议列表是玩家主动发起的，不按剧透隐藏。
- 导出只改 `extensions.dramaticer.blueprint`：用 `attachBlueprintExtension` 深拷贝 `raw`，V1 写根节点、V2/V3 写 `data` 节点；条目为空时删掉该字段。不要手写 JSON 拼接，也不要把蓝图写进 `data` 根节点。
- 里程碑铺垫线的 id 只由 `milestonePromiseLineId` 生成：`milestone.` 加 sha256(里程碑 id + `\u0000` + 条件文本) 的前 16 位。改公式会让已有铺垫线换 id，下一章会重复补写，必须同时迁移线记录。
- 补写只发生在章级规划里；`chapterPlanNeedsRun` 的门槛（导演打开、这一场收尾、至少两条线、距上次清点够 `chapterFloors`、该楼层没有清点与线记录）不满足时不会补写。不要把补写塞进 `acceptBlueprintSuggestion`，那会让接受建议受伏笔上限影响。
- 里程碑达成没有单独的字段：前提条件对应的线在路径上都出现过、并且现在都不在 `readDirectorLineStates` 里才算 `reached`。没有前提条件的里程碑无法由伏笔账证明达成，`reached` 恒为 false，它仍然是最近方向但不生成线。
- 四态检查里 `lost` 先于 `achieved` 判定：章末清点显式 `retire` 的前提条件意味着方向已被放弃。只有 `blocked` 与 `lost` 带三个选择；检查本身不改写蓝图，也不该在任何后台任务里自动采纳其中一个。
- 历史线 id 只能从 `listDirectorLinesAlongPath` 取；不要用 `readDirectorLineStates` 判断「是否出现过」。
- 拉力只在 `lines` 组织方式、且玩家没有手动选推进档位时生效；`push` 的候选集合完全由推进档位决定。
- 蓝图总纲的 `tension` 是必填字段，但解析时缺失按 `medium` 补齐；新增总纲条目时写明档位。
- 写作上下文的蓝图摘要只注入三项：当前卷的核心问题、最近里程碑的方向、本章该埋的线。不要把 `premise` 的候选结局与红线、后面卷的里程碑或完整条目放进消息与 Trace 的来源描述。
- 摘要里的「本章该埋的线」只列 `missingLineIds` 对应的前提条件；前提条件通过 `active.lineIds` 的下标与 `prerequisites` 对齐，不要另算线 id。
- 新增上下文槽位要同步四处：`CONTEXT_SLOT_NAMES`、`chat/template.ts` 的段落与两种排布、`plugins/slots.ts` 与 `chat-providers.ts` 的装载、web 的 `SLOT_CHOICES`；`docs/plugins/code-plugins.md` 与 `docs/plugins/declarative-plugins.md` 的槽位清单由测试逐项核对。
- 蓝图与线同一做法：每个楼层按批次保存 `story_blueprints`，主键 `(node_id, seq)`，`diffs` 是 `set`/`delete`，沿路径从根开始累加；记录只追加。逐条接受建议时每接受一条追加一批。
- 蓝图的 `source` 分两层：记录列记这一批是谁写的（`player`/`ai`），条目里的 `source` 记这条内容的出处；锁定只拦 AI。
- 每一批蓝图修改应用之后用 `assertBlueprintEntries` 整批校验：总纲最多一条、里程碑的 `volumeId` 指向存在的卷、`after` 指向存在的里程碑且不成环、id 不重复。
- 蓝图建议独立存放：生成只写 `blueprint_suggestions`，玩家接受一条才用 `acceptBlueprintSuggestion` 写一批。锁定过滤只走 `filterLockedBlueprintDiffs`。
- 建议的标题 80 字、理由 500 字、补充说明 500 字；一次请求 1 到 5 条建议，每条最多 50 条修改。模型输出未知字段或形状错误整批拒绝。
- 线的存储写法与导演手记一致：每个楼层一行、`diffs` 是 `set`/`delete` 数组、沿路径从根开始累加；同一楼层重复写入直接失败。倒计时的有效余量用 `directorLineRemaining`。
- 八种动作的判定口径、优先级与常量写在 ADR-0143；`selectDirectorAction` 只接受内存输入，不读数据库、不调用模型。需要读场记、线与决策记录时用 `readDirectorActionInput`。
- 推进档位是**单轮参数**，不写故事设置；`push` 只接受 `advance`、`quick`、`jump`，`null` 表示常规回合。
- 章末清点记录只追加：同一楼层第二次写入直接失败，UPDATE 被触发器拒绝。写入前必须用 `assertChapterReviewMatchesLines` 对照当前路径。
- `focus` 固定 2–3 条且不能包含同一份清点里 `retire` 的伏笔；`promises` 只写清点之前已经存在的 `promise` 线。
- 章级规划输出先写清点再写线：`saveDirectorChapterPlan` 保证同一事务。
- `story_settings.director_organization` 的 CHECK 允许 `mechanisms`、`bits`、`lines`；新增组织方式时要重建表并同步 `assistant-store.test.ts` 的 schema 版本。
- 场记对照、导入审计、规则执行、状态定义、场面卡、人物档案、重逢注入的既有口径保持不变；参考上一次交接的注意事项与对应 ADR。
- 世界书槽位在导入过的故事里 Trace 来源带「升级」或「原样」前缀；改这个字符串时要同步 `packages/st-compat/test/chat-cli.test.ts`。
- 升级模式不注入状态定义、条件内容、事件与舞台、写作指令、表现资源、作者选项、插件残留与未识别条目。
- `import_audit_entries` 的 `source` 必须与 lore 条目同构；`importWorldInfoLore` 是唯一写审计的路径。只有 `kind = plugin-residue` 的条目可以转成初始记忆。
- 规则声明只在卡导入时整批替换；检定固定 d20，`difficulty` 1 到 20；`rule_check` 只做参数校验与声明查找。
- 状态定义段的截断上限是 `STATE_DEFINITION_ENTRY_CHAR_LIMIT`（800）与 `STATE_DEFINITION_TOTAL_CHAR_LIMIT`（4,000）；`gap_pass` 复用同一个 `formatStateDefinitions`。
- 导入体检页的「全部条目」是玩家改过类型后的恢复入口；`source` 含冒号时客户端必须 `encodeURIComponent`。
- 场次划分只数助手楼层；场次归档以结束楼层为主键。`readCharacterProfiles` 的出处是场次，不是单个楼层。
- `profile` 槽位的在场名单取最近一条场记，没场记时取最后一场归档；重逢注入的「最近窗口」只看当前楼层之前的原文。
- 玩家直接编辑台账只走 `createPlayerLedgerChangeCard`；批准后事实来源为 `player`，说明同时写一条 `userWill` 纠正。
- 连载视图四块数据只从当前路径派生；前情提要只收已归档场次；时间线只把来源 `player` 的 `time.current` 当跳跃。同一路径两次导出逐字节一致。
- 就地纠正的 `quote` 必须逐字出现且只出现一次；模型只输出改写段。场面控制只接受当前路径的助手楼层。
- `scene_archives.profiles` 与 `.informed` 的校验在 `saveSceneArchive`；档案字段没有变化时写 `null`。
- 采样种子只在需要两次同配置生成时使用（A/A 与重 roll 回放）；它进入缓存键。Google 适配器忽略 `seed`。R6 的真实批次仍被 HUMAN-19 阻塞。
- 长任务脚本只构建 `st-compat`，不会重建 `packages/core/dist`。改过 core 之后必须先跑 `pnpm run typecheck`。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁会撞上 vitest 的 `[vitest-worker]: Timeout calling "onTaskUpdate"`：先看是不是某个用例单文件耗时过长，不要连续无改动地跑整仓测试。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- `.devloop/scratch/` 下的脚本要用 `createRequire` 指向 `packages/st-compat/package.json` 才能加载 `better-sqlite3`；`.devloop/` 已被 git 忽略。
- EJS 沙箱的时间预算按墙钟计；测试不要用接近 worker 启动耗时的预算。
- `pnpm exec biome check --write <文件>` 处理格式；不要手写格式。新建文件用 LF 写入后 biome 会改成仓库的 CRLF，提交前必须跑一次。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I8 显示与 prompt 从原文派生，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I16–I18 插件约束。
- 故事图片：`story_media` 是唯一的图片索引，文件不放进数据库；封面无图时永远返回占位图。
- e2e 的 `serve.mjs` 启动时清空 `.devloop/scratch/e2e/work`；Playwright 的 mobile 与 desktop 两个项目共用同一个数据库，测试标题必须带唯一 id。`serial.spec.ts` 用固定故事 `e2e-serial`。
- 台账页只在选中楼层后渲染故事级区块；e2e 要显示立绘得先给故事补一层。
- 合并后台调用（场记）必须先通过结算一致率对照才能切默认；`gapPassEnabled` 与 `sceneLogEnabled` 在对照通过前保持关闭。
- 重 roll 的原因可以省略；界面先弹出六项原因，选中后才重写。原因进 swipe 载荷的 `reason`、写成一条来源为玩家的长期纠正，并以 system 消息追加在历史与导演之后（ADR-0149）。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- 世界模型只用故事设置 `worldModel` 选择；状态槽位的 `packKey` 必须带种类（`state:<kind>`）。导演组织方式只用 `directorOrganization` 选择。
- 剧情小品的条件是 `{kind:"text", text}` 或 `{kind:"ledger", query}`；兜底小品必须省略条件。
- 实体档案（`wiki`）的写入路径是 `["profile", "<人物>"]`；`world_wiki_revisions` 只追加。
- 显示状态只在当前会话；需要跨进程显示时由台账快照重新渲染。共存适配器在 `apply` 之后按轮调用 `afterTurn`；插件写错直接让运行失败。
- `st-helper-host` 的共存批次不执行脚本：Node 里没有 iframe。EJS 模板里再写 `<%` 会被外层标签解析截断；模板函数是同步的。
- 模板生成只登记请求：`generate` 返回 id 不返回正文；STscript 的 `/gen` 与 `/genraw` 只登记后台请求。
- HTML 状态栏与开场页的渲染结果只在插件显示状态；状态栏自动重渲染默认上限 8 次。
- 助手任务不要复用 `turn_runs`；助手运行状态与事件在 `assistant_conversations`、`assistant_events` 里。技能注册表以 `packages/core/src/assistant/skills.ts` 为唯一来源。
- 渠道读取不返回密钥值；`propose_channels_change` 四个段必须给全。压缩记录只追加。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以；助手类型从 `@dramaticer/protocol` 取。
- 上下文排布的设置只对内置默认模板生效；模板表单的 `SLOT_CHOICES` 必须覆盖 `CONTEXT_SLOT_NAMES` 的全部槽位。
- 移动端故事导航是固定 10 列栅格（聊天、导入、体检、分支、台账、连载、导演、生图、设置、渠道）；新增 tab 时同步改 `styles.css` 的 `repeat(10, …)` 与 `StoryPage` 的 `TABS`。
