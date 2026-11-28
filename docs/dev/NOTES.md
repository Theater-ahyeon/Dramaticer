# 注意事项与可重复命令

> 从旧的 HANDOFF 整体搬来（截至会话 429），按需搜索，不通读。新增的长期注意事项按模块追加到末尾。

## 可重复命令

- 北极星指标：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/cli.js stats rerolls --db data/dramaticer.db [--story <id>] [--json]`（只读，只输出数字）。
- 门禁：`pnpm check`（单元测试只跑 vitest 的 `unit` 项目）。评测、裁判、试玩与门槛判定的测试在 `eval` 项目：`pnpm test:eval`；全部：`pnpm test:all`。名单在根目录 `vitest.config.ts` 的 `evalTests`，新增评测测试要加进去；兼容插件的 `*-coexist` 是插件验收（I15），留在 `unit`。
- CI：`.github/workflows/check.yml` 在 push 与 PR 到 `main` 时于 Ubuntu 上跑 `pnpm check`。
- 早期一次性脚本（F0、R1、R2、R5）在 `scripts/archive/`，不再有 `package.json` 命令名。
- 全量 e2e：`pnpm e2e`（会先构建 server 与 web；跑两个项目）。
- 走查截图：`cd packages/web && npx playwright test -c .walk/walk.config.ts`（`.walk/` 不入库，vitest 已排除；截图落在 `.devloop/scratch/walk/`）。界面工单验收前重拍并逐张看。
- 渠道向导接口：`POST /api/channels/keys` 把密钥写进服务端启动时读的 `.env`（`ServerChannelsOptions.envFile`）并立即生效，响应不回传值；`POST /api/channels/models` 用已保存的密钥取 `/models`。没有 `channels.yaml` 时服务照常启动，`GET /api/channels` 返回空视图，首次 `PUT` 创建文件。
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
- 连载 e2e：`cd packages/web && pnpm exec playwright test serial.spec.ts`；连载的四块数据只剩接口，导出在故事页标题旁「⋯」。
- 玩家编辑变更卡与接口目标测试：`pnpm exec vitest run packages/core/test/ledger-cards.test.ts packages/server/test/panels.test.ts packages/web/test/api-client.test.ts`（server 用例先 `pnpm run typecheck`）。
- 人物档案与知情标注目标测试：`pnpm exec vitest run packages/core/test/character-profile.test.ts packages/core/test/scene-archive.test.ts`。
- 重逢注入目标测试：`pnpm exec vitest run packages/core/test/reunion.test.ts`。
- 推进档位接口目标测试：`pnpm exec vitest run packages/server/test/turns.test.ts -t "推进档位"`（先 `pnpm run typecheck`）。
- 重 roll 原因目标测试：`pnpm exec vitest run packages/core/test/reroll-reason.test.ts packages/core/test/preferences.test.ts packages/server/test/turns.test.ts packages/web/test/api-client.test.ts packages/web/test/push-reroll.test.ts`。
- 故事页的推进、重写、改这句、分支 e2e：`v5-composer.spec.ts`、`v4-story.spec.ts`；旧聊天页迁来的思考折叠、选项偏好、深度追加要求、场面控制在 `v5-play-extras.spec.ts`（都要先 `pnpm --filter @dramaticer/server... --filter @dramaticer/web... build`）。
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
- 写法对照：`pnpm --filter @dramaticer/st-compat turn-mode-compare --db <路径> --story <id> --messages <路径> --instrument <r6-instrument 结果> [--repeat <n>] [--branch <楼层>]… [--dir <路径>] [--json <路径>] [--report <路径>]`。
- 蓝图导出到卡：`pnpm --filter @dramaticer/st-compat blueprint-export --card <路径> --db <路径> --story <id> --out <路径> [--node <id>]`。
- X2.d 重跑（断点续跑）：`node .devloop/scratch/X2.d/run-compare.mjs`；指标汇总：`node .devloop/scratch/X2.d/summarize.mjs`。
- 深度写法真实渠道抽查：`DRAMATICER_LIVE=1 DRAMATICER_DEEP_TURNS=16 pnpm exec vitest run packages/st-compat/test/deep-live.test.ts`（要 `data/channels.yaml` 的 `writer` 渠道可用；输出每轮楼层、失败原因与汇总）。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。

## 注意事项

- server 路由文件地图（2026-11-19 起，refactor/06）：`routes.ts` 只有 `ApiRouteOptions` 与分发入口 `handleApiRequest`；处理函数在 `routes-stories`（故事、导入、楼层树与路径、实体、设定、后台任务、连载）、`routes-turns`（回合、追加要求、重写、就地纠正、场面控制）、`routes-nodes`（单个楼层的正文、Trace、台账、事件、导演、变更卡）、`routes-outline`（大纲、AI 建议、导演计划）、`routes-setup`（开场、导入体检、角色外观、设置与模板）、`routes-channels`、`routes-media`；v4 新接口仍在 `routes-next` / `routes-memory` / `routes-card`。参数校验与错误响应只用 `routes-common.ts`（`requireMethod`、`requireStory`、`readObjectBody`、`assertKnownKeys`、`fieldError` 等），不要在新文件里再写一份。

- 存储层文件地图（2026-11-19 起，refactor/05）：`core/src/store/story-store.ts` 只是外观——打开数据库、迁移、事务，以及把公开方法委托给 `store/repos/<领域>.ts`：`stories`（故事、媒体、代码插件安装、设置、模板）、`nodes`（楼层树、head、偏好记录）、`entities`、`ledger`（状态 diff、结算、变更卡、快照、玩家修改）、`scenes`（现场分析、百科修订、场记、场次归档与控制、摘要、章节压缩）、`memory`（事件、分块、向量、检索）、`director-lines`、`director-plan`、`outline`、`openings`、`images`、`lore`、`turns`、`assistant`、`background`；共用的行类型与校验在 `repos/shared.ts`。新方法写进对应领域的仓储类，再把方法名加进 `story-store.ts` 里该领域的 `Pick<…>` 与 `DELEGATES`（两处要一致，少写一处会是类型错误或运行时 undefined）。跨领域调用一律 `this.store.x()`，不要在仓储之间互相 import 实例。
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。R6 与 X1、X2 的 JSON 含回复与答案，只能放在私有目录。场记对照的报告含楼层 id 与台账值，只能放在 `eval-private/`。
- 迁移 v72 之后 `assistant-store.test.ts` 的版本断言是 72；新增迁移要同步这个数字。`player_edits`、`memory_rejections`、`memory_event_quotes` 都只有 INSERT 与 SELECT 接口，UPDATE/DELETE 由触发器拒绝；回滚是再追加一条修改。
- 默认蓝图只由卡导入写入（`saveStoryBlueprintBaseline`），是故事级、与楼层无关的起点；不要把它写成楼层记录，也不要为了导入蓝图创建假楼层。条目按 id 排序后保存，读取顺序与 `applyBlueprintDiffs` 一致。
- 默认蓝图参加锁定检查：AI 不能改卡里锁定的条目。替换或清空默认蓝图不删除楼层上的修改记录；版本列表不把默认蓝图算成一版。
- 剧透过滤只在 `GET /api/stories/:id/blueprint` 上生效；不要把 `readBlueprintView` 的过滤结果写回存储，也不要让章级规划或建议接受读过滤后的视图。建议列表是玩家主动发起的，不按剧透隐藏。
- 导出只改 `extensions.dramaticer.blueprint`：用 `attachBlueprintExtension` 深拷贝 `raw`，V1 写根节点、V2/V3 写 `data` 节点；条目为空时删掉该字段。不要手写 JSON 拼接，也不要把蓝图写进 `data` 根节点。
- 里程碑铺垫线的 id 只由 `milestonePromiseLineId` 生成：`milestone.` 加 sha256(里程碑 id + `\u0000` + 条件文本) 的前 16 位。改公式会让已有铺垫线换 id，下一章会重复补写，必须同时迁移线记录。
- 补写只发生在章级规划里；`chapterPlanNeedsRun` 的门槛（导演打开、这一场收尾、至少两条线、距上次清点够 `chapterFloors`、该楼层没有清点与线记录）不满足时不会补写。不要把补写塞进 `acceptBlueprintSuggestion`，那会让接受建议受伏笔上限影响。
- 里程碑达成没有单独的字段：前提条件对应的线在路径上都出现过、并且现在都不在 `readDirectorLineStates` 里才算 `reached`。没有前提条件的里程碑无法由伏笔账证明达成，`reached` 恒为 false，它仍然是最近方向但不生成线。
- 四态检查里 `lost` 先于 `achieved` 判定：章末清点显式 `retire` 的前提条件意味着方向已被放弃。只有 `blocked` 与 `lost` 带三个选择；检查本身不改写蓝图，也不该在任何后台任务里自动采纳其中一个。
- 历史线 id 只能从 `listDirectorLinesAlongPath` 取；不要用 `readDirectorLineStates` 判断「是否出现过」。
- 蓝图总纲的 `tension` 是必填字段，但解析时缺失按 `loose` 补齐；新增总纲条目时写明档位。
- 写作选项与卡的推荐（`packages/core/src/settings/card-config.ts`）：写作选项存在 `writing.recommended` / `writing.overrides`，写法与开关的推荐存在 `card.recommended`，卡版本存在 `card`。卡载入时只有第一次应用写法与开关；升级只换推荐和 `card.version`，玩家的调整保留。`DELETE /api/stories/:id/writing` 同时清写作调整并重新应用推荐，别改成只清写作。
- 卡的推荐配置对应测试：`pnpm exec vitest run packages/core/test/card-recommended.test.ts packages/server/test/stories.test.ts`（server 用例先 `pnpm run typecheck`）。
- 写作上下文的蓝图摘要只注入三项：当前卷的核心问题、最近里程碑的方向、本章该埋的线。不要把 `premise` 的候选结局与红线、后面卷的里程碑或完整条目放进消息与 Trace 的来源描述。
- 摘要里的「本章该埋的线」只列 `missingLineIds` 对应的前提条件；前提条件通过 `active.lineIds` 的下标与 `prerequisites` 对齐，不要另算线 id。
- 新增上下文槽位要同步四处：`CONTEXT_SLOT_NAMES`、`chat/template.ts` 的段落与两种排布、`plugins/slots.ts` 与 `chat-providers.ts` 的装载、web 的 `SLOT_CHOICES`；`docs/plugins/code-plugins.md` 与 `docs/plugins/declarative-plugins.md` 的槽位清单由测试逐项核对。
- 蓝图与线同一做法：每个楼层按批次保存 `story_blueprints`，主键 `(node_id, seq)`，`diffs` 是 `set`/`delete`，沿路径从根开始累加；记录只追加。逐条接受建议时每接受一条追加一批。
- 蓝图的 `source` 分两层：记录列记这一批是谁写的（`player`/`ai`），条目里的 `source` 记这条内容的出处；锁定只拦 AI。
- 每一批蓝图修改应用之后用 `assertBlueprintEntries` 整批校验：总纲最多一条、里程碑的 `volumeId` 指向存在的卷、`after` 指向存在的里程碑且不成环、id 不重复。
- 蓝图建议独立存放：生成只写 `blueprint_suggestions`，玩家接受一条才用 `acceptBlueprintSuggestion` 写一批。锁定过滤只走 `filterLockedBlueprintDiffs`。
- 建议的标题 80 字、理由 500 字、补充说明 500 字；一次请求 1 到 5 条建议，每条最多 50 条修改。模型输出未知字段或形状错误整批拒绝。
- 线的存储写法与导演手记一致：每个楼层一行、`diffs` 是 `set`/`delete` 数组、沿路径从根开始累加；同一楼层重复写入直接失败。倒计时的有效余量用 `directorLineRemaining`。
- 规划对象的玩家修改都走 `player_edits`：剧情线与伏笔的 kind 是 `line`，本场目标是 `scene`。本场目标挂在当前场次开始的楼层上，读取时以当前楼层为路径锚点；换一场后旧的修改自动不再生效。
- `saveDirectorLines` 拒绝改动玩家锁定的线，锁定后的章级规划只留下 `rejected` 记录，不再写入线；场记写本场目标时同样先用 `guardBackgroundWrite`，被挡下的内容只留作建议。
- 剧情线与本场目标的当前内容用 `readDirectorLineStates` 与 `readSceneGoal` 读；玩家修改经 `readEffectiveEdits` 生效。回滚剧情线或本场目标后，下一次读到的就是恢复的内容。
- 推进档位是**单轮参数**，不写故事设置；`push` 只接受 `advance`、`quick`、`jump`，`null` 表示常规回合。
- 章末清点记录只追加：同一楼层第二次写入直接失败，UPDATE 被触发器拒绝。写入前必须用 `assertChapterReviewMatchesLines` 对照当前路径。
- `focus` 固定 2–3 条且不能包含同一份清点里 `retire` 的伏笔；`promises` 只写清点之前已经存在的 `promise` 线。
- 章级规划输出先写清点再写线：`saveDirectorChapterPlan` 保证同一事务。
- 剧情走向（`direction-v5/01`）：`core/src/direction/view.ts` 的 `readDirectionView` 是只读派生，不复制存储；大纲条目、剧情线、本场目标与场记笔记仍由原来的表写入。两栏的 `id` 就是写入键（`premise:question|tone|red-lines`、`volume:<id>`、`milestone:<id>`、`line:<id>`、`scene`、`note:<id>`），写入统一走 `POST /api/stories/:id/direction/edit`，命令校验在 `assertDirectionEdit`。
- 走向页把主线方向（kind `main`）放进「想发生的」，其余剧情线与 `plot_notes` 里未收的笔记放进「还没收的线」，按引入时的助手楼层深度升序；章末清点里 `retire` 的伏笔不再算未收。新增方向写成 `line` 的玩家修改并自动锁定；场记笔记的改写与收下用 `player_edits` 的 `note` 种类（原 `plot_notes` 行不变）。界面里两栏的行 id 是 `data-id`，样式类用 `kind-*`，不要给行加 `.premise`、`.ms` 这类旧类名。
- `story_settings.director_organization` 的 CHECK 仍允许旧值 `mechanisms`、`bits`、`lines`；读设置时旧值降级成 `lines`，新代码只写 `lines`。重建表时要同步 `assistant-store.test.ts` 的 schema 版本。
- 场记对照、导入审计、规则执行、状态定义、场面卡、人物档案、重逢注入的既有口径保持不变；参考上一次交接的注意事项与对应 ADR。
- 世界书槽位在导入过的故事里 Trace 来源带「升级」或「原样」前缀；改这个字符串时要同步 `packages/st-compat/test/chat-cli.test.ts`。
- 升级模式不注入状态定义、条件内容、事件与舞台、写作指令、表现资源、作者选项、插件残留与未识别条目。
- `import_audit_entries` 的 `source` 必须与 lore 条目同构；`importWorldInfoLore` 是唯一写审计的路径。只有 `kind = plugin-residue` 的条目可以转成初始记忆。
- 规则声明只在卡导入时整批替换；检定固定 d20，`difficulty` 1 到 20；`rule_check` 只做参数校验与声明查找。
- 状态定义段的截断上限是 `STATE_DEFINITION_ENTRY_CHAR_LIMIT`（800）与 `STATE_DEFINITION_TOTAL_CHAR_LIMIT`（4,000）；`gap_pass` 复用同一个 `formatStateDefinitions`。
- 导入体检页的「全部条目」是玩家改过类型后的恢复入口；`source` 含冒号时客户端必须 `encodeURIComponent`。
- 场次划分只数助手楼层；场次归档以结束楼层为主键。`readCharacterProfiles` 的出处是场次，不是单个楼层。
- `profile` 槽位的在场名单取最近一条场记，没场记时取最后一场归档；重逢注入的「最近窗口」只看当前楼层之前的原文。
- 记忆槽位的实体路由由玩家本轮原文与在场者名字一起驱动；命中的记录按故事时间排序，新旧说法都保留。`ContextSlotRequest.budgetTokens` 放得下整条原文窗口时（不超过默认历史窗口）不检索，避免重复注入。
- 上下文 Trace 的 `context.entries[].items` 记录逐条来源对象；新增槽位提供者要同时给 `items`，否则本轮上下文只能定位到片段。旧 Trace 没有 `items`，读取时回落到片段来源。
- 重逢档案的原文摘录只取 `memory_event_quotes` 里与候选实体有关、带逐字出处的记录；没有出处的记录不补摘录。
- 玩家直接编辑台账：正文旁的变更卡走 `createPlayerLedgerChangeCard`；记忆页的即时修改走 `editState`，两者都写来源 `player` 的台账 diff。
- 玩家的记忆修改只追加到 `player_edits`，按 `node_id` 沿当前路径生效；状态与偏好另写一条来源 `player` 的台账 diff，后台再写向锁定路径时由 `appendStateDiffs` 丢弃并记到 `memory_rejections`。
- 回滚是再追加一条内容相同的修改；`rollbackPlayerEdit` 只接受当前分支可见、且不是 `rejected` 的历史。状态与偏好回滚会同时写回台账，其余种类靠投影叠加。
- 连载视图四块数据只从当前路径派生；前情提要只收已归档场次；时间线只把来源 `player` 的 `time.current` 当跳跃。同一路径两次导出逐字节一致。
- 就地纠正的 `quote` 必须逐字出现且只出现一次；模型只输出改写段。场面控制只接受当前路径的助手楼层。
- `scene_archives.profiles` 与 `.informed` 的校验在 `saveSceneArchive`；档案字段没有变化时写 `null`。
- 采样种子只在需要两次同配置生成时使用（A/A 与重 roll 回放）；它进入缓存键。Google 适配器忽略 `seed`。R6 的真实批次仍被 HUMAN-19 阻塞。
- 长任务脚本只构建 `st-compat`，不会重建 `packages/core/dist`。改过 core 之后必须先跑 `pnpm run typecheck`。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 300 秒、`maxWorkers` 8，并排除 `**/.worktrees/**`；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁会撞上 vitest 的 `[vitest-worker]: Timeout calling "onTaskUpdate"`：先看是不是某个用例单文件耗时过长，不要连续无改动地跑整仓测试。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- `.devloop/scratch/` 下的脚本要用 `createRequire` 指向 `packages/st-compat/package.json` 才能加载 `better-sqlite3`；`.devloop/` 已被 git 忽略。
- EJS 沙箱的时间预算按墙钟计；测试不要用接近 worker 启动耗时的预算。
- 换行统一用 LF：`.gitattributes` 声明 `* text=auto eol=lf`，biome 的默认换行也是 LF。新建文件用 LF 写入，提交前跑一次 `pnpm exec biome check --write <文件>`。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I8 显示与 prompt 从原文派生，I9 推进方向由程序从剧情走向取出供玩家点选、没有每拍动作选择，I11 间隙优先且预跑只针对推进，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I16–I18 插件约束。
- 规划写法的阶段顺序由 `PLAN_TURN_STEPS` 决定：三个准备阶段、正文、可选复查；Trace 的 `plan.schedule` 记的就是它。角色意图每个在场角色单独一次调用，只带他自己知道的公开事件、自身状态与被告知的秘密，不要把全部角色的材料合进一次调用。复查是 `plan_review` 后台任务，结果写成兄弟楼层且不移动 head，玩家自己切换过去。
- 提前备好是 `plan_prepare` 后台任务：`prepare` 开关打开时，在间隙只为推进（`push: "advance"`）跑一遍准备阶段，结果按前一楼存进故事值；命中时回合内只剩正文调用，自由输入时在回合内准备并把阶段进度写进 `turn.progress`。开关关掉后既不建任务，也不使用以前备下的结果。不要为其他推进档位或行动选项预跑（I11）。
- 写法对照的三种写法落在同一次运行里：快速是 `turnMode: "fast"` 且清掉 `writingMode`，规划是快速加 `writingMode: "plan"`，深度是 `turnMode: "deep"`。每个分支点、写法与重复各复制一份数据库，玩家消息固定不重新生成。胜率以快速为对照；矛盾率用各写法自己的台账探针，分母只含一致与矛盾；每楼调用数是写作客户端的非缓存请求数，含规划准备与深度工具往返。G0 未通过时 `turn-mode-compare` 在任何模型调用前失败。
- 故事图片：`story_media` 是唯一的图片索引，文件不放进数据库；封面无图时永远返回占位图。
- e2e 的 `serve.mjs` 启动时清空 `.devloop/scratch/e2e/work`；Playwright 的 mobile 与 desktop 两个项目共用同一个数据库，测试标题必须带唯一 id。`serial.spec.ts` 用固定故事 `e2e-serial`。
- 人物立绘显示在记事页百科条目标题旁（`.page img.portrait`），只有卡里带立绘的人物才有图；e2e 要显示立绘得先给故事补一层。
- 合并后台调用（场记）必须先通过结算一致率对照才能切默认；`gapPassEnabled` 与 `sceneLogEnabled` 在对照通过前保持关闭。
- 重 roll 的原因可以省略；界面先弹出六项原因，选中后才重写。原因进 swipe 载荷的 `reason`、写成一条来源为玩家的长期纠正，并以 system 消息追加在历史之后（ADR-0149）。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- 世界模型只用故事设置 `worldModel` 选择；状态槽位的 `packKey` 必须带种类（`state:<kind>`）。
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
- 手机底栏 7 项（书架、故事、记忆、大纲、设定、设置、全局）；增删导航时同步改 `v4.css` 里 `.navs .ind` 的 `calc(100% / 7)` 与 `v4-shell.spec.ts` 的数量。
- 深度的故事数据文件树由 `tools/workspace-tools.ts` 从存储现算，故事文件只读；只有 `草稿.md` 能写与打补丁。新增文件要同时出现在 `listWorkspacePaths` 与 `readWorkspaceFile`，路径改动要同步 `web/src/chat/deep-turn.ts` 的工具文字。

## 导演与剧情走向（2026-11-27 起）

- 每拍不再有程序选择的动作，也没有 `mechanisms` 引擎（direction-v5/02）。不要恢复 `selectDirectorAction` 之类按拍注入建议的路径；玩家没点推进菜单时，这一轮没有方向干预。
- 推进菜单的方向由 `readDirectionView().pushDirections` 当场派生：先取最老的未收线（未静音），再补一条「想发生的」里未完成的关键事件、主线方向或本场目标，最后补第二条未收线，最多 3 条。
- 玩家点选方向时，界面把方向写进玩家消息（`（推进方向：…）`），`push` 单轮参数照旧决定走一步、一场还是跳跃；楼层原文因此保留方向，重试与重新生成都能带回。
- 章末清点照旧（`chapter` / `chapter-plan`），只把上一次清点之后玩家自己写的自由输入当作这一章的变化；推进类固定说法不算。
- 旧楼层的导演决策（`director_decisions`）只读兼容：`undoDirectorArrangement` 仍能静音那条线并写 `avoid-line` 偏好，重复撤回不重复写；新楼层不写决策。
- 故事设置的 `directorOrganization` 只为读旧库：`mechanisms` 与 `bits` 都降级成 `lines`；`director` 功能开关已隐藏并标成旧版。
- 规划与深度写法只在故事设置「高级 → 实验」里选，默认快速；故事页输入台只列快速，当前是实验写法时额外列出当前那一项。程序不会自动切换（I6）。

## 功能开关与后台任务（2026-11-19 起）

- 功能页的值必须就是运行时的值。读开关一律用 `readStoryFeatureState(store, storyId[, turnOverrides])`，不要直接读 `settings.featureSwitches`（那只是玩家的覆盖，没有叠加档位与卡能力）。
- 功能开关与旧的独立设置冲突时（DESIGN §22，ADR-0163/0164）：功能页为准的有 场记（与 `sceneLogEnabled` 取「或」，见下一条）、伏笔上限（`promiseLimit` 取代 `directorConfig.maxOpenPromises`）；别处为准、功能页隐藏的有 思考（写作页 `reasoning`）、原样兼容（`importMode`）、出图（`imageConfig.mode`）。新开关接通时加进 `WIRED_FEATURE_SWITCHES` 并补运行时测试；槽位与回合读开关一律带上 `request.featureOverrides` / `options.featureOverrides`（本轮临时开关）。「起过几次作用」只给开着的开关显示。
- 后台任务类型的开关用 `readStoryBackgroundSwitches` 解析，再交给 `resolveStoryBackgroundKinds`：场记 = 功能页「场记」或旧设置 `sceneLogEnabled`；归档 = 场记开且（功能页「档案归档」或 `sceneLogEnabled`）。「档案归档」需要卡有实体能力，没有实体时功能页不显示也不运行。
- 已接通的开关登记在 `WIRED_FEATURE_SWITCHES`（`settings/features.ts`），功能页据此标「尚未生效」。接通新开关时把它加进去并补一条运行时测试。
- 伏笔上限一律用 `readStoryPromiseLimit`；`directorConfig.maxOpenPromises` 已不再生效。
- 重逢注入、知情标注、档案归档的开关需要故事有实体能力；测试夹具要 `upsertEntity` 一个实体，否则这些开关取关闭值。
- 后台保底（ADR-0165）：模型的 `fallback` 只对后台岗位生效（`StoryRuntimeManager` 的 `#backgroundClient`），只在 `LlmAllChannelsFailedError` 时切换，流式请求已经推送内容就不切。后台是否暂停由 `readBackgroundHealth` 从任务表算，只认「模型 X 的所有渠道都失败了」这类错误，解析错误不算；新错误格式要同步那条正则。错误摘要会截短并去掉像密钥的长串，但仍不要把密钥写进错误信息。

- 局面更新（memory-v5/01）：场记（`scene_log`）打开时就是每楼唯一的后台调用，顺带行动选项（功能页「行动选项」关掉时不要）、事件（写进 `memory_events`，并标记该楼已抽取）与用户意志（只看紧挨这一楼的玩家消息）。`MERGED_INTO_SITUATION` 里的分散每楼任务（events、settle、scene、user_will、memory_revision、candidate_actions、lore_prefilter）这时不建任务；场记关掉时照旧。CLI `work --kind` 指名的类型不受合并规则影响。顺带部分格式不对只丢那部分并记进场记的 repairs，不打回整条。
- 场末整理（`scene_archive`）滞后一楼：场末那一楼还是 head 时不编译，玩家在它之后再输入才编译。测试里要给场末楼层接一条玩家楼层。
- 每个后台任务记下实际的模型调用与 token（`background_jobs.llm_calls/llm_tokens`，迁移 74，由 drain 给处理器套计数客户端）；检视器按 `ONE_TIME_JOB_KINDS`（开局、导入分型、角色外观，原著导入加在这里）与插图分三类。e2e 假渠道按场记提示词里出现的「- options：」等行作答。

- 此刻局面与世界索引（memory-v5/02，`memory/situation.ts`）：默认模板用 `world_index` 与 `situation` 两段取代 `state`、`scene`、`scene_card`（这三个槽位仍注册，自定义模板照用）。局面卡由程序从 `readMemoryState`、场记在场者、场面目标与 `readMemorySecrets` 拼成，超 500 token 时按优先级丢行；卡有 `mvu.*` 时只留在场者、已死之人与知情边界，并把卡的变量原样带上（不计入裁剪，MVU 只从这里进上下文）；台账命名空间以外的模型自记状态原样列出。功能页「此刻局面」「故事记事」两个开关分别关掉两段。上下文分类「状态与秘密」改名「此刻局面」。

- 故事记事（memory-v5/03，`memory/notebook.ts`）：`notebook_versions` 只追加（触发器禁止改），每版是整页快照（现在、底色、经历），挂在产生它的楼层上，沿路径取最近一版；初版由 `ensureNotebookInit`（GET /memory 与故事级任务 `notebook_init`，不调模型）从卡描述、台账与已归档场次拼出。场末整理（`scene_archive` 同一次调用）输出 `notebook` 补丁，`applyNotebookPatches` 跳过锁定节，同一场重编译按场末楼层替换经历。世界索引的一行简介优先取记事页「现在」。

- 上下文六节（memory-v5/04）：默认模板是 character、lore、summary、history、world_index、situation、pages、memory、director、user_will、protocol。`pages`（相关页面）注入在场者与玩家提到的久未出场者的记事页整页；检索（`memory`）在整个故事放得下时不触发，事件命中带「当时：所在场摘要或前一楼原文」。profile、reunion、blueprint、state、scene、scene_card 仍可在自定义模板里用。

- 出处放宽（memory-v5/05）：所有引文核对用 `quoteMatches`（去标点包含，或相邻两字重合 ≥ 60%），对不上照样写入；后台写入只因「与玩家锁定的事实冲突」「让未知情者知道了秘密」两种原因被拒（后者：knowledge 写入的引文在原文里对不上）。

## 新界面的视觉层（2026-11-16 起）

- 2026-11-19 起（ADR-0162、`ui-lite`）：没有 three.js 场景、指针光、卡片倾斜与开场动画，也不打包字体；`stage.pulse` / `setWriting` 保留为空操作级别的接口，页面可以照常调用。下面关于三维背景的旧条目已过时，以 `.scratch/ui-lite/spec.md` 为准。
- 2026-11-19 起（ui-lite/02）设计系统是「纸与墨」：`v4.css` 开头的 `html:root` 定义颜色（`--bg`、`--sheet`、`--raise`、`--field`、`--ink`、`--muted`、`--line`、`--line-strong`、`--cinnabar*`）、字号（`--t-*`、`--lh-*`）、间距（`--s-*`）、圆角（`--r-*`）与 `--dur`。`--gold*`、`--teal` 等旧名只是别名，新样式直接用新名字。改颜色要同时改两处暗色定义（媒体查询与 `data-theme="dark"`），`packages/web/test/design-tokens.test.ts` 会比对两处并检查 WCAG AA 对比度、没有 `backdrop-filter`、CSS 压缩后 ≤ 40 KB。朱砂只给主操作、当前位置与导演的痕迹；不用玻璃模糊、装饰渐变和入场动画。下面关于玻璃、入场动画的旧条目已过时。
- 主题由 `stage.ts` 的 `setTheme` 设置，导航栏按钮与设置页「外观」通过 `onThemeChange` 同步；手机上导航栏没有主题按钮，只能在设置页改。
- 故事页手机布局（ui-lite/03）：停靠栏是 `.dockwrap` 底部抽屉（`.dockbtn` 打开，拉手 `.dockclose`、遮罩或 Esc 收起），抽屉打开或输入框聚焦时隐藏底部导航——`.inner` 带 view-transition-name，是独立的层叠上下文，里面的 z-index 盖不过导航。输入台 `.cmp` 在鼠标按下时阻止按钮抢焦点：否则手机上点按钮会让输入框失焦、导航弹回、输入台跳动，点击落空。e2e 在手机项目里要先 `openDock` 再操作停靠栏；改了样式跑单个 e2e 前先 `pnpm --filter @dramaticer/web build`，Playwright 用的是 dist。
- 数字一律用 `.num`（界面字体 + `tabular-nums`）；`--f-data` 等宽字体只给代码与 `.kbd`，配中文时字距会散。就地编辑的空状态用 `Editable` 的 `placeholder`（`data-placeholder` + `:empty::before`），不要把「（点这里写）」当成值传进去。
- 体积预算由 `packages/web/scripts/budget.mjs` 在 `pnpm e2e` 构建后检查（首屏 JS ≤ 200 KB、CSS ≤ 40 KB gzip、无字体文件），不在 `pnpm check` 里。新加大依赖或页面时先跑 `node scripts/budget.mjs`；按需分包（`import()`）不算首屏。e2e 的数据库是共享的，书架上「继续上次」可能是别的用例的故事，按链接地址找自己的故事。
- 页面只通过 `v4/stage.ts` 跟背景打交道：`stage.pulse()` 让海面荡一圈光，`stage.setWriting()` 表示正在写。背景（`scene.ts`）读这些状态，不反过来依赖页面。
- 站内跳转用 `ui.tsx` 的 `TLink` 或 `travel()` 才有转场；普通 `Link` 也能用，只是直接换页。路由更新走 React 的 transition，所以 `travel` 要等 `Shell` 的 layout effect 调 `routeCommitted()` 才让浏览器拍新画面。
- 2026-11-19 起（ui-lite/05）没有 `styles.css`：旧面板样式在 `v4/panels.css`，由 `v4.css` 开头 `@import`，面板规则在前、v4 在后；面板里不要写死颜色（`design-tokens.test.ts` 会查）。下面一条的文件名已过时，顺序原则不变。
- 样式的先后顺序是定死的：`main.tsx` 先引 `styles.css`，再引 `App`（带进 `v4.css`）。`v4.css` 里有全局的 `button`、`input` 基础样式和工具页的覆盖规则，顺序反了旧规则会盖回来。颜色变量写在 `html:root` 上，旧页面的 `--surface`、`--text` 等也在这里接到新变量。
- 带 `backdrop-filter` 的玻璃面板不要加三维变换（`perspective`、`rotateX/Y`），否则模糊会失效；要倾斜就只倾斜里面的图。
- 场景的着色器直接输出显示用的颜色，`scene.ts` 里关了 three 的色彩管理；天空和水面的倒影共用 `skyColor`，改天空要两边一起看。机器带不动时场景会自己降渲染分辨率。
- 新页面都在 `v4/`（ui-v2/05 起没有 `v4/panels/` 与 `StoryTool`）：主页面是 `v4/*.tsx`；从旧面板留下来复用的组件也在 `v4/`——`AdvancedSettings`（本故事设置的「高级」分页）、`ImageSettings`（`storyId` 为 null 时是全局设置里的生图后端与 workflow，否则是设定页的视觉档案）、`ImportInto`（设定页里展开的导入）、`ChannelsAdvanced`。旧面板的样式仍在 `v4/panels.css`。目录不要命名为 `tools/`，biome 的忽略规则会跳过它。
- 承载内容的大块统一用「玻璃面板」那组选择器；新加页面的容器要加进去，否则文字直接落在动的背景上。
- 系统设了「减少动效」时：背景不跑循环，只在换页时重画；转场和入场动画关闭。新加动效要守这一条。
- 给新界面截图：起 `node e2e/serve.mjs`，用 Playwright 的 chromium 加 `--enable-unsafe-swiftshader` 才有 WebGL。
- 上下文条目跳到修改处的约定：设定用 `lore?entry=<id>` 展开条目，百科用 `memory?tab=wiki&page=<id>` 选中页面，状态、时间线、偏好用 `focus=<target>` 标出那一行，原文与场次用 `play?node=<nodeId>` 翻到那一楼。目标页只读这些查询参数，不改数据的存放方式。

## 开场（2026-11-23 起，ui-v2/03）

- 导卡时 `afterCardImport` 把卡的开场白（首条加备用）存进故事值 `opening.greetings`，空故事立即用第一条建根部助手楼层；`{{char}}` 换卡名、`{{user}}` 换「你」，其余宏原样。
- 「还在开场」= 所有楼层都是根部助手楼层（`core/src/opening/greetings.ts` 的 `storyAtOpening`）。这期间可以换开场白（`POST /greetings/:index`，同正文的根楼层复用）、选候选（新建根楼层并设为 head）、重新生成候选；玩家一开口就结束。
- 用 `createImportedStory` 建的 e2e 故事一开始就有 1 楼（开场白），数楼层的断言要算上它。
- 全量 e2e 跑到后段时，桌面端的 director / ledger / openings 曾因后台队列积压（前面用例留下的任务）等不到候选或事件而失败。`BackgroundScheduler.schedule` 现在把故事移到队头，并且每个故事一轮只跑一条任务就换手，一个故事的积压不会挡住刚切过来的故事。原著抽取另有 `canon-worker`，不占 `background_jobs`，一次只跑一本书。

## 原著（2026-11-27 起，canon/01）

- 编码识别在 `core/src/canon/decode.ts`：BOM → 无 BOM UTF-16 的 0 字节特征 → 严格 UTF-8 → 严格 GB18030，两种都失败才抛错，不做有损替换。`TextDecoder("gb18030")` 在 Node 24 可用。
- 分章在 `core/src/canon/split.ts`：卷只携带 `volumeTitle`，不单独成章；序章/尾声/番外按标题词判断类型；无标号短行要同时满足前后空行、上一章至少 20 字、下一行至少 20 字且整行无句读，才当标题。以「第」开头的短行（第三天、第一次）不当标题。第一个标题之前的书名页不足 60 字丢弃，超过则作为「卷首」保留。整本没有标题时按 6000 字分成「第 N 部分」，短文本只有一章「全文」。
- 存储迁移 76：`canon_books`、`canon_chapters`（`paragraphs` 是 JSON 数组，`STRICT`，章随书 `ON DELETE CASCADE`）。`repos/canon.ts` 的合并与拆分先把序号整体加 `RENUMBER_OFFSET`（1,000,000）再逐行写回 1..N，否则会撞 `UNIQUE (book_id, ordinal)`；每次变更后用 `#recountBook` 重算书的章数与字数。
- 分章列表接口不带 `paragraphs`；原文只在 `GET /api/canon/books/:bookId/chapters/:chapterId` 返回。导入请求只接受 `text` 或 `dataBase64` 之一，导入路由的请求体上限是 `CANON_IMPORT_MAX_BODY_BYTES`（48 MB），其余接口仍用 `maxJsonBodyBytes`。
- 页面是 `/canon`（书架 + 上传）与 `/canon/:bookId`（分章预览与编辑）。导航栏仍是 7 项：入口在书架的 `lib-bar` 与命令面板「原著 · 导入与分章」，`/canon*` 高亮「书架」那一格。
- 新增迁移要同步 `assistant-store.test.ts` 的 schema 版本断言（现在是 79）。

### 抽取与预估（canon/02）

- 预估在 `core/src/canon/estimate.ts`：`planCanonChunks` 按段落装块（`CANON_CHUNK_MAX_CHARS = 20000`），单段超限时独占一块。输入 token = 原文 token + 每块 400 token 模板开销 + 每块当前名册；输出按每块 1200 token。没有配置单价时用参考费率（输入 ¥2/百万、输出 ¥8/百万），界面显示「参考费率」并说明以渠道账单为准。
- 提示词在 `core/src/canon/prompt.ts`：系统提示词首句是「你是原著的事件抽取器」，e2e 假渠道按这句话分流；用户消息里有 `<原著>`、`<本章>`、`<名册>`、`<块 段落="起-止">` 与带段落号的原文。
- 抽取引擎在 `core/src/canon/extract.ts`。每块调用一次，返回后先 `parseCanonExtractionResponse` 再 `validateCanonChunkExtraction`：参与人物（或名册里的别名）必须在本块原文出现，段落范围必须在块内。校验失败只把该块标 failed；已通过的块保留。`mode: "resume"` 只跑非 done 的块，`"full"` 清掉这一章结果并按剩余结果重建名册。
- 别名归并发生在写库前：事实里的 name 与 aliases 先按当前名册解析成标准名，事件参与人物与话术人物一起用标准名；书级名册 `canon_entities` 每块增量 upsert。插叙事件存 `is_interlude = 1`，`listCanonTimeline` 排除它们，`listCanonEvents` 保留。
- 迁移 77：`canon_extractions`（每本书一条）、`canon_chapter_extractions`（chunks 是 JSON 数组）、`canon_events`、`canon_voices`（每人每章最多 5 条，写库时计数）、`canon_facts`、`canon_entities`。事件、话术、事实都带 `chapter_ordinal`；合并或拆分章节后 `#syncChapterOrdinals` 用 join 子查询统一改锚点，并丢掉受影响章的抽取结果。
- 后台调度在 `server/src/canon-worker.ts`：一次只跑一本书，新任务排到队头，暂停由路由写库，引擎在每块之间检查状态，已完成章保留。服务端启动时 `markInterruptedCanonExtractions` 把 running 退回 paused。抽取不写 `background_jobs`，所以不计入每楼后台调用预算。
- 接口：`GET /api/canon/books/:bookId/estimate`、`POST .../extract/start|pause`、`POST .../chapters/:chapterId/extract`（body `{mode}`）、`GET .../extract[?chapterId=]`、`GET /api/canon/extract`（检视器总览）。开始与单章重跑在没有后台模型时返回 409。
- e2e 假渠道里 `canonExtraction` 按块返回事件；「第二章 旧信」第一次故意给出原文里没有的参与人物，用来验证失败块重跑，随后同块第二次返回合格结果。这个规则按书名、章序号与块范围分别计数。

### 全书汇编与原著包（canon/03）

- 迁移 78：`canon_books.has_text`（不含原文的导入包为 0）、`canon_compilations`（每本书一条，idle/running/done/failed）、`canon_compiled_entities`（标准名、别名、一行简介 `lead`、底色 `base` 与带章节锚点的 `base_entries`）、`canon_events.timeline_order` 与 `is_turning_point`。
- 汇编在 `core/src/canon/compile.ts`，三步固定顺序：合并别名 → 排主时间线与标关键转折 → 生成实体页；提示词在 `compile-prompt.ts`，系统首句分别是「你是原著的人物与别名合并器」「你是原著的时间线编者」「你是原著的人物页编者」，e2e 假渠道按这三句分流。
- 合并是程序加模型：别名重叠（同类别）直接合并；同姓人物与名字包含关系作为候选交给模型确认。`applyCanonEntityMerges` 一次改写 `canon_entities`、`canon_facts.entity_name/aliases`、`canon_events.participants`、`canon_voices.character`，重复汇编不会再次改变结果。
- 抽取时名册的首末章要算上事件参与与话术：`canonicalizeExtraction` 用 `appeared` 集合把出现在本块的实体推到本章，否则名册的末章永远停在第一次抽取。
- 时间线由程序按章节、段落与章内序号排 1..N；插叙写 `timeline_order = NULL`；模型只标关键转折（事件编号必须在这一批里）。
- 实体页一次调用最多 4 个实体（`CANON_PAGES_PER_CALL`）；`lead` 不超过 60 字，底色条目章节必须落在实体出现范围内，重复的（章节+正文）条目会被去掉。`compileCanonEntityPages` 会用事实、事件与话术的章节合并出真实出现范围。
- 防剧透切片是纯函数：`sliceCanonEntityPage`、`buildCanonStartingPages`、`renderCanonWorldIndex`/`buildCanonWorldIndex`。实体只在 `firstChapterOrdinal <= upToChapter` 时出现，底色只取锚点不晚于游标的条目；世界索引每行 `${name}——${lead}`，预算 240 字。
- 原著包在 `core/src/canon/package.ts`：`format: "dramaticer-canon-package"`、`version: 1`；默认不含 `paragraphs`，也不带本机路径。导入时按章序号重建新 id，写入 `status='extracted'`、抽取 done（每章 done、0 次调用）、汇编 done，因此不需要模型。
- 导入不含原文的包时 `has_text = 0`：原著页隐藏抽取预估与抽取按钮，只留汇编信息与实体/时间线；`POST .../compile` 对这类书返回 409。
- 接口：`POST /api/canon/books/:bookId/compile`（202）、`GET .../compiled[?upToChapter=]`（带截止章节时附 `pages` 与 `worldIndex`）、`GET .../export?includeText=0|1`（附件下载）、`POST /api/canon/packages/import`（请求体 `{package}`，上限同 txt 导入的 48 MB）。检视器总览每条现在带 `compilation`。
- 汇编任务与抽取共用 `server/src/canon-worker.ts` 的队列，任务用 `kind: "extract" | "compile"` 区分；服务端启动时 `markInterruptedCanonCompilations` 把 running 标为失败，玩家可以重新汇编。
- e2e 假渠道的 `canonCompile` 返回空合并、把本批最后一个事件标为转折、按实体块里的章节生成底色；走查脚本是 `.walk/walk9.spec.ts`。

### 从原著开局（canon/04）

- 迁移 79：`story_canon`（每故事一条绑定：书、开局事件与章节、扮演身份、玩家名、`player_page` JSON、`allow_full_book_spoilers` 默认 0）与 `canon_cursors`（主键 `story_id + node_id`，事件 id、主时间线序号、章节；随楼层 `ON DELETE CASCADE` 自然回退）。
- `core/src/canon/start.ts` 的 `startCanonStory(store, input)` 不自己开事务，由调用方包在 `runInTransaction` 里，失败时故事与绑定一起回滚。给了 `storyId` 就用已有空故事（有楼层或已绑定都会失败）；没给就新建，标题空时用书名。
- 开局事件缺省是主时间线第一件；`sortCanonTimelineEvents` 先按 `timelineOrder`（缺失时排最后）再按章节/段落/章内序号。实体与记事页来自 `buildCanonStartingPages(book.id, event.chapterOrdinal)`：凡 `firstChapterOrdinal` 晚于开局章节的都不进故事。
- `identityKind === "canon"` 时该人物从实体与记事页里排除，切片资料写进 `story_canon.player_page`，同时把「你扮演<名>」、一行简介与截至开局章节的底色写进故事 `persona`；`custom` 时 persona 是「你扮演<名>」加玩家填的人设，全部已出场原著实体正常入库。
- 首楼是程序写出的助手楼层（书名、事件标题、概要、地点、时间、在场），不调用模型；该楼层写入初始游标与最多 3 条主线方向（`canon-<eventId>`，want 是事件标题，obstacle 是概要），玩家可以直接改、删、锁。
- `POST /api/canon/start-story` 一步建故事并可选叠加角色卡；卡的导入在同一个事务里，`importCardContent({ skipCharacterEntity: true })` 跳过卡自己的角色实体（避免与原著扮演人物或 NPC 混淆），保留文风/规则类世界书条目、`characterPrompt`、推荐配置与卡版本。卡的开场白不会成为楼层，因为原著首楼已经先写入。
- `GET /api/stories/:id/canon` 返回 `{ bound: null }` 或绑定详情（书名、开局事件标题、扮演身份、`player_page`、当前楼层游标）；游标缺失时退回最近写入的一条。
- 新建故事弹窗的「从原著开局」只列 `compilation.status === "done"` 的书；人物下拉取所选开局章节的切片，所以只出现已出场人物。e2e 在 `v5-canon-start.spec.ts`，走查脚本是 `.walk/walk10.spec.ts`。

### 原著窗口与游标（canon/05）

- 迁移 80：`story_canon.window_mode`（`summary_only` / `summary_voice` / `full_text`，默认第二个）、`story_canon.pending_advance`（默认 0）、`canon_cursors.from_here`（「从这里开始」刚写入时为 1）。
- `core/src/canon/cursor.ts` 沿 `getPathToNode(nodeId)` 从近到远找 `canon_cursors`；没有楼上游标时退回开局事件。删楼与切换分支都靠这条路径自然回退。`eventOrdinal` 是主时间线 1-based 序号，事件被删时按 `eventId` 重新定位。
- 「从这里开始」把当前 head（或指定楼层）写成 `fromHere = true`；局面更新这一楼即使 `canonCompleted === true` 也不前进，只把同一事件写回并把 `fromHere` 清掉，下一楼才允许推进。玩家偏离或模型没给 `canonCompleted` 时游标原地不动。
- 局面更新（`ledger/scene-log.ts`）只在绑定原著的楼层附上当前事件；提示词里的 `canonCompleted` 是布尔判断，不要求任何时刻格式。解析后由 `advanceCanonCursor` / `holdCanonCursor` 写游标。
- 窗口在 `core/src/canon/window.ts`：当前 1 件 + 需要时接下来 N 件（推进默认 3，待推进件数优先）。`windowMode` 决定叠加话术还是原文；原文只在 `hasText` 且有对应章段落时出现，单件截到 2000 字。死人按局面状态（`DEAD_STATUS_PATTERN`）标注并剔除其话术；明确不在场且地点不同的参与者标注「不在场，无法按原著发生」。
- 上下文槽位 `director` 由 `createCanonWindowSlotProvider` 提供；默认模板在 `pages` 之后加了 `director` 段。槽位 Trace 的每条来源是 `{ kind: "canon", bookId, eventId, chapterOrdinal }`，上下文包校验也认这个 kind。
- `world_index` 与 `pages` 在绑定原著且 `allowFullBookSpoilers === false` 时用游标章节重新切片：世界索引只列 `firstChapterOrdinal <= cursor.chapterOrdinal` 的实体，人物页底色只取锚点不晚于游标的条目；打开开关才用完整底色。扮演的原著人物只进 `persona`，不进 `pages` / `world_index`。
- `createStandardChatSlots` 现在接收 `persona` 与 `store`，默认模板也加了 `persona` 段；扮演原著人物时 `createPersonaSlotProvider` 按游标动态重建玩家角色资料。
- 接口：`PATCH /api/stories/:id/canon/settings`（`allowFullBookSpoilers` / `windowMode` / `pendingAdvance`）、`POST .../canon/advance`（`{count}`，只写待办）、`POST .../canon/cursor`（`{eventId, nodeId?}`，「从这里开始」）。回合落定后 server 清空 `pendingAdvance`。
- e2e 在 `v5-canon-window.spec.ts`，走查脚本是 `.walk/walk11.spec.ts`；`turns.ts` 的回合失败日志现在带堆栈，排 SSE 的「生成失败」先看服务端输出。

### 原著页与事件编辑（canon/06）

- 迁移 81：`canon_event_edits`（`STRICT`）：`story_id`、`event_id`、`node_id`（可为 null）、`field`（`title` / `summary` / `digest` / `voices` / `passage`）、`value`（JSON）、`source`（`player` / `rollback`）、`note`、`created_at`；`BEFORE UPDATE` 触发器直接中止，底层 `canon_events`、`canon_voices`、`canon_chapters` 一律不改。
- `core/src/canon/edits.ts`：`readEffectiveCanonEvent` 沿 `getPathToNode` 取每格最新一版，没有改过的格用抽取结果（标题/概要/缩写来自事件，话术来自本章 `canon_voices`，原文来自章段落范围）；`listEffectiveCanonTimeline` 再按游标标 `past` / `current` / `future`。分支与删楼因此自然隔离。
- 窗口、走向页与场记提示词都改用有效内容：`buildCanonWindow` 的标题、概要、缩写、话术、原文全部走 `readEffectiveCanonEvent`；原文截断到 2000 字仍在窗口里做。`direction/view.ts` 的当前事件、接下来 3 件与推进方向用有效时间线；`ledger/scene-log.ts` 附给场记的事件标题与概要同样换成玩家改过的版本。
- 撤销是追加一条内容相同的新记录（`source: "rollback"`），旧记录不动；按格撤销时取当前路径上该格的上一版，只有一版时回到抽取结果。指定 `versionId` 时直接复制那一版的值，不要求它在当前分支可见。
- 接口：`GET /api/stories/:id/canon/page`（未绑定时 `{ bound: null }`）、`POST .../canon/events/:eventId/edit`（`{field, value, nodeId?}`，默认 head）、`POST .../canon/events/:eventId/rollback`（`{versionId?}` 或 `{field?}`）。两个写接口都返回最新分页视图。
- 记事页「原著」分页只在绑定原著时出现；直接打开 `?tab=canon` 且未绑定会给出原著书架链接。布局在 `Memory.tsx` 的 `CanonBoard` 与 `v4.css` 的 `.canonpage`（桌面两栏、820px 以下上下排列）。停靠栏上下文里的原著条目「去修改」跳到 `/memory?tab=canon&event=<id>` 并选中该事件。
- e2e 在 `v5-canon-page.spec.ts`（编辑进入窗口、撤销刷新仍在、从未来事件从这里开始），走查脚本是 `.walk/walk12.spec.ts`。

## 卡片前端（2026-11-27 起，card-ui/01）

- 插件内核的第六个扩展点：`PluginContext.floorRenderer(definition)` 注册，`PluginKernel.floorRenderers()` 读注册项，`renderFloor({nodeId, raw, state}, budgetMs?)` 按注册顺序认领。认领条件是 `blockTypes`（楼层里出现的标签名）或 `patterns`（正则），至少一个；`permissions` 只能取 `FLOOR_BRIDGE_CAPABILITIES` 的五个名字。渲染器抛错或超过默认 500 毫秒被跳过并记进 `failures`，正文按原生方式显示（I8：只派生，不改原文）。
- 声明式插件新增 `floor-renderer`：`payload` 为 `{id?, name, blockTypes?, patterns?, permissions?, template, script?, style?}`，`id` 缺省用插件名；模板里的 `{{content}}` 换成转义后的楼层原文。`core/src/plugins/declarative.ts` 解析，`core/src/plugins/floor-renderers.ts` 转成内核插件。
- 故事级存储：迁移 82 建 `sandbox_rejections`（`id`、`story_id`、`node_id` 可空、`renderer`、`kind` bridge/network、`target`、`reason`、`created_at`）。允许名单、检测结果与渲染器都在 `story_kv`：`sandbox.allowedDomains`、`sandbox.detectedDomains`、`sandbox.renderers`；默认都是空，沙箱默认不联网。读写函数在 `core/src/sandbox/story-sandbox.ts`。
- 导入卡时 `afterCardImport` 把 `extensions.dramaticer.plugins` 里的楼层渲染器装到故事上，并扫描整张卡 JSON 的 http/https 域名作为检测结果（只作展示，默认全部未允许）。玩家在设定页逐个允许，`POST /api/stories/:id/sandbox/domains` 立即写入并返回最新视图。
- 接口：`POST .../render`（`{nodeIds}`，最多 200，只渲染路径上已有的助手楼层）、`GET .../sandbox`、`POST .../sandbox/domains`、`POST .../sandbox/renderers`（更新渲染器脚本）、`GET|POST .../sandbox/rejections`、`GET .../sandbox/state?nodeId&path=JSON`、`POST .../sandbox/state`（`{renderer, nodeId, write}`）。
- 服务端渲染 `server/src/renderers.ts` 每个请求用一个 `LiteKernel` 装载故事上的声明式渲染器，按楼层读 `readLedger(store, nodeId)` 作为可见状态，返回 `{renderer, name, html, script, style, permissions, failures}`。没有渲染器或渲染失败时 `renderer: null`。
- 交互桥在 `web/src/chat/floor-sandbox.ts` 与 `components/chat/FloorFrame.tsx`：iframe 只用 `sandbox="allow-scripts"`，父页面校验 `event.source` 与 `origin === "null"`；五个方法必须同时在白名单和渲染器 `permissions` 里，否则回传错误并 `POST` 拒绝记录。`writeState` 在服务端按存储的渲染器权限再查一次，写入前跑 `validateLedgerDiff`，再 `appendStateDiffs`（I12、I16）；未知渲染器或未声明 `writeState` 一律 403 并记录。
- CSP 由 `buildSandboxContentSecurityPolicy(allowedDomains)` 生成：`default-src 'none'`，脚本/样式/图片/字体/媒体只加允许域名的 http/https，`connect-src` 另加 ws/wss，空名单是 `'none'`。沙箱脚本另外拦截 `fetch`、`XMLHttpRequest.open`、`WebSocket` 并监听 `securitypolicyviolation`，一律把被拦的地址报给父页面。
- 主题：`readFloorSandboxTheme()` 抄父页面 `data-theme` 与 `v4.css` 的颜色/字体变量进 iframe，主题切换时 `postMessage` 更新；高度由 iframe 的 `ResizeObserver` 与 `MutationObserver` 上报，父页面夹在 1–10000 像素，避免双滚动条。
- 前端运行时不要从 `@dramaticer/core` 主入口取沙箱工具：主入口会带进 better-sqlite3 等 Node 模块，整包进浏览器会白屏。浏览器安全的子入口是 `@dramaticer/core/sandbox`（`src/sandbox/browser.ts`，只导出能力白名单、域名扫描与 CSP）。
- e2e 在 `v5-card-ui.spec.ts`（合成卡渲染按钮发消息、未声明写状态与外部域名进检视器、域名允许后刷新仍在、CSP 带上域名），走查脚本是 `.walk/walk13.spec.ts`；测试卡在卡扩展里直接声明渲染器，不需要测试专用路由。

### 酒馆美化正则与助手脚本（card-ui/02）

- 转换与存储都在 `st-compat/src/st-renderer/`：显示层正则取 `extensions.regex_scripts` 与预设 `regexScripts`（未禁用、非 `promptOnly`、`markdownOnly` 或作用位置 0/2），助手脚本取 `extensions.tavern_helper.scripts` 里 `enabled && type === "script"` 的条目；配置存在 `story_kv` 的 `st.compat.cardUi`，core 不认识这个键。
- 两个渲染器 id：`st-content-regex`（酒馆美化正则）与 `st-helper-host`（酒馆助手脚本）。`createStCardFloorRenderer` 每次渲染请求按配置现算：只开正则时用前者；助手脚本开着时用后者，并把正则与脚本合成同一个 iframe（内核一层只认领一个渲染器）。关掉正则只影响替换，关掉两个就返回 `null`，正文回到 `Prose`。
- 助手脚本的垫片在 `st-compat/src/st-renderer/shim.ts`：`getVariables` 读渲染时嵌入的 `mvu` 快照，写入走 `window.dramaticerBridge.writeState` 落到 `mvu.*`；`triggerSlash("/send …")`、`/setinput`、`/trigger` 映射到发消息、填输入框与 iframe 内事件总线；`eventOn`/`eventEmit` 在 iframe 内同步，不跨楼层。`setChatMessages` 直接抛错，楼层原文不可改（I4）。
- 声明式 `floor-renderer` 的 `patterns` 可以写 `/pattern/flags` 字面量；ST 的显示正则靠这个把 `s` 标志带进认领条件。
- 渲染器可以关掉：`story_kv` 里的 `sandbox.renderers` 记录带 `enabled`，旧记录缺省按开启；`POST /api/stories/:id/sandbox/renderers/:id` 传 `{enabled}` 同时处理声明式与 ST 渲染器，`GET .../sandbox` 的列表带 `enabled`，设定页的开关直接改它。
- e2e 新增在 `v5-card-ui.spec.ts`（状态栏与按钮、点击写 `mvu.energy` 并发消息、设定页关掉两个插件后没有 iframe、原文 `<stat>` 可见），走查脚本 `.walk/walk14.spec.ts`。


## 剧情插图（2026-11-27 起，image-v2/01）

- 分格与标签库的词表在 `core/src/images/vocabulary.ts`，只含常量与纯类型。浏览器要取这些常量时用子入口 `@dramaticer/core/image-vocabulary`；不要从 core 主入口取值，主入口会把 better-sqlite3 带进 Vite 包并白屏。
- 视觉档案的 JSON 增加 `locked` 与 `slots`（脸/上身/全身 × 正/背 × 着装/裸露）；旧行没有这两个字段时分别补 `false` 与全空 12 格。`assertCharacterVisualProfile` 仍然拒绝未知字段。
- 展开纯函数是 `expandVisualProfile`：按视角 × 部位 × 着装状态取一格，空格回退 `base`；着装时按画面里上身/全身可见或隐藏拼服装的对应标签。`selectCharacterOutfit` 按显式选择、台账 `outfitPath`、默认服装的顺序取一套。
- 独立服装在迁移 83 的 `character_outfits`，一套服装存上身/全身 × 可见/隐藏四组标签；同一人物最多一套默认。标签库在 `tag_library_entries`，与写作条目同构，故事条目与全局条目共存，替换只动故事条目。
- 写作条目增加 `scope`（默认 `turn`）；画面整理专用条目是 `image_organizer`，`applyWritingEntries` 只发 `turn`，两套编辑界面分别只显示并保留自己那套。
- 智绘姬兼容导入在 `st-compat/src/image-import/`：`characters.ts` 读角色库/服装库（角色列表、12 格或平铺分格、角色下或根部服装），`prompts.ts` 读生图预设（有关键词的进标签库，其余进画面整理条目）。服务端只经 `POST /api/stories/:id/images/import-st` 调用它，core 不依赖 st-compat。
- 接口：`PUT .../visual-profiles`、`GET|PUT .../outfits`、`GET|PUT .../image-tags`、`GET .../image-organizer/entries`、`POST .../images/import-st`。设定页由 `v4/VisualProfileEditor.tsx` 提供分格、服装、标签库、整理条目与两个导入按钮。
- e2e 在 `v5-image-profiles.spec.ts`（桌面/手机：导入、锁定、编辑并刷新保留、服装新增、标签编辑、整理条目与存储作用域），走查脚本 `.walk/walk15.spec.ts`。

## 画面整理（2026-11-27 起，image-v2/02）

- `node_images` 在迁移 84 新增 `insert_after_paragraph`、`title`、`organizer_result`；`organizer_result` 存完整的结构化结果与展开后的提示词、人物级负面和坐标，出图重试与重绘直接复用，不再重跑整理模型。
- 画面整理任务 `image_organize` 是故事级、`gap` 档：`needsRun` 先看手动请求（存在故事 kv `images.organizeRequests`），再按 `trigger`（`scene_end` / `floor` / `manual`）与 `mode` 找第一个未整理过的落定助手楼层。一次只整理一楼，成功后才消费手动请求并排 `illustrate`。
- 输入收集在 `collectImageOrganizerInput`：目标楼按段落编号、上一楼、在场者记事页、世界索引、按关键词命中的标签库、`scope: "image_organizer"` 的写作条目、人物与服装短表、最近 N 条出图提示词。所有来源只读。
- 展开在 `expandImageOrganizerResult`：每个人物按 `angle × body × exposure` 调 `expandVisualProfile`，显式 `outfitName` 优先、否则按台账当前服装与默认服装取一套；没有档案的人物只保留名字与动作。
- 后处理管线在 `images/compile.ts`：替换规则（字面或合法正则）→ 全角标点清洗 → 按逗号归一化去重。人物级提示词与总提示词都走同一条管线。
- 服务端：`POST /api/stories/:id/nodes/:nodeId/organize-images` 手动入队；`GET|PUT .../image-organizer/rules` 读写触发频率、最近提示词条数与替换规则。设置的图片配置仍随故事设置保存。
- 后台调度在整理成功后补一轮只跑 `illustrate`，避免出图要等到下一次玩家输入。整理失败只让后台任务记 failed，正文与楼层读取不受影响。
- e2e 在 `v5-image-organizer.spec.ts`（桌面/手机：设置落定、自动整理、手动再整理、图像后端、失败不影响正文），走查脚本 `.walk/walk16.spec.ts`。

## NovelAI 按模型族生成请求（2026-11-27 起，image-v2/03）

- `novelai-params.ts` 的模板参数新增 `mediumTier`、`negativePreset`、`fixedSeed`、`useCoords`、`straightAlpha`、`tagHintQt`、`tagHintUcPreset`；旧模板 JSON 缺这些字段时由 `assertNovelAiParameters` 补默认值，`model` 接受任意非空自定义 id。
- `detectNovelAiFamily` 只看模型 id 是否含 `nai-diffusion-5` / `nai-diffusion-4`，其余归 V3。V5 的 Medium 档在 `resolveNovelAiModel` 里加 `-medium` 后缀，已带后缀不重复。
- 请求体在 `buildNovelAiRequestBody`：V3 把人物提示词与人物负面拼回扁平字段，不发 `v4_prompt` 与 `characterPrompts`；V4.x 用 `v4_prompt` / `v4_negative_prompt` / `characterPrompts`，`varietyBoost` 时按尺寸算 `skip_cfg_above_sigma`；V5 用 `params_version: 4`，不发跳过 CFG、旧参考数组与默认噪点表，写 `straight_alpha` 与 `tag_hint_*`。
- 负面预设的 `ucPreset` 数值：Heavy 0、Light 1、Furry 2、Human 3、None 4；非 None 的预设词由程序拼进负面提示词。`tag_hint_uc_preset` 的数值与 `ucPreset` 不同（None 0、Heavy 2、Light 3、Human 4、Furry 5）。
- 出图任务从 `node_images.organizer_result.expanded` 里按 prompt 与 negative 找到本条记录对应的人物，把 `{prompt, negativePrompt, center}` 传给客户端；模板 `fixedSeed` 非空时优先于楼层 seed。
- NovelAI 客户端同一 provider 串行，按 `maxRequestsPerMinute`（`images.yaml` 的 provider 字段，默认 10）滑动窗口排队；429 先看 `Retry-After`，否则从 `retryBaseDelayMs` 翻倍，默认最多再试 3 次。测试注入 `sleep` / `now`，不真实等待。
- `images import`（ComfyUI workflow）现在只在 comfyui 后端里选 provider；配置里同时有 NovelAI 后端时不会因「多个 provider」失败。
- e2e 在 `v5-novelai-template.spec.ts`（桌面/手机：自定义模型、Medium、负面预设、固定 seed 与 V5 开关保存后回读），e2e 的 `serve.mjs` 给 images.yaml 加了一个假 NovelAI 后端；走查脚本 `.walk/walk17.spec.ts`。
- `novelai.live.test.ts` 与其它 live 用例同一口径：`DRAMATICER_LIVE=1` 才跑，开关没打开时整组跳过、不碰网络；开了开关才读仓库根 `.env` 的 `NOVELAI_API_KEY`，`.env` 不在或没这个令牌时报出缺令牌，有令牌才真的请求官方接口出一张小图。

## 插图插段与重绘（2026-11-27 起，image-v2/04）

- `node_images` 在迁移 85 新增 `prompt_edited`。玩家改过提示词后，出图任务以记录里的 `prompt` / `negativePrompt` 为最终文本，`organizerCharacters` 返回空数组，不会再拿旧 `organizer_result.expanded` 里的人物提示词覆盖玩家修改。
- `ImagesRepo.redrawNodeImage(id, options)` 支持 `new_seed`（保证新 seed 与旧的不同）、`edit_prompt`（可带 `seed`，不给就沿用原来的）、`switch_workflow`（保留 prompt 与整理结果）。三种都重置为 `pending`、`attempts = 0`、`error = null`，并清掉文件元数据；楼层原文不动。
- `deleteNodeImage` 只删 `node_images` 一行。服务端 `DELETE /api/images/:id` 再用 `resolveMediaFile` 校验后清理生成文件；正在出图的记录拒绝重绘与删除（409）。
- 新插图的序号取 `MAX(ordinal) + 1`，删掉中间的图后再加不会撞 `UNIQUE (node_id, ordinal)`。
- `toNodeImage` 返回 `workflowId` 与 `seed`；`url` 带 `v=updatedAt`，同一张图重绘后不会命中旧缓存。
- 故事页 `Prose` 按 1-based 段落序号插 `<figure class="floor-ill">`：`0` 在第一段前，`k` 在第 k 段之后，`null` 或超出段落数排在楼层末尾；插件渲染的楼层由 `FloorImageList` 统一放在正文下方。
- 插图菜单在 `v4/FloorImages.tsx`：重绘（换 seed）、改提示词后重绘（内联提示词与负面）、换模板、删除；failed 另加重试。助手楼层操作区（`.flr-acts`，带 `data-node-id`）加「画这一幕」，未选 workflow 或关闭生图时给提示与故事设置链接。
- e2e `v5-image-inline.spec.ts`（桌面/手机：段落位置、三种重绘、删除不改原文、手动画这一幕）；假 ComfyUI 把正向提示词编进图片宽度，测试据此确认后端收到的就是玩家改过的文本。走查脚本 `.walk/walk18.spec.ts`。

## 界面文案（2026-11-27 起，ui-v2/06）

- 文案对照表在 `docs/proposals/v5.md` §8.3；界面只用人话和标准软件术语，不写解释架构的句子，不用「它」指代模型。
- 档位界面字是「轻量 / 标准 / 完整」（存储值仍是 `lite / standard / immersive`）；思考是「关闭 / 低 / 高」（`off / low / high`）；剧情线状态是「进行中 / 已偏离 / 已达成」；识别不出类型的条目叫「未分类」。`GLOSSARY.md` 与界面同步，改词要同时改两处。
- 后台失败条在 `v4/BackgroundNotice.tsx`：标题是「后台任务连续失败 N 次」，按钮「检查渠道」跳到全局设置 `/settings`；故事下没有 `/channels` 路由。
- 文案改动会打击以文字定位的 e2e（`v4-prefs`、`v4-outline`、`background-notice`、`import-audit` 等），改完先全局搜索旧词；走查脚本 `.walk/walk19.spec.ts` 覆盖书架、故事、记忆、走向、设定、设置、全局设置、检视器、404 与后台失败条。
