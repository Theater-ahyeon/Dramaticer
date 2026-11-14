# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-14 会话 370：完成 X1.d（世界模型对比运行器）。新增 `packages/st-compat/src/evalset/world-model-compare.ts` 与 CLI（`pnpm --filter @dramaticer/st-compat world-model-compare`）：每个候选与每次重复复制同一份源数据库，固定快回合与同一串玩家消息、同一批记忆题与探针运行；实体档案候选在每轮后把涉及人物的档案修订通过 `WorldModel.write` 补写，台账与时序图谱不额外写入；时间点探针只对 `temporal_graph` 调 `read(nodeId, { atStoryTime })`，台账与 wiki 记为不适用；指标表统一为矛盾率、编造回忆率、盲测胜率与每轮请求数、首字与时延 P50/P90，默认重复 3 次；每个候选与重复写 sidecar，重跑复用，单次失败只进报告。ADR-0129；新增 3 个假客户端测试；门禁通过（251 个测试文件、2,189 个测试、5 个跳过）。

## 下一步（会话 371 先做）
1. **X1.e 在 3 个对话上运行并判定**：准备 3 个评测对话的源数据库（已导入故事、卡、实体与 lore，最好已经有带 `storyTime` 的台账事实），为每个对话准备固定玩家消息文件（JSON 数组，每轮一条）与可选记忆题文件；用 `pnpm --filter @dramaticer/st-compat world-model-compare` 对每种候选跑 3 次。硬跑预计超过 10 分钟，按 `.devloop/jobs/` 申请长任务，结果写 `WAITING`。
2. 跑完后按规则判定：候选的主要指标不劣于 ①（`ledger`），且盲测胜率明显高于 ①才切换；否则保留 ①。结论写 ADR，指标表写报告（只写统计数字），未切换的候选留在 `worldModel` 开关后面。
3. 如果时间点探针样本为 0，先检查源数据库路径上是否有 `storyTime` 标签；没有标签就如实写 0，不要补造。

## X1.d 设计要点
- 输入是 `sourceDbPath`（已导入故事的数据库）、`story`、`rounds`、`messages`（同一串玩家消息）、`repetitions`（默认 3）、`dir`、写作与裁判客户端、模板、预算与结构化输出方式；`questions` 为同一批记忆题；`probeCount` 默认 4、`timeProbeCount` 默认 2。
- 运行器只读打开源数据库一次，从源 head 的台账事实里按种子确定地挑选召回探针与时间点探针；之后每个候选与每次重复复制一份源数据库，改故事设置的 `worldModel`，用 `createStandardChatSlots` 建槽位。固定 `turnMode: "fast"`，避免候选之间混入深回合开销。
- 回合写入仍走 `runChatTurn` 的结构化输出与结算路径；运行器只补写候选自己的表示：`wiki` 把本轮涉及的人物写成一条 `["profile", "<人物>"]` 修订，正文含楼层号与当前字段（层级、身份、外貌、衣着、状态、位置），来源 `settler`。`ledger` 与 `temporal_graph` 不额外写入。
- 召回探针的参照值取候选自己的最终世界模型状态；记忆题在最终 head 上提问，证据楼层仍指向复制数据库里的原楼层。时间点探针的参照值只对 `temporal_graph` 用 `read(head, { atStoryTime })` 计算，`ledger` 与 `wiki` 直接记 `unsupported`，不调用模型。
- 指标：矛盾率 = 召回探针与记忆题里矛盾数 /（一致 + 矛盾）；编造回忆率 = 编造题判矛盾数 / 被判定的编造题数；盲测胜率 = 候选在两种展示顺序下胜出的非平局判定占比；每轮成本 = 自动试玩期间写作客户端的非缓存请求数 / 轮数，首字与时延取 Trace 的 P50 与 P90。时间点探针单独列样本与判定数，不混入矛盾率。
- 盲测用 `runPreferenceSample` 与 `summarizePreferenceComparisons`；接受侧是候选回复，放弃侧是同一重复、同一轮次的 `ledger` 回复；上下文只用玩家消息计划的前缀。两轮文本完全相同时裁判直接判平局，不调用模型。
- 每个候选与重复完成后写 `runs/<候选>/<序号>.json`（临时文件加重命名）；重跑时校验格式、故事、候选、重复序号、轮数、玩家消息摘要与种子后复用。失败只记进报告，不写 sidecar，其他候选与重复继续。
- 报告 JSON 含每个候选的指标、样本数与原始运行记录（含回复与答案，放在私有目录）；Markdown 报告只含数字、候选名与失败原因。
- 已知限制：源 head 没有任何台账事实时召回探针为 0；源事实没有 `storyTime` 时时间点探针为 0；wiki 的档案正文由程序从台账字段生成，不是后台模型写的软知识。

