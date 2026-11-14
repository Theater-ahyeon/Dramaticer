# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-14 会话 408：完成 W4-T01（线与八种动作引擎）。迁移 v58 新增 `director_lines`（每楼层保存 `set`/`delete` 修改，沿路径累加，写法与 `director_notes` 一致）；`packages/core/src/director/lines.ts` 定义四类线（`main`、`relationship`、`opposition`、`promise`）、字段校验、`applyDirectorLineDiffs` 与 `directorLineRemaining`。冷热不落库：`readDirectorLineStates` 返回 `openedDepth` 与 `lastTouchedDepth`（单位是路径上的助手楼层数），倒计时的有效余量按当前深度减上次触及深度推进。`DIRECTOR_ORGANIZATION_KINDS` 增加 `lines`；纯函数 `selectDirectorAction` 按「让位、闯入、兑现、揭示、转场、喘息、加码、接球」的顺序选动作，同一动作连续两次后禁止第三次，理由写进决策记录的 `mechanisms[].reason` 与 `signals.reason`，槽位来源是 `director:action:<kind>`，`explain` 第 6 节可读。X2 对比实验改用固定的 `X2_DIRECTOR_ORGANIZATION_KINDS`（`mechanisms`、`bits`），新增组织方式不自动进入实验。新增 19 个测试。门禁通过（282 个测试文件、2,410 个测试、5 个跳过）。

## 下一步（会话 409 先做）
1. **W4-T02 推进三档、伏笔账与章末清点**（依赖 W4-T01，已满足）：三档推进进入单轮参数并影响动作集合；未兑现伏笔上限默认 5；章末清点只追加记录。动作集合在 `selectDirectorAction` 的候选顺序上扩展，不要另写一套选择器。
2. **W4-T03 场面卡与章级规划**：场面卡并入 `scene_log` 输出并作为槽位注入；章末规划用一次后台调用更新线，可走 `planner` 角色的更强模型；补上场卡后把「场面目标已达成」从 `sceneEnds` 代理换成场面卡的目标。
3. R6 段：**R6-T07.b**（重 roll 点回放批次）、**R6-T07.c**（遗忘漏斗）、**R6-T07.d**（门槛判定 CLI）→ **R6-T99**；**R6-T06** 与 W2-T04 被 HUMAN-19 阻塞（`bg` 渠道额度 2026-11-17T11:44:35Z 重置）。
4. **W3-T02.e** 被 HUMAN-22 阻塞：原样模式目前按导入字段注入；完整酒馆激活需要原始世界书入库并把 `st-content` 接进 server 运行时。
5. **W2-T04** 继续被 HUMAN-19 阻塞。额度恢复后用 `pnpm --filter @dramaticer/st-compat scene-log-compare`（默认读 `eval-private/reports/scene-log/samples.json`，24 个楼层 ≥ 20）跑真实对照。不达标时保留独立任务并写 ADR。
6. R6 段之后继续 **W5-T01、W5-T02** → **W6-T01 至 W6-T03** → **W7-T01 至 W7-T03** → **W8-T01、W8-T02** → **W9-T01 至 W9-T99**。
7. R6-T07.b 的实现要点（旧交接保留）：
   - 新增 `evalset/r6-replay.ts` 与 CLI：从 `eval-private/world-model-compare/source/<slug>.db` 规划重 roll 点（`xianxia` 24、`yuwang` 8、`yinqi` 11），被接受的是 head 路径上的助手兄弟楼层（43 个点都是最大 swipe 下标），放弃侧取下标紧邻其下的那条，另有 5 条更早的放弃 swipe 只报告。
   - 每个点复制数据库、head 移到父玩家楼层、预热 12 楼，先按种子 1 生成一次原生续写（同时是 G1 的续写与 A/A 的第一次生成），再按种子 2 生成一次（只用于 A/A）；同一请求体只差种子，会命中响应缓存（ADR-0136）。
   - 每次生成后写 A/A 样本 JSONL，再调用 `runR6AaInstrument`（`dir` 用自己的运行目录）得到 G0 的 A/A 侧；G1 的两组配对（对放弃侧、对接受侧）各两种顺序判一次，汇总产出 `R6ReplayGateInput`。
   - sidecar 校验故事、分支点、玩家消息、swipe 下标、模型与种子；`done` 复用，`running` 与 `failed` 续跑；失败样本单独计数。
8. 阻塞检查：M6-T99 仍等 HUMAN-15；HUMAN-03、HUMAN-16、HUMAN-17、HUMAN-18、HUMAN-20、HUMAN-21 不阻塞；HUMAN-19 阻塞 R6-T06、R6-T99、W2-T04；HUMAN-22 阻塞 W3-T02.e。