## X1 任务划分（ADR-0126 至 ADR-0129）
- **X1.a（已完成）** 统一接口与台账候选；故事设置 `worldModel`；状态槽位接线；未实现候选在选择时失败。
- **X1.b（已完成）** 实体档案修订表与 `wiki` 适配器：台账加只追加的人物档案。
- **X1.c（已完成）** 时序知识图谱候选：从台账 diff 回放有效区间，读取带失效段，支持按故事时间点查询。
- **X1.d（已完成）** 对比运行器与 CLI：每个候选复制数据库、固定快回合自动试玩、同一批记忆题与探针、与候选 ① 盲测；指标表统一；默认重复 3 次；sidecar 续跑。
- **X1.e** 3 个对话、每种候选 3 次的实跑与判定（主要指标不劣于 ① 且盲测胜率明显高于 ① 才切换，否则保留 ①），结论写 ADR，未切换的候选留在开关后面。

## X1.c 设计要点
- `WorldModelReadOptions { atStoryTime?: string }` 是 `read(nodeId, options?)` 的第二个参数；不传时三个候选都返回当前视图。台账与 wiki 收到 `atStoryTime` 时由 `assertTimeQuerySupported` 直接抛错，不静默忽略。
- `temporal_graph` 的有效区间完全来自当前路径上的台账 diff：同一路径的每次 set 开启一版；之后的 set 或 delete 关闭该路径及其下层的活动版本（`isPathPrefix`），delete 记 `endReason: "deleted"`、set 记 `"superseded"`，保留最后一版的值与起止楼层。关闭后再次 set 会开启新的一版。
- 当前视图的 `state` 仍是台账快照，`sections` 只有一段「已失效事实」，每行是 `JSON(path) = JSON(value)（楼层 <start> → <end>；原因 已删除|被新值取代；来源 <source>；故事时间 <start> 至 <end>）`；`source` 为 `state:<n> 条 diff，已失效 <m> 条`。
- 时间点查询只考虑自身 `storyTime` 非空的版本；标签是不透明文字，时间轴按标签在当前路径上第一次出现的顺序建立；版本的有效终点取自身 `storyTime.end` 与结束事件时间（`endStoryTime.start ?? end`）的较早者。查询标签必须在该路径上出现过，否则抛错；同一路径多版命中时取较晚的一版，选中的版本按写入顺序用 `applyDiffEntriesTo` 累加成 `state`，`source` 为 `state:时序图谱 <n> 条事实，故事时间 <label>`。
- `createTemporalGraphWorldModel(...).versions(nodeId)` 返回全部版本（含仍成立的一版），`write` 直接委托台账适配器；工厂的 `temporal_graph` 分支返回该对象，`packKey` 自动为 `state:temporal_graph`。

## X1.b 设计要点
- 迁移 v48 `world_wiki_revisions(id, story_id, entity_id, node_id, text, story_time_start, story_time_end, source, created_at)`：修改由触发器拒绝，删除只在楼层已不存在时放行。`node_id` 既是写入楼层也是这一版的出处楼层。
- 档案实体 id 是台账 `character.<id>` 的人物 id。档案只能写给台账里已经存在的人物；同一批写入里先写人物字段再写档案也算已存在。人物字段必须逐项写，整对象写入会被 `validateLedgerDiff` 拒绝。
- 档案路径固定为 `["profile", "<人物>"]`，`op` 只能是 `set`，`value` 是非空正文；其余路径交给 `validateLedgerDiff` 后写台账 diff。未知人物、空正文、删除档案在写入前抛错。
- 读取用递归 CTE 连接当前路径；`sections` 每个有档案的人物一段：标题 `档案：<人物>`，正文是最新一版，末尾一行 `版本数：N；出处楼层：<nodeId>；最早出处：<nodeId>`；段落按人物 id 排序。
- `source` 在 wiki 下为 `state:<n> 条 diff，档案 <m> 版`；`packKey` 仍为 `state:wiki`。

## 当前状态
- 已完成：F0、M0–M3、D、M4-T00 至 M4-T06、R0、R1（含 R1-T99、R1-T99.a）、R3、O、R2、E、R4、R5、V-T01、M6-T00 至 M6-T05、R3b、P1–P4、C-T01 至 C-T05、H-T00 至 H-T99、X1.a 至 X1.d。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成（含一致性测试与共存评测）。
- 数据库 schema 版本 48。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`、`H.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`。
- ADR-0088 至 ADR-0129 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染、覆盖率口径、应用内助手、世界模型接口、实体档案、时序图谱与对比运行器的决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16、HUMAN-17、HUMAN-18 待处理（不阻塞）：临时目录清理、ST-Prompt-Template 与酒馆助手上游许可证确认。

## 可重复命令
- 门禁：`pnpm check`。
- X1.d 目标测试：`pnpm exec vitest run packages/st-compat/test/world-model-compare.test.ts`。
- X1.d CLI：`pnpm --filter @dramaticer/st-compat world-model-compare --db <path> --story <id> --messages <玩家消息.json> [--questions <记忆题.jsonl>] [--repeat 3]`。
- X1.c 目标测试：`pnpm exec vitest run packages/core/test/world-model.test.ts`。
- X1.b 目标测试：`pnpm exec vitest run packages/core/test/world-model.test.ts packages/core/test/assistant-store.test.ts`。
- X1.a 目标测试：`pnpm exec vitest run packages/core/test/world-model.test.ts packages/core/test/story-settings.test.ts packages/core/test/chat-providers.test.ts packages/web/test/settings-form.test.ts`。
- H-T99 真实渠道验收：`node .devloop/scratch/H-T99/live.mjs`。
- H-T99 e2e：`pnpm --filter @dramaticer/server build && pnpm --filter @dramaticer/web build && pnpm --filter @dramaticer/web exec playwright test e2e/assistant.spec.ts`（desktop 与 mobile 各 5 条）。
- 共存评测：`node packages/st-compat/dist/st-bench/cli.js coexist --config <配置.json> [--out <目录>]`（已注册插件：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host`）。
- 不变量检查：`node scripts/check-invariants.mjs`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
- 不变量：I1–I18 的定义见 `AGENTS.md`；世界模型实验不改变 I5、I6、I9、I12、I15。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。X1.d 的 JSON 含回复与答案，只能放在私有目录。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁连跑或与大量临时目录写入同时进行时，Windows 的系统扫描会拖慢文件与 SQLite 操作，出现过后台 worker 激活超时与 `gap-pass-compare` 的 30 秒用例超时；这些用例单独运行都通过。门禁失败先看失败是否只在整轮并行时出现，不要连续并发跑多轮整仓测试；`gap-pass-compare` 的 3 个用例上限已放宽到 180 秒。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。上下文摘要按结构化请求处理，也使用 `NO_CONTINUATION`。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以；助手类型从 `@dramaticer/protocol` 取。
- 世界模型只用故事设置 `worldModel` 选择；新增调用方传 `settings.worldModel`，不要自己判断种类或回落到台账。状态槽位的 `packKey` 必须带种类（`state:<kind>`），否则不同表示会共用上下文包指纹。
- `WorldModel.read` 的 `atStoryTime` 只有 `temporal_graph` 支持；台账与 wiki 会直接抛错。时间点标签必须是在当前路径上出现过的文字，顺序按首次出现建立（ADR-0128）；评测探针不要假设它等价于真实时间轴。
- 时序图谱的失效段只在当前视图的 `sections` 里；时间点查询的 `state` 由命中的版本累加，`sections` 为空。`versions(nodeId)` 是调试与评测入口，不在状态槽位里使用。
- 实体档案（`wiki`）的写入路径是 `["profile", "<人物>"]`，其余路径按台账 diff 校验；档案实体必须是台账 `character` 里的人物，人物字段逐项写，整对象写人物会被 `validateLedgerDiff` 拒绝。
- `world_wiki_revisions` 只追加：没有更新与删除接口，修改由触发器拒绝；读取按当前路径的递归 CTE，分支切换不跨分支。
- `WorldModel.write` 先逐条 `validateLedgerDiff` 再写，供对比运行器使用；剧情结算仍走 `applySettlementProposals`，不要用这个接口绕过结算器（I12）。
- X1.d 的源数据库只读打开一次用于挑探针，随后关闭；所有写入都在复制出来的数据库里。重跑复用 `runs/<候选>/<序号>.json`，修改玩家消息或种子会导致校验失败并提示删除 sidecar。
- X1.d 的盲测上下文只用玩家消息前缀，不包含候选各自的正文；两轮文本完全相同时裁判直接判平局，不调用模型。
- X1.d 的每轮成本只统计写作客户端的非缓存请求与 Trace 耗时；记忆题、探针与盲测裁判的请求单独发生，不计入每轮成本。
- `pnpm exec biome check --write <文件>` 处理格式；不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
- MVU 引擎的 `[值, 说明]` 判定与 MVU 一致：长度为 2 且第二个元素是字符串的普通数组也会被当成值加说明，测试与真实卡都要避开这种歧义；需要真正两个元素的列表时用三个元素或开启 `strictSet` 后显式写结构。
- 显示状态只在当前会话；需要跨进程显示时由台账快照重新渲染，不要把它写成楼层原文或台账事实。
- 共存适配器在 `apply` 之后按轮调用 `afterTurn`；插件写错直接让运行失败，不要吞掉错误。`st-mvu` 适配器要求卡里有 `[initvar]` 世界书或开场白 `<initvar>`。
- 共存评测的关闭组：适配器提供 `baseline` 时用 `<runDir>/<pluginId>/off`；不提供时用 `<runDir>/baseline/off`。`afterTurn` 只在开启组执行。
- 共存盲测的平局不计入胜负；两份文本完全相同时 `judgePairwise` 不调用裁判、直接判平局。
- `st-helper-host` 的共存批次不执行脚本：Node 里没有 iframe；开启组只做脚本库发现与状态栏渲染请求，两组提示词逐字节相同。脚本执行由沙箱单元测试与浏览器 e2e 覆盖。
- EJS 模板里再写 `<%` 会被外层标签解析截断：内层模板通过变量或 `evalTemplate` 的第二参数传入。
- `st-ejs` 的激活正则默认一次性生效（命中后停用）；注入标记与 `@INJECT` 必须独占一行才会被识别。
- 沙箱里模板函数是同步的（远程调用会阻塞模板线程），函数参数与返回值必须能 JSON 化；`define` 只在一次执行内有效，`include` 不可用。
- 回合预算只从调用方传进来：槽位提供者用 `request.budget`，直接调用运行时用 `render(text, { budget })`。
- `StEjsVariableStore` 接入 `backend` 后，不指定作用域的写进入 `initial`（台账 `mvu`），global/message/local 仍是插件内存。
- 模板生成只登记请求：`generate` 返回 id 不返回正文，宿主用 `createStEjsBackgroundGenerationRunner` 接后台客户端并在间隙 `drain`。
- 酒馆助手的沙箱 API 全部异步：`postMessage` 不能同步取返回值，脚本必须 `await`。事件监听用整数 token；超时由宿主 `sweepTimeouts()` 驱动。
- STscript：`triggerSlash` 只执行 `ST_HELPER_SLASH_COMMANDS` 里的命令，未知命令按名字失败。变量命令默认作用域与上游一致（`setvar` 是 chat/local）。
- `/gen` 与 `/genraw` 只登记后台请求并返回请求 id，不返回正文，回合内不等待。
- HTML 状态栏与开场页的渲染结果只在插件显示状态（`PluginDisplayState`）；要把它们接入界面时读 `readStHelperHtmlPage`，不要写回楼层原文或台账。
- 状态栏自动重渲染由变量写入触发，连续自动刷新默认上限 8 次；开场页不参与自动重渲染。
- 酒馆助手的 API 覆盖率快照以本机 JS-Slash-Runner 4.8.10 为准；升级上游版本时要重新生成 `coverage.ts` 的名字清单并同步报告与测试断言。
- 助手任务不要复用 `turn_runs`；助手运行状态与事件在 `assistant_conversations`、`assistant_events` 里。批准助手动作时调用现有写入函数。
- 助手接口的请求与响应类型放在 `packages/protocol`，不要从 web 直接 import `@dramaticer/core` 的运行时。
- 助手并发启动有两层保护：server 的 `AssistantRunCoordinator` 返回 409，store 的 `startAssistantConversationRun` 在同一事务里拒绝第二个 running。
- 助手工具的 `permission` 是助手自己的三级权限判定；传给深回合执行器时统一为 `read`。
- `assistant_actions` 的待定唯一索引以规范化 JSON 载荷为键；同会话同种类同载荷复用已有待定动作。批准顺序是先校验、再调用领域写入、最后改状态。
- 台账变更卡来源增加 `assistant` 后，`assistantConversationId` 只允许助手来源填写；批准仍走 `approveLedgerChangeCard`，任何权限级别都不能自动批准。
- 技能注册表以 `packages/core/src/assistant/skills.ts` 为唯一来源；新增技能在注册表里登记，server 端创建与 PATCH 会话都按注册表返回 400。
- 技能白名单里的工具名必须在本次运行实际注册；未注入时带该名字的技能会让 `runAssistantTurn` 在切换运行状态前抛错。
- `AssistantDocsIndex.load` 每次 `startServer` 都会读取并切分文档（约 1.6 MB），server 测试的启动耗时会增加数百毫秒。
- 提案工具在 server 里对所有会话注入，靠白名单过滤；不要按权限过滤工具名。
- 台账变更卡 id 包含当前 head：同一内容在 head 未变时复用同一张卡，head 变化后会生成新卡。
- `summarize_recent` 只读现有压缩与摘要；新增摘要仍然走后台任务。
- 联网搜索只由 `--assistant-web-search` 开启；测试只注入假客户端。
- 渠道读取不返回密钥值；`propose_channels_change` 四个段必须给全，批准时仍由 `readChannelsUpdate`、`applyChannelsUpdate` 与 `parseChannelsConfig` 校验并写文件。
- 抽屉的持久状态只有 localStorage 里的活动会话 id；消息、状态与事件都以 server 为准，不要缓存正文。
- 重连轮询必须在改状态之前把会话详情与消息写入状态；`status` 变化会触发 effect 清理。
- 关闭抽屉的焦点恢复要等两帧；触发按钮用选择器 `.assistant-open-button` 查找。
- 压缩记录只追加；需要重新压缩只能新增一条，最新一条生效。
- 自动压缩在 server 的消息接口里执行，`runAssistantTurn` 自身不触发压缩。
- 压缩失败的自动运行仍然返回模型回答；不要因为压缩失败把会话标成失败或丢弃消息。
- 待确认数量与待确认视图必须同源：`refreshPendingActions` 同时读动作与变更卡。
- 审阅面板的渠道字段只能渲染白名单字段；原始载荷不要直接 `JSON.stringify` 到界面。
- e2e 的审阅种子按 Playwright 项目名分开（`e2e-assistant-review-mobile`、`e2e-assistant-review-desktop`）。