## 当前状态
- 已完成：F0、M0–M3、D、M4-T00 至 M4-T06、R0、R1（含 R1-T99、R1-T99.a）、R3、O、R2、E、R4、R5、V-T01、M6-T00 至 M6-T05、R3b、P1–P4、C-T01 至 C-T05、H-T00 至 H-T99、X1.a 至 X1.e、X2.a 至 X2.d、R6-T00 至 R6-T05、R6-T07、R6-T07.a、W0-T00、W0-T01、W1-T01、W2-T01、W2-T02、W2-T03、W3-T01、W3-T02.a、W3-T02.b、W3-T02.c、W3-T02.d、W3-T03.a、W3-T03.b、W3-T03、W4-T01。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 设计版本 v0.4（ADR-0139、ADR-0142、ADR-0143）。W 阶段任务顺序：W0（完成）→ W1（完成）→ W2（T01–T03 完成，T04 被阻塞）→ W3（T01、T02.a–T02.d、T03.a、T03.b、T03 完成，T02.e 被 HUMAN-22 阻塞）→ W4（T01 完成）→ R6 段（T07.b、T07.c、T07.d、T99）→ W5 → W6 → W7 → W8 → W9。
- 数据库 schema 版本 58（v51 `story_media`、v52 `story_settings.contextLayout`、v53 `scene_logs` 与 `scene_log_enabled`、v54 `scene_archives`、v55 `import_audit_entries` 与 `story_settings.import_mode`、v56 `import_audit_entries.memory`、v57 `story_rules`、v58 `director_lines`）。
- 导演的线：`director_lines(node_id PRIMARY KEY, story_id, diffs, created_at)`，一行一个楼层的线修改；`set` 带完整线，`delete` 只带 id。存储层 `saveDirectorLines`（同楼层重复写入失败）、`getDirectorLines`、`readDirectorLineStates`；冷热由读取路径上的助手楼层数派生，其他分支不参与累加。线字段：`id`（≤64 字）、`kind`（`main`、`relationship`、`opposition`、`promise`）、`who`、`want`、`obstacle`、`countdown`（非负整数或 null）、`preparations`（最多三条、不重复、每条 ≤500 字）。单条文本 ≤500 字，每个楼层最多 50 条修改。
- 动作引擎：`DIRECTOR_ORGANIZATION_KINDS` 是 `mechanisms`、`bits`、`lines`，默认仍是 `mechanisms`。`lines` 引擎的 `mechanismNames` 为 null，决策记录的机制条目固定为 `action`，信号带 `organization`、`action`、`label`、`reason`、`lineId`、`floorDepth`、`recentActions`、`blockedAction`、`candidates`、`present`、`lineCount` 与三个阈值。八种动作的判定口径与优先级见 ADR-0143；动作选择的输入是内存里的 `DirectorActionInput`，数据库读取只在 `readDirectorActionInput` 里发生。动作建议的 `directive` 只写局面与人物意图，`DIRECTOR_SUFFIX_NOTE` 仍然由槽位追加。
- X2 对比实验：`X2_DIRECTOR_ORGANIZATION_KINDS` 固定为 `mechanisms` 与 `bits`；sidecar 校验只接受这两个。`DIRECTOR_ORGANIZATION_KINDS` 是全部合法组织方式，增加种类时不要改 X2 的候选清单。
- 导入审计：`import_audit_entries` 每条对应一个世界书条目（含停用与空内容），主键 `(story_id, source)`，与 `lore_entries.source` 同构（`<前缀>:<世界书名称>:<条目键>`）；`matches` 存分型器给的规则命中，`rule_primary` 是规则首要类型，`kind` 是生效类型，`kind_source` 为 `rule`/`model`/`player`，`memory` 表示已转为初始记忆。重复导入只更新标题、正文、规则判定与 `constant`；只有 `kind_source = rule` 的 `kind` 跟着新规则变，`memory` 不变。
- 导入模式：`story_settings.import_mode` 取 `upgrade`（默认）或 `raw`。核心的 `createLoreSlotProvider` 每轮读取设置与 `listImportAuditInjectionRules`：`raw` 用 lore 表的 `constant` 与关键词；`upgrade` 里常识全文、实体索引常驻，实体详情与规则命中时注入，其余类型不进入世界书段；`memory = 1` 的条目两种模式都不常驻、只按命中注入（标签【记忆】）；没有审计行的条目按 raw 处理。Trace 来源带「升级/原样」前缀。
- 导入记忆转换：`setImportAuditEntryMemory(storyId, source, memory)` 只允许 `kind = plugin-residue` 的条目转记忆（撤销不限制类型），转换时把同来源的 lore 条目 `constant` 置 0，撤销时回到审计行的导入值；同一事务里清空该故事的上下文包缓存。API：`PUT .../import-audit/entries/:source/memory`、`POST .../import-audit/memory`；`source` 含冒号，客户端必须 `encodeURIComponent`。
- 导入体检接口与页面：`buildImportAuditReport` 输出 `{storyId,total,counts,entries,unknown,authorOptions,pluginResidue,tokens}`；web 路由 `/stories/:id/audit`，三组审查条目、逐条改类型、恢复规则判定、升级/原样切换与插件残留转换都在这里。
- 规则声明：`story_rules(story_id, rule_id, payload, created_at)` 存卡的 `extensions.dramaticer.rules`；`replaceStoryRules` 整批替换并在写入时校验，`listStoryRules` 读回时再校验。`DramaticerCardExtension.rules` 是解析后的声明；`importDramaticerExtension` 返回 `rules.replaced`，`ImportStoryCounts` 有 `rules`。
- 规则执行：`executeRuleCheck(rule, {snapshot, roll?})` 返回 `{ruleId,label,target,roll,difficulty,success,resource,writes}`；骰子固定 d20，`difficulty` 1 到 20，成功条件是 `roll >= difficulty`。`writes` 先写 `mvu.<resource.path>` 的余量（`before - cost`），再写 `rule.<id>.result`。声明只在导入时替换，不按楼层存。
- 检定工具：`rule_check` 的内置定义在 `tools/rule-tools.ts`，权限 `propose`，参数只有 `ruleId`；`executeRuleCheckTool` 先校验参数，未知规则列出已声明的 id，再按 `getStateSnapshot(beforeNodeId)` 加本回合已收集的 `proposedStateUpdates` 得到快照并调用 `executeRuleCheck`；返回工具文字与待提交写入。`turn.ts` 用 `store.listStoryRules(storyId).length` 决定是否把工具发给模型；没有声明时放进 `disabledTools` 并带 `disabledReason`。`tools/registry.ts` 的 `DeepToolDefinition` 新增可选 `disabledReason`，只有 `disabledTools` 里的定义会读它。内置工具注册表因此有十一个工具，快回合名单为四个只读工具加 `rule_check`。规则写入的验收路径：`prepareSettlementForNodes` 的 `WindowFloor.covered` 含这两条、`invalid` 为空，`rule-tool.test.ts` 有对应用例。
- 台账 `rule` 命名空间：只允许 `rule.<id>.result`，值为 `{roll,difficulty,success}`；`success` 必须等于 `roll >= difficulty`，未知字段与越界值都报错。`LEDGER_NAMESPACES` 现在是十个。
- 状态定义：`SettlementWindow.stateDefinitions` 来自生效类型为 `state` 的审计条目；`buildSettlementMessages` 与 gap_pass 的系统提示词带「卡定义的状态定义」段，`formatStateDefinitions` 每条截 800 字、合计 4,000 字封顶并追加省略标记。状态变量由结算器按 `mvu.<变量路径>` 写入；升级模式的世界书段不含这些条目。
- 世界书分型：`classifyWorldbookEntries(entries)` 只读 `StWorldInfoEntry`，返回 `{entries, counts}`；每条有 `matches[{kind, rules}]`、`primaryKind`、`mixed`。`primaryKind` 取 `IMPORT_ENTRY_KINDS` 顺序里第一个命中类型（`common` 最前，`unknown` 最后）。
- 场记：`scene_log` 默认关闭（`sceneLogEnabled`）；打开后与结算、现场分析、用户意志、小品条件并行运行，尚未替换它们（W2-T04 按对照结论切换）。`scene_logs` 一行一个助手楼层，`states` 存引文已核对的提案，`quotes` 记提交/核验数，`repairs` 记引文与形状拒绝加上结算器的非 `fill` 修复。
- 场次：`readSceneSegments` 沿给定节点路径派生；`sceneEnds` 的楼层收尾这一场，否则到 `DEFAULT_MAX_SCENE_FLOORS`（12）个助手楼层强制收尾；场次不是节点，不写 `nodes`。`scene_archives` 以结束楼层为主键，`boundary` 记 `scene-ends` 或 `max-floors`。
- 场记对照：`compareSceneLog` 逐楼层跑独立任务（`settle`、`scene`、`user_will`、`director_bits`）与 `scene_log`；`runSceneLogCompareBatch` 负责复制源库、按故事汇总与样本判定。私有样本清单 `eval-private/reports/scene-log/samples.json`，`minimumFloors` 20，3 个故事各 8 个助手楼层（共 24）；`sourceDb` 相对样本文件。重生成用 `.devloop/scratch/W2-T03/plan-samples.mjs`（只读打开源库）。
- 上下文排布：默认模板按易变性排布；`contextLayout` 取 `volatility`（默认）或 `full`（对照）。自定义模板不参与这个开关，Trace 的 `layout` 记为 `custom`。`segmentOrder` 是模板片段 id 的生效顺序，`cache.source` 为 `channel` 或 `none`；旧 Trace 没有这三个字段。
- 上下文包缓存：`loadReusableContextPack` 按指纹与引用校验；导入模式变化与记忆转换会调用 `clearContextPacks(storyId)`。
- 故事图片：`story_media` 存相对路径，文件在媒体目录（默认数据库同目录的 `images/`）的 `story-media/<故事 id 摘要>/` 下，按内容哈希命名；封面缺失时由 `packages/server/src/cover-placeholder.ts` 渲染 SVG 占位图，不写磁盘。
- R6-T06 标 `[!]`（HUMAN-19）；R6 预注册 v2、门槛 G0–G6 与 ADR-0135/0138 不变；R6-T05 的深回合数据仍是 `v1`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成；`st-content` 的世界书激活只在共存评测里使用，没有接进 server 运行时。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`、`H.md`、`X1.md`、`X2.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；需要恢复原始预设时用 `sandbox --replace` 重建。
- ADR-0088 至 ADR-0143 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染、覆盖率口径、应用内助手、世界模型接口、实体档案、时序图谱、对比运行器、X1 判定、导演组织方式、剧情小品、X2 对比运行器、X2 判定、R6 预注册、评测调用输出预算、结算提示词楼层 id、v4 设计合并、故事图片、导入模式与初始记忆、规则声明与状态定义、线与八种动作的程序判断口径。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 至 HUMAN-18、HUMAN-20 至 HUMAN-22 待处理（HUMAN-22 阻塞 W3-T02.e，其余不阻塞）。
- HUMAN-19 待处理（阻塞 R6-T06、R6-T99、W2-T04）：`bg` 渠道 402 `insufficient_balance`，额度 2026-11-17T11:44:35Z 重置；或把 `roles.settler`/`roles.planner` 指到可用路由。

## 可重复命令
- 门禁：`pnpm check`。
- 全量 e2e：`pnpm e2e`（会先构建 server 与 web；跑两个项目）。
- 线与动作目标测试：`pnpm exec vitest run packages/core/test/director-lines.test.ts`。
- 组织方式与旧导演目标测试：`pnpm exec vitest run packages/core/test/director-organization.test.ts packages/core/test/director.test.ts packages/core/test/explain.test.ts`。
- X2 对比运行器目标测试：`pnpm exec vitest run packages/st-compat/test/director-organization-compare.test.ts`。
- 检定工具与工具注册表目标测试：`pnpm exec vitest run packages/core/test/rule-tool.test.ts packages/core/test/plugin-background-tools.test.ts packages/core/test/deep-tools.test.ts packages/web/test/deep-turn.test.ts`。
- 规则声明与状态定义目标测试：`pnpm exec vitest run packages/core/test/ledger-rules.test.ts packages/core/test/ledger.test.ts packages/st-compat/test/dramaticer-extension.test.ts`。
- 结算与合并调用目标测试：`pnpm exec vitest run packages/core/test/ledger-settle.test.ts packages/core/test/gap-pass.test.ts`。
- 导入体检 e2e：`cd packages/web && pnpm exec playwright test import-audit.spec.ts`（需要先构建 server 与 web；`pnpm --filter @dramaticer/web e2e` 会先构建）。
- 导入审计目标测试：`pnpm exec vitest run packages/core/test/import-audit.test.ts packages/st-compat/test/import-audit.test.ts`。
- 导入体检与模式目标测试：`pnpm exec vitest run packages/core/test/import-audit-report.test.ts packages/core/test/lore.test.ts packages/core/test/import-kind-suggest.test.ts packages/server/test/import-audit.test.ts`。
- 后台任务注册表目标测试：`pnpm exec vitest run packages/core/test/plugin-background-tools.test.ts`。
- 世界书分型目标测试：`pnpm exec vitest run packages/st-compat/test/worldbook-classify.test.ts`。
- 沙箱世界书分型统计：`node .devloop/scratch/W3-T01/stats.mjs`（只读打开沙箱世界书与卡；先 `pnpm run typecheck` 让 `dist` 更新）。
- 场记与对照目标测试：`pnpm exec vitest run packages/core/test/scene-log.test.ts packages/st-compat/test/scene-log-compare.test.ts packages/st-compat/test/scene-log-compare-batch.test.ts`。
- 场次与归档目标测试：`pnpm exec vitest run packages/core/test/scene-archive.test.ts packages/core/test/explain.test.ts`。
- 设置与模板接口目标测试：`pnpm exec vitest run packages/server/test/stories.test.ts`。
- 故事媒体目标测试：`pnpm exec vitest run packages/server/test/story-media.test.ts packages/core/test/story-media.test.ts`。
- 场记对照（固定楼层清单、源库只读、副本运行）：`pnpm --filter @dramaticer/st-compat scene-log-compare [--samples <json>] [--dir <path>] [--json <path>] [--report <path>] [--model <alias>] [--window <n>] [--min-samples <n>]`。
- G0 仪器目标测试：`pnpm exec vitest run packages/st-compat/test/r6-instrument.test.ts`。
- R6 门槛与指标的目标测试：`pnpm exec vitest run packages/st-compat/test/gates.test.ts packages/st-compat/test/metrics.test.ts`。
- R6 深回合目标测试：`pnpm exec vitest run packages/st-compat/test/r6-deep.test.ts packages/st-compat/test/deep-eval.test.ts`。
- R6 B1 批次目标测试：`pnpm exec vitest run packages/st-compat/test/r6-b1.test.ts`（约 10 秒）。
- R6 C1 运行器目标测试：`pnpm exec vitest run packages/st-compat/test/r6-compare.test.ts`（约 55 秒）。
- R6 偏好一致率目标测试：`pnpm exec vitest run packages/st-compat/test/r6-preference.test.ts`（约 2 秒）。
- R6 分支计划（三故事，打印每故事的 9 个分支点楼层）：`node .devloop/scratch/R6-T06/plan-branches.mjs`。
- R6 B1 三故事长任务：`node .devloop/scratch/R6-T06/run-b1.mjs`（复用 sidecar）。
- R6 C1 三故事长任务：`node .devloop/scratch/R6-T06/run-compare.mjs`（复用 sidecar）。
- R6 深回合三故事长任务：`node .devloop/scratch/R6-T05/run-deep.mjs`（复用 sidecar）。
- G0 两件仪器：`pnpm --filter @dramaticer/st-compat r6-instrument --aa <aa-samples.jsonl> [--pairs <pairs>] [--label-records <judge>] [--dir <运行目录>] [--json <结果>] [--report <报告>]`。
- R6 偏好一致率：先 `pnpm --filter @dramaticer/st-compat preferences export --db <源库> --out <导出目录>`，再 `pnpm --filter @dramaticer/st-compat r6-preference --db <源库> --pairs <导出目录> --dir <运行目录> --json <结果 json> --report <报告 md>`。
- 判定与模拟用户重试目标测试：`pnpm exec vitest run packages/st-compat/test/pairwise.test.ts packages/st-compat/test/playtest.test.ts packages/st-compat/test/probe.test.ts`。
- X2.d 重跑（断点续跑）：`node .devloop/scratch/X2.d/run-compare.mjs`；指标汇总：`node .devloop/scratch/X2.d/summarize.mjs`。
- X1 长任务（重跑会复用 sidecar）：`node .devloop/scratch/X1.e/run-compare.mjs`。
- 不变量检查：`node scripts/check-invariants.mjs`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。R6 与 X1、X2 的 JSON 含回复与答案，只能放在私有目录。场记对照的报告含楼层 id 与台账值，只能放在 `eval-private/`。
- 导入审计的 `content` 是导入时的原文快照，与 `lore_entries.content`（去掉首尾空白）分开保存；体检页要显示条目正文时优先读审计行，停用条目没有 lore 行。
- 审计的 `source` 必须与 lore 条目同构；`importWorldInfoLore` 是唯一写审计的路径，`importCharacterBookLore` 通过它转发。不要绕过它在别处拼来源。
- `kind_source = rule` 的条目不要用 `setImportAuditEntryKind` 写成别的类型；回到规则判定时 `kind` 必须等于 `rule_primary`。
- 只有 `kind = plugin-residue` 的条目可以转成初始记忆；撤销不限制类型。转换与撤销都在同一事务里更新审计行、lore 的 `constant` 与上下文包缓存。
- 体检 token 两侧都只算真正导入成 lore 的条目，且排除 `memory = 1` 的条目；`before` 是原样模式的常驻全文，`after` 是升级模式的常识全文加实体索引。估算不调用模型、不落盘。
- 世界书槽位在导入过的故事里 Trace 来源带「升级」或「原样」前缀，没有审计行的故事保持旧字符串；改这个字符串时要同步 `packages/st-compat/test/chat-cli.test.ts`。
- 升级模式不注入状态定义、条件内容、事件与舞台、写作指令、表现资源、作者选项、插件残留与未识别条目；状态定义由结算器消费（W3-T03.a），其余类型的消费者分别是 W4、W6、W9。
- 规则声明只在卡导入时整批替换；`story_rules` 的 `payload` 是解析后的声明，读取时重新校验。规则 id 在故事内唯一，重复导入不保留旧声明。
- 检定固定 d20，`difficulty` 1 到 20；不要在别处另写一套骰点或成功率公式。资源路径相对卡变量，执行时统一加 `mvu.` 前缀。
- `rule_check` 只做参数校验与声明查找，掷骰与资源扣减全部交给 `executeRuleCheck`；不要在工具层再掷一次，也不要自己算余量。
- `rule_check` 的快照是本回合已收集的 `proposedStateUpdates` 叠加到 `getStateSnapshot(beforeNodeId)` 上；这样同一回合连续检定不会重复扣减，结算器仍按楼层 diff 复核（I12）。
- 没有规则声明时不要把 `rule_check` 发给模型；`disabledTools` 里的定义带 `disabledReason`，执行器写进 Trace 与工具结果。`disabledReason` 只用于停用列表，不要加到启用工具的定义上。
- 规则写入的校验断言用 `prepareSettlementForNodes(store, storyId, [nodeId])` 的 `WindowFloor`：`covered` 应含规则路径、`invalid` 为空；不要绕过结算窗口另写一套路径检查。
- `rule.<id>.result` 的 `success` 必须与 `roll >= difficulty` 一致；不要放宽成任意布尔值，否则结算器与读取端会接受自相矛盾的事实。
- 规则结果与资源余量是回合内写入，仍由后台结算窗口的 `readWindowFloor` 校验；非法条目会被删除并记入 `repairs`（I12）。
- `executeRuleCheck` 的 `roll` 只在测试与回放里显式传入；生产由 `Math.random` 取 1 到 20。
- 状态定义段的截断上限是 `STATE_DEFINITION_ENTRY_CHAR_LIMIT`（800）与 `STATE_DEFINITION_TOTAL_CHAR_LIMIT`（4,000）；`gap_pass` 复用同一个 `formatStateDefinitions`，不要两处各写一份。
- 线的存储写法与导演手记一致：每个楼层一行、`diffs` 是 `set`/`delete` 数组、沿路径从根开始累加；`saveDirectorLines` 对同一楼层重复写入直接失败，规划器要改写时先读回或换一个楼层。
- 线的冷热与倒计时深度单位是**助手楼层数**（当前路径上 `role = "assistant"` 的节点个数）；读取在 `readDirectorLineStates` 里用 `getPathToNode` 一次算出深度表，不要另写递归查询。
- 倒计时的有效余量用 `directorLineRemaining`：`countdown - (当前深度 - lastTouchedDepth)`；不要在每个判断处重算 `countdown`，否则「按楼推进」的口径会散落多处。
- 八种动作的判定口径、优先级与常量写在 ADR-0143；`selectDirectorAction` 只接受内存输入，不读数据库、不调用模型。需要读场记、线与决策记录时用 `readDirectorActionInput`，不要在判断函数里传 `StoryStore`。
- 动作的 `directive` 只写局面与人物意图；`DIRECTOR_SUFFIX_NOTE` 由槽位统一追加，不要在动作里再复述玩家优先。
- 决策记录里的机制名固定是 `action`；动作种类在 `signals.action`，理由在 `mechanisms[].reason` 与 `signals.reason`。`explain` 第 6 节直接打印这些字段，不要为动作另开一节。
- 槽位来源是 `director:action:<kind>`（英文 kind），改格式时同步 `director-lines.test.ts` 与 explain 相关断言。
- 同一动作的抑制读最近两条决策记录的 `signals.action`；`readDirectorActionInput` 只取最后两条，判断函数自身不读历史。
- 增加导演组织方式时改 `DIRECTOR_ORGANIZATION_KINDS`；X2 的实验候选固定为 `X2_DIRECTOR_ORGANIZATION_KINDS`，不要让它跟着合法集合扩张。
- `assistant-store.test.ts` 把 schema 版本钉在最新值，新增迁移时要同步改这个数字；其他存储测试用 `LATEST_SCHEMA_VERSION`，不要改。
- `import_kind` 的 `needsRun` 只看 `kind = unknown` 且 `kind_source = rule` 的条目；模型回复 `unknown` 时也记 `kind_source = model`。
- `import_kind` 每轮最多 320 条（40 条 × 8 批），响应里出现本批之外的来源或重复来源整批拒绝；送进提示词的正文截到 800 字。
- 世界书分型的 `counts` 是每类命中数，一个条目可计入多类；要条目数用 `entries.length`。`primaryKind` 按 `IMPORT_ENTRY_KINDS` 顺序取第一个命中，`unknown` 排最后。
- 世界书分型是纯函数：不读磁盘、不调用模型、不改写入参；测试只用 fixture（I10）。
- `st-content` 的世界书激活（`activateStWorldInfo`、深度注入、计时效果）只在共存评测里使用；server 运行时没有接入，原样模式不是完整酒馆语义（ADR-0141、W3-T02.e）。
- W 阶段的顺序写在 TASKS 里：W1–W4 → R6 段 → W5–W9。R6-T07.b 与 R6-T06 的真实批次需要 `background` 渠道，额度恢复前只能做代码与假客户端测试。
- W2-T04 的切换条件是结算一致率不低于独立任务（ADR-0055 口径），不达标时保留独立任务并写 ADR；不得为了让场记上线而放宽对照。
- 场记对照的样本清单是固定输入：`samples.json` 的 `minimumFloors` 与 `nodeIds` 改动后，新旧结果不可直接比较；`sourceDb` 相对样本文件，源库只读，副本写到运行目录的 `runs/<故事>/`，每次重建。
- 对照的两边用同一个模型、各用一个响应缓存目录（`<cache>/independent` 与 `<cache>/merged`）；共用一个缓存会让场记档复用独立档的响应。
- `fill` 不算拒绝：逐楼层的 `independentRepairs` 与 `mergedRepairs` 都排除了 `fill`，只保留引文、形状、冲突与状态改写这类真正的修复与拒绝。
- 场记与独立任务目前并行：打开 `sceneLogEnabled` 后 `scene_log`、`scene_archive` 与 `settle`、`scene`、`user_will`、`director_bits` 都会入队，切换只由 W2-T04 做；对照实验里场记一侧的库不要跑独立任务。
- `scene_log` 的 `states` 每条必须带 `sourceQuote`，引文逐字比对任务楼层的原文（`node.raw`），不跨楼层；结算路径的 `settle` 模型如果也给了 `sourceQuote`，同样逐字校验。
- `scene_log` 重跑同一楼层时 `getLedgerSettlement` 已有记录就跳过 `applySettlementProposals`，只覆盖场记行。
- 场次划分只数助手楼层：一场是 `[第一个助手楼层, 结束助手楼层]` 的闭区间；`sceneEnds` 为 true 的楼层是这一场最后一楼，达到 `DEFAULT_MAX_SCENE_FLOORS`（12）时同样强制收尾。
- 场次归档以**结束楼层**为主键；判断是否需要重跑时要同时比对 `startNodeId`、`floorCount` 与 `boundary`。
- `scene_archive` 是故事级任务：`nodeId` 为 null，处理器不能调用 `requireJobNodeId`；执行一次只归档最早一场。
- 归档的线索校验：`cluesOpened`/`cluesClosed` 的 id 必须出现在结束楼层的 `clue` 台账里，`cluesClosed` 还必须是 `fulfilled`；校验失败整次拒绝，3 次后任务标 failed。
- `dramaticer explain` 的第 10 节使用默认上限 12；如果将来把 `maxSceneFloors` 做成故事设置，`explain` 必须改为从同一个来源读取。
- 新迁移编号从 v59 起（v58 是 `director_lines`）。
- R6 预注册 v2 在第一次 v2 批次运行后冻结：门槛、样本、指标、模型与种子都不改；必须调整时另写 v3、记 ADR、把评测轮次计数重置为 0。
- v2 的判定状态：`pass`、`fail`、`insufficient`、`not-measurable`；G0 未通过或样本不足时 G1 与 G5 被替换成 `invalid`。
- G0 的两项：A/A（43 个点、种子 1 与 2、完成 ≥ 36、Wilson 区间含 50%、换序不一致 ≤ 20%、排除 ≤ 30%、判定失败 ≤ 10%）与真人标注（195 对、完成 ≥ 165、一致率 ≥ 65%、Wilson 下界 > 50%、位置偏差 ≤ 10 个百分点、判定失败 ≤ 10%）。
- R6-T07.a 的 A/A 样本文件格式：每行 `{"sampleId","story","context","seed1":{…},"seed2":{…}}`；文本变化会让旧 sidecar 拒绝复用（按 `sampleHash` 比对），重新生成后需要删除 `<dir>/aa.jsonl`。
- A/A 的判定槽位固定为每对 2 个；生成失败与两次文本相同也各占 2 个失败槽位。
- 43 个重 roll 点的统计来自 `eval-private/world-model-compare/source/<slug>.db`：`xianxia` 24、`yuwang` 8、`yinqi` 11；本批 43 个点的被接受节点都是最大下标。
- 兄弟楼层的 swipe 下标只能从节点 id 后缀 `:s<N>` 读；同一楼层的兄弟 `created_at` 完全相同。
- R6-T05 的深回合数据带 `gateVersion: v1`，在 v2 里只作为 G5 的输入证据；它的工具调用合计为 0，因此 G5 记「不可测」。
- `gates.ts` 的 G6 少于 30 对时状态为 `insufficient`；G5 工具调用为 0 时状态为 `not-measurable`。`evaluateR6Gates` 要求七项输入齐全，缺项直接抛错。
- 重 roll 点的生成与 B1 不同：B1 在分支助手楼层之后追加真实玩家消息，回放在父玩家楼层上直接生成；两者都复用 `prepareR6RunCopy` 与 `warmupR6Copy`。
- R6 的胜率都按配对计数：两种展示顺序各判一次，胜率分母只含胜与负，平与换序不一致不计入分母；Wilson 95% 区间用配对计数计算。
- R6 的 C1 两档必须共用同一串玩家消息：原生档先生成并写入 sidecar，朴素档逐字重放。
- R6-T02 的 sidecar 在 `<dir>/runs/<故事>/<楼层>/<档位>.json`，数据库是同目录的 `<档位>.db`；状态 `running` 时续跑，`done` 与 `failed` 直接复用。
- R6 的预热结算按后台任务的次数重试：第 2、3 次请求末尾追加一条玩家消息，带上一次的错误与结算窗口里可写入的楼层 id（ADR-0137）。
- `prepareSettlementForNodes` 只校验窗口大小与楼层存在，调用方要先把 head 移到窗口最后一楼，并按从旧到新的顺序传楼层。
- 评测里的结构化判定与模拟用户调用默认不发送 `maxTokens`，由路由器使用模型在渠道里声明的上限（ADR-0136）。
- 长任务脚本只构建 `st-compat`，不会重建 `packages/core/dist`。改过 core 之后必须先跑 `pnpm run typecheck`。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁会撞上 vitest 的 `[vitest-worker]: Timeout calling "onTaskUpdate"`：先看是不是某个用例单文件耗时过长（`vitest run <文件>` 对照），不要连续无改动地跑整仓测试，也不要靠改门槛绕过。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- `.devloop/scratch/` 下的脚本要用 `createRequire` 指向 `packages/st-compat/package.json` 才能加载 `better-sqlite3`；`.devloop/` 已被 git 忽略。
- EJS 沙箱的时间预算按墙钟计；测试不要用接近 worker 启动耗时的预算。
- `pnpm exec biome check --write <文件>` 处理格式；不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I8 显示与 prompt 从原文派生，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I16–I18 插件约束。
- 故事图片：`story_media` 是唯一的图片索引，文件不放进数据库；立绘按卡里的角色名登记，其他人物查不到时媒体接口返回 404；封面在无图时永远返回占位图。
- 旧故事（W0-T01 之前导入的卡）没有保存过原图，封面是占位图；不要尝试从 `story_settings` 或卡文件恢复。
- e2e 的 `serve.mjs` 启动时清空 `.devloop/scratch/e2e/work`；Playwright 的 mobile 与 desktop 两个项目共用同一个数据库，测试标题必须带唯一 id。
- 台账页只在选中楼层后渲染故事级区块（实体、世界书），e2e 要显示立绘得先给故事补一层（`cover.spec.ts` 的 `seedFloor`）。
- v4 起台账写入分硬状态与软知识；每条事实的 `sourceQuote` 必须逐字出现在源楼层，校验失败整条拒绝（W2-T01）。`knowledge` 不再新增写入。
- 合并后台调用（场记）必须先通过结算一致率对照才能切默认；`gapPassEnabled` 与 `sceneLogEnabled` 在对照通过前保持关闭。
- 重 roll 必须带原因，原因进入用户意志与偏好信号（W5）。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- 世界模型只用故事设置 `worldModel` 选择；状态槽位的 `packKey` 必须带种类（`state:<kind>`）。
- 导演组织方式只用故事设置 `directorOrganization` 选择；单轮强度覆盖用 `engine` 重建槽位。
- `DirectorEngine.evaluate` 负责写本楼层的决策记录；导演关闭时返回 null 且不写记录。
- 剧情小品的条件是 `{kind:"text", text}` 或 `{kind:"ledger", query}`；兜底小品必须省略条件，普通小品必须提供条件。
- X2.c 运行器只在复制数据库里写 `directorOrganization` 与小品；源库只读；小品指纹进入 sidecar 校验。
- 实体档案（`wiki`）的写入路径是 `["profile", "<人物>"]`；`world_wiki_revisions` 只追加。
- X1 的源数据库用 ASCII 文件名（全角文件名在 Windows 的 `fs.rmSync` 上会以 `0xC0000409` 终止进程）。
- 显示状态只在当前会话；需要跨进程显示时由台账快照重新渲染。
- 共存适配器在 `apply` 之后按轮调用 `afterTurn`；插件写错直接让运行失败。
- 共存评测的关闭组：适配器提供 `baseline` 时用 `<runDir>/<pluginId>/off`；不提供时用 `<runDir>/baseline/off`。
- `st-helper-host` 的共存批次不执行脚本：Node 里没有 iframe。
- EJS 模板里再写 `<%` 会被外层标签解析截断；`st-ejs` 的激活正则默认一次性生效。
- 沙箱里模板函数是同步的；函数参数与返回值必须能 JSON 化；`define` 只在一次执行内有效，`include` 不可用。
- 回合预算只从调用方传进来：槽位提供者用 `request.budget`。
- `StEjsVariableStore` 接入 `backend` 后，不指定作用域的写进入 `initial`（台账 `mvu`）。
- 模板生成只登记请求：`generate` 返回 id 不返回正文，宿主用 `createStEjsBackgroundGenerationRunner` 接后台客户端并在间隙 `drain`。
- STscript：`triggerSlash` 只执行 `ST_HELPER_SLASH_COMMANDS` 里的命令；`/gen` 与 `/genraw` 只登记后台请求。
- HTML 状态栏与开场页的渲染结果只在插件显示状态；状态栏自动重渲染由变量写入触发，默认上限 8 次。
- 酒馆助手的 API 覆盖率快照以本机 JS-Slash-Runner 4.8.10 为准。
- 助手任务不要复用 `turn_runs`；助手运行状态与事件在 `assistant_conversations`、`assistant_events` 里。
- 助手接口的请求与响应类型放在 `packages/protocol`；技能注册表以 `packages/core/src/assistant/skills.ts` 为唯一来源。
- 渠道读取不返回密钥值；`propose_channels_change` 四个段必须给全。
- 压缩记录只追加；自动压缩在 server 的消息接口里执行。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以；助手类型从 `@dramaticer/protocol` 取。
- 上下文排布的设置只对内置默认模板生效；故事指向库里保存的模板时 `detectContextLayout` 记 `custom`。
- 导入体检页的「全部条目」是玩家改过类型后的恢复入口；三组审查只按生效类型分组。
- e2e 的 `pagination.spec.ts` 不要用 `scrollHeight` 在最后一页继续增长判断加载；最后一页检查 `chat-load-older` 消失与最早楼层可见。
- 移动端故事导航是固定 9 列栅格（聊天、导入、体检、分支、台账、导演、生图、设置、渠道）；新增 tab 时同步改 `styles.css` 的 `repeat(9, …)` 与 `StoryPage` 的 `TABS`。
