# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-14 会话 369：完成 X1.c（时序知识图谱候选）。门禁通过（250 个测试文件、2,186 个测试、5 个跳过）。新增 `packages/core/src/world-model/temporal-graph.ts`（`TemporalFactVersion`、`TemporalEndReason`、`TemporalGraphWorldModel`、`createTemporalGraphWorldModel`）：沿当前路径回放台账 diff，每次 set 开启一版，set 或 delete 关闭该路径及其下层的活动版本并保留最后一版的值、起止楼层、失效原因与结束事件时间；`read` 返回台账快照与一段「已失效事实」；`WorldModel.read` 增加可选 `atStoryTime`，台账与 wiki 收到时间点查询直接抛错；工厂接上 `temporal_graph`；ADR-0128；新增 5 个测试。

## 下一步（会话 370 先做）
1. **X1.d 对比运行器**：`packages/st-compat/src/evalset/world-model-compare.ts` 与 CLI。每个候选复制数据库、固定轮数自动试玩、同一批记忆题与探针、与候选 ① 盲测；指标表统一为矛盾率、编造回忆率、盲测胜率与每轮成本（请求数与时延），默认重复 3 次，支持断点续跑。写入走 `createWorldModel(store, kind).write`；时间点探针用 `read(nodeId, { atStoryTime })`，台账与 wiki 不支持时间点查询，探针按候选能力记录为不适用，不要伪造结果。
2. 之后做 X1.e（3 个对话、每种候选 3 次的实跑与判定，长任务按 `.devloop/jobs/` 申请）。

## X1 任务划分（ADR-0126、ADR-0127、ADR-0128）
- **X1.a（已完成）** 统一接口与台账候选；故事设置 `worldModel`；状态槽位接线；未实现候选在选择时失败。
- **X1.b（已完成）** 实体档案修订表与 `wiki` 适配器：台账加只追加的人物档案。
- **X1.c（已完成）** 时序知识图谱候选：从台账 diff 回放有效区间，读取带失效段，支持按故事时间点查询；不新增表。
- **X1.d** 对比运行器 `packages/st-compat/src/evalset/world-model-compare.ts` 与 CLI：每个候选复制数据库、固定轮数自动试玩、同一批记忆题与探针、与候选 ① 盲测，指标表统一为矛盾率、编造回忆率、盲测胜率与每轮成本，默认重复 3 次，支持断点续跑。
- **X1.e** 3 个对话、每种候选 3 次的实跑与判定（主要指标不劣于 ① 且盲测胜率明显高于 ① 才切换，否则保留 ①），结论写 ADR，未切换的候选留在开关后面。

## X1.c 设计要点
- `WorldModelReadOptions { atStoryTime?: string }` 是 `read(nodeId, options?)` 的第二个参数；不传时三个候选都返回当前视图。台账与 wiki 收到 `atStoryTime` 时由 `assertTimeQuerySupported` 直接抛错，不静默忽略。
- `temporal_graph` 的有效区间完全来自当前路径上的台账 diff：同一路径的每次 set 开启一版；之后的 set 或 delete 关闭该路径及其下层的活动版本（`isPathPrefix`），delete 记 `endReason: "deleted"`、set 记 `"superseded"`，保留最后一版的值与起止楼层。关闭后再次 set 会开启新的一版。
- 当前视图的 `state` 仍是台账快照，`sections` 只有一段「已失效事实」，每行是 `JSON(path) = JSON(value)（楼层 <start> → <end>；原因 已删除|被新值取代；来源 <source>；故事时间 <start> 至 <end>）`；`source` 为 `state:<n> 条 diff，已失效 <m> 条`。
- 时间点查询只考虑自身 `storyTime` 非空的版本；标签是不透明文字，时间轴按标签在当前路径上第一次出现的顺序建立；版本的有效终点取自身 `storyTime.end` 与结束事件时间（`endStoryTime.start ?? end`）的较早者。查询标签必须在该路径上出现过，否则抛错；同一路径多版命中时取较晚的一版，选中的版本按写入顺序用 `applyDiffEntriesTo` 累加成 `state`，`source` 为 `state:时序图谱 <n> 条事实，故事时间 <label>`。
- `createTemporalGraphWorldModel(...).versions(nodeId)` 返回全部版本（含仍成立的一版），`write` 直接委托台账适配器；工厂的 `temporal_graph` 分支返回该对象，`packKey` 自动为 `state:temporal_graph`。
- 时间轴没有外部时钟可依据，标签乱序时查询结果跟着乱序（ADR-0128 已记录）；评测需要更严格的时间轴时先补可比较的时间字段或解析器。

## X1.b 设计要点
- 迁移 v48 `world_wiki_revisions(id, story_id, entity_id, node_id, text, story_time_start, story_time_end, source, created_at)`：修改由触发器拒绝，删除只在楼层已不存在时放行（为将来整段故事清理留路）。`node_id` 既是写入楼层也是这一版的出处楼层；统一接口每次写入只带一个楼层，最早出处由当前路径上最早的一版给出。
- 档案实体 id 是台账 `character.<id>` 的人物 id。档案只能写给台账里已经存在的人物；同一批写入里先写人物字段再写档案也算已存在。人物字段必须逐项写（`character.<id>.<字段>`），整对象写入会被 `validateLedgerDiff` 拒绝。
- 档案路径固定为 `["profile", "<人物>"]`，`op` 只能是 `set`，`value` 是非空正文；其余路径交给 `validateLedgerDiff` 后写台账 diff。未知人物、空正文、删除档案在写入前抛错，错误信息带档案路径。
- 读取用递归 CTE 连接当前路径（与状态 diff、现场分析同口径），`sections` 每个有档案的人物一段：标题 `档案：<人物>`，正文是最新一版，末尾一行 `版本数：N；出处楼层：<nodeId>；最早出处：<nodeId>`；段落按人物 id 排序，同一输入渲染稳定。
- `source` 在 wiki 下为 `state:<n> 条 diff，档案 <m> 版`；`packKey` 仍为 `state:wiki`。
- 状态槽位 `createStateSlotProvider` 不需要改动：它只消费 `{state, sections, source}`，台账下 `sections` 为空。

## X1.a 设计要点
- `packages/core/src/world-model/types.ts`：`WORLD_MODEL_KINDS`、`isWorldModelKind`、`assertWorldModelKind`、`WorldModelReadOptions`、`WorldModelView {state, sections, source}`、`WorldModelWrite {path, op, value?, storyTime?, confidence?, reason?, source}`、`WorldModel {kind, read(nodeId, options?), write(nodeId, writes)}`。
- `factory.ts`：`createWorldModel(store, kind = "ledger")` 先校验种类，三个候选按种类返回，不回落到台账。
- `ledger.ts`：读取返回状态快照，`sections` 为空，`source` 为 `state:<n> 条 diff`；写入逐条 `validateLedgerDiff` 后一次 `appendStateDiffs`，未知路径的错误里带台账路径。写入接口供对比运行器把同一批事实灌进候选，结算器仍走自己的路径。
- 故事设置：`StorySettings.worldModel`，`StorySettingsUpdate.worldModel`，`STORY_SETTINGS_UPDATE_KEYS` 包含它；校验消息包含 `worldModel`，server 的 PATCH 按字段名回 400。
- 迁移 v47：`ALTER TABLE story_settings ADD COLUMN world_model TEXT NOT NULL DEFAULT 'ledger' CHECK (world_model IN ('ledger','wiki','temporal_graph'))`；`rowToStorySettings` 读取时校验；`getStorySettings` 未保存时返回默认值；更新 SQL 已包含该列。
- 状态槽位：`createStateSlotProvider(store, {worldModel})`；`packKey` 从 `state` 改为 `state:<kind>`，避免不同表示共用同一个上下文包指纹。台账下只有一条 `当前状态：` 系统消息，内容与 `JSON.stringify(state, null, 2)` 不变；`sections` 每段渲染成一条 `<title>：\n<text>` 系统消息。
- 设置传入点：`packages/server/src/runtime.ts`、`packages/st-compat/src/chat/cli.ts`、`chat/session.ts` 的 `CreateChatProvidersOptions`、`evalset/director-replay.ts`、`deep-eval-cli.ts`、`historical-replay-cli.ts`、`memory-eval.ts`、`playtest-cli.ts`；`st-bench/coexist.ts` 没有故事设置，使用默认台账。
- 测试：`packages/core/test/world-model.test.ts` 17 条（种类与默认值、台账读取与状态槽位同源、写入与非法路径、删除、三个候选创建、wiki 的版本与出处、分支隔离、空正文与未知人物、同批新建人物、wiki 槽位档案段、时序图谱的失效段与版本、按时间点查询、时序分支隔离、时序槽位失效段、台账与 wiki 拒绝时间查询、设置默认与读写、槽位选择）；`assistant-store.test.ts` 的 schema 版本期望改为 48；`story-settings.test.ts` 的默认设置包含 `ledger`；`web/test/settings-form.test.ts` 的 fixture 有 `worldModel`。

## H 应用内助手（已完成，H-T01 至 H-T09、H-T99）
- 助手会话独立于 `nodes`、`state_diffs`、`turn_runs`；消息与事件在助手表里，删除会话不触碰楼层、head 与状态 diff；助手运行不组装剧情上下文，正剧也不读助手消息。
- 三级权限：`read_only` 只执行读；`confirm` 把提案与外部影响写成待确认动作；`auto` 只有渠道可用，台账修改永远只生成变更卡，任何级别都不能自动批准。
- 工具白名单不含草稿、提交、导演手记、正文写入、台账直接写入与生图；七个技能已注册（`troubleshoot`、`guide`、`ledger_revision`、`strategy`、`research`、`card_workshop`、`setup_wizard`）。
- 迁移 v44 至 v46：会话与消息、待确认动作与变更卡来源 `assistant`、上下文压缩记录。压缩保留最近 10 条与待确认动作引用的消息；自动压缩在 server 消息接口里、`runAssistantTurn` 之前执行，直接调用运行时只按已有压缩过滤消息。
- web 抽屉的持久状态只有 localStorage 的活动会话 id；消息、事件与状态都以 server 为准，关闭抽屉后运行继续。
- 审阅面板与待确认数量同源：`refreshPendingActions` 同时读动作与变更卡；渠道字段只渲染白名单字段，不输出密钥或环境变量名。

## 当前状态
- 已完成：F0、M0–M3、D、M4-T00 至 M4-T06、R0、R1（含 R1-T99、R1-T99.a）、R3、O、R2、E、R4、R5、V-T01、M6-T00 至 M6-T05、R3b、P1、P2、P3、P4、C-T01 至 C-T05、H-T00 至 H-T09、H-T99、X1.a、X1.b、X1.c。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成（含一致性测试与共存评测）。
- 数据库 schema 版本 48。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`、`H.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0128 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染、覆盖率口径、应用内助手、世界模型接口、实体档案与时序图谱的决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 待处理（不阻塞）：清理 `C:\Users\theater\AppData\Local\Temp` 里累积的测试临时目录。
- HUMAN-17 待处理（不阻塞）：ST-Prompt-Template 上游许可证是 AGPL-3.0，提案写的是 MIT；本实现按文档独立实现、未复制源码。
- HUMAN-18 待处理（不阻塞）：酒馆助手（JS-Slash-Runner）上游许可证是 Aladdin Free Public License，提案写的是 MIT；本实现只记录公开类型定义里的函数名、按文档独立实现（ADR-0124）。

## 可重复命令
- 门禁：`pnpm check`。
- X1.c 目标测试：`pnpm exec vitest run packages/core/test/world-model.test.ts`。
- X1.b 目标测试：`pnpm exec vitest run packages/core/test/world-model.test.ts packages/core/test/assistant-store.test.ts`。
- X1.a 目标测试：`pnpm exec vitest run packages/core/test/world-model.test.ts packages/core/test/story-settings.test.ts packages/core/test/chat-providers.test.ts packages/web/test/settings-form.test.ts`。
- H-T99 真实渠道验收：`node .devloop/scratch/H-T99/live.mjs`（脚本读取 `.env`、`data/channels.yaml` 与 `docs/`，数据库写在 `.devloop/scratch/H-T99/live.db`；结果同时写 `.devloop/scratch/H-T99/live.json`）。脚本是一次性验收工具，不需要长期保留。
- H-T99 e2e：`pnpm --filter @dramaticer/server build && pnpm --filter @dramaticer/web build && pnpm --filter @dramaticer/web exec playwright test e2e/assistant.spec.ts`（desktop 与 mobile 各 5 条）。
- H-T09 目标测试：`pnpm exec vitest run packages/web/test/assistant-review.test.ts packages/web/test/assistant-api.test.ts`。
- H-T08 目标测试：`pnpm exec vitest run packages/core/test/assistant-context.test.ts packages/core/test/assistant-store.test.ts packages/server/test/assistant.test.ts packages/web/test/assistant-api.test.ts packages/web/test/assistant-stream.test.ts packages/web/test/assistant-context-usage.test.ts`。
- H-T07 目标测试：`pnpm exec vitest run packages/web/test/assistant-api.test.ts packages/web/test/assistant-stream.test.ts packages/web/test/assistant-conversation-list.test.ts packages/web/test/assistant-permissions.test.ts`。
- H-T06 目标测试：`pnpm exec vitest run packages/core/test/assistant-setup.test.ts packages/core/test/assistant-skills.test.ts packages/server/test/assistant-skills.test.ts packages/server/test/assistant.test.ts packages/server/test/config.test.ts`。
- H-T05 目标测试：`pnpm exec vitest run packages/core/test/assistant-proposals.test.ts packages/core/test/assistant-skills.test.ts packages/server/test/assistant-skills.test.ts`。
- H-T04 目标测试：`pnpm exec vitest run packages/core/test/assistant-skills.test.ts packages/server/test/assistant-skills.test.ts packages/server/test/config.test.ts`。
- H-T03 目标测试：`pnpm exec vitest run packages/core/test/assistant-actions.test.ts packages/core/test/assistant-runtime.test.ts packages/core/test/assistant-store.test.ts packages/server/test/assistant.test.ts packages/core/test/ledger-cards.test.ts`。
- H-T02 目标测试：`pnpm exec vitest run packages/core/test/assistant-runtime.test.ts packages/server/test/assistant.test.ts`。
- H-T01 目标测试：`pnpm exec vitest run packages/core/test/assistant-store.test.ts packages/server/test/assistant.test.ts packages/web/test/assistant-api.test.ts`。
- web 端到端用例用 `pnpm --filter @dramaticer/web exec playwright test <spec> --project=desktop`，e2e 不在 `pnpm check` 里。
- C-T05.f 目标测试：`pnpm exec vitest run packages/st-compat/test/st-helper-consistency.test.ts packages/st-compat/test/st-helper-coexist.test.ts packages/st-compat/test/st-mvu-coexist.test.ts packages/st-compat/test/st-ejs-coexist.test.ts packages/st-compat/test/st-bench-coexist.test.ts`。
- C-T05.e 目标测试：`pnpm exec vitest run packages/st-compat/test/st-helper-html.test.ts packages/st-compat/test/st-helper-host.test.ts packages/st-compat/test/st-helper-sandbox.test.ts packages/st-compat/test/st-helper-slash.test.ts packages/st-compat/test/st-helper-generation.test.ts packages/web/test/helper-sandbox.test.ts`（53 个）。
- 酒馆助手浏览器用例：`pnpm --filter @dramaticer/web exec playwright test e2e/helper-sandbox.spec.ts --project=desktop`（3 个）。
- 共存评测：`node packages/st-compat/dist/st-bench/cli.js coexist --config <配置.json> [--out <目录>]`（已注册插件：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host`）。
- 不变量检查：`node scripts/check-invariants.mjs`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 驱动组合生成：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js drive --sandbox eval-private/st-sandbox/st --batch <批次> --limit <数量> --port 8899`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
- 单独启动录制：`node packages/st-compat/dist/st-bench/cli.js record --dir eval-private/st-sandbox/runs/<批次> --port 8130`。
- 单独启动沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
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
- 助手搜索：标题使用 LIKE，消息正文在查询不少于三个字符时用 `assistant_message_text` 的 trigram，短于三个字符时退回 LIKE；命中片段用方括号标出。`assistant_message_text` 由消息表触发器同步，删除会话时先删消息再删会话，保证索引清理。
- `assistant_events` 与 `assistant_compactions` 的删除触发器只在会话仍存在时拒绝，删除会话的级联删除不受影响；事件与压缩记录的修改始终被拒绝。
- 助手接口的 `storyId` 不存在返回 404，字段非法返回 400 并在 `details.path` 指出字段；删除会话不触碰楼层、head 与状态 diff。
- 助手运行时把会话消息转成模型消息时，工具消息没有可回放的调用 id 与原生签名，统一转成 `system` 消息保留工具名与结果；不要伪造 `toolCalls` 回放，Gemini 一类渠道会因缺少签名拒绝请求。
- 助手运行事件名带前缀（`assistant.started`、`assistant.text.delta` 等），与剧情回合的 `text.delta`、`tool.call` 分开；两套 SSE 载荷形状不同，`parseNamedSseStream` 按传入的事件名白名单区分。压缩事件名是 `assistant.compaction`。
- 助手并发启动有两层保护：server 的 `AssistantRunCoordinator` 返回 409，store 的 `startAssistantConversationRun` 在同一事务里拒绝第二个 running。客户端断开只停止 SSE 写入，不中止运行。
- 助手工具的 `permission` 是助手自己的三级权限判定；传给深回合执行器时统一为 `read`，否则执行器会把 `propose` 与 `side_effect` 当成剧情写入语义处理。新增提案工具用 `defineAssistantTool` 包装，工具内部调用 `assistantActionGate` 与 `store.createAssistantAction`。
- `assistant_actions` 的待定唯一索引以规范化 JSON 载荷为键；同会话同种类同载荷复用已有待定动作。批准顺序是先校验、再调用领域写入、最后改状态，失败时动作保持 `pending`。
- 台账变更卡来源增加 `assistant` 后，`assistantConversationId` 只允许助手来源填写；批准仍走 `approveLedgerChangeCard`，事实来源为 `player`，任何权限级别都不能自动批准。
- 技能注册表以 `packages/core/src/assistant/skills.ts` 为唯一来源；新增技能在注册表里登记，server 端创建与 PATCH 会话都按注册表返回 400。
- 技能白名单里的工具名必须在本次运行实际注册：`docs_search`、提案工具与 `createAssistantSetupTools` 的工具由 server 以 `extraTools` 注入，未注入时带该名字的技能会让 `runAssistantTurn` 在切换运行状态前抛错。
- `AssistantDocsIndex.load` 每次 `startServer` 都会读取并切分文档（约 1.6 MB），server 测试的启动耗时会增加数百毫秒；不要在测试里传不存在的 `docsRoot`，除非就是要验证启动失败。
- 提案工具在 server 里对所有会话注入，靠白名单过滤；只读级别仍会收到工具定义，但执行被 `defineAssistantTool` 或提案工具自身拒绝并写 `permission.denied`。不要在 server 里按权限过滤工具名，否则 `runAssistantTurn` 会因白名单工具缺失抛错。
- 台账变更卡 id 包含当前 head：同一内容在 head 未变时复用同一张卡，head 变化后会生成新卡。已批准或已拒绝的同内容卡存在时不再新建，工具结果会写明状态。
- `summarize_recent` 只读现有压缩与摘要；新增摘要仍然走后台任务，不要在助手工具里调用模型生成摘要（I11、I13）。
- 联网搜索只由 `--assistant-web-search` 开启；HTTP 客户端 POST `{query, limit}`，接受结果数组或 `{results}`，每条必须有 title 与 url。测试只注入假客户端，不访问网络。
- 渠道读取不返回密钥值；返回的字段足以重建整段配置。`propose_channels_change` 四个段必须给全，批准时仍由 `readChannelsUpdate`、`applyChannelsUpdate` 与 `parseChannelsConfig` 校验并写文件。
- 抽屉的持久状态只有 localStorage 里的活动会话 id（`dramaticer.assistant.active.<storyId>`）；消息、状态与事件都以 server 为准，不要缓存正文。
- 重连轮询必须在改状态之前把会话详情与消息写入状态：`status` 变化会触发 effect 清理，之后再写消息会被 `cancelled` 挡住。
- 关闭抽屉的焦点恢复要等两帧；隐藏祖先元素后 Chromium 会把焦点退到 body。触发按钮用选择器 `.assistant-open-button` 查找，不能依赖只在聊天页存在的 ref。
- 压缩记录只追加；需要重新压缩只能新增一条，最新一条生效。不要修改旧记录或删除单条记录。
- 自动压缩在 server 的消息接口里执行，`runAssistantTurn` 自身不触发压缩；后台脚本或测试直接调用运行时只应按已有压缩过滤消息。
- 压缩失败的自动运行仍然返回模型回答；不要因为压缩失败把会话标成失败或丢弃消息。
- 待确认数量与待确认视图必须同源：`refreshPendingActions` 同时读动作与变更卡并把和写进 `AssistantSummary.pendingActions`；新增待确认来源时同步改这一处与面板过滤，不要另开一个计数。
- 审阅面板的渠道字段只能渲染白名单字段（模型别名与 id、密钥状态、岗位）；原始载荷不要直接 `JSON.stringify` 到界面，否则会泄露密钥值与环境变量名。
- e2e 的审阅种子按 Playwright 项目名分开（`e2e-assistant-review-mobile`、`e2e-assistant-review-desktop`），因为 desktop 与 mobile 共用同一个服务端，会依次修改同一份数据。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
- MVU 引擎的 `[值, 说明]` 判定与 MVU 一致：长度为 2 且第二个元素是字符串的普通数组也会被当成值加说明，测试与真实卡都要避开这种歧义；需要真正两个元素的列表时用三个元素或开启 `strictSet` 后显式写结构。
- 显示状态只在当前会话；需要跨进程显示时由台账快照重新渲染，不要把它写成楼层原文或台账事实。
- 共存适配器在 `apply` 之后按轮调用 `afterTurn`；插件写错直接让运行失败，不要吞掉错误。`st-mvu` 适配器要求卡里有 `[initvar]` 世界书或开场白 `<initvar>`，没有时它不改任何内容。
- 共存评测的关闭组：适配器提供 `baseline` 时用 `<runDir>/<pluginId>/off`；不提供时用 `<runDir>/baseline/off`。`afterTurn` 只在开启组执行。
- 共存盲测的平局不计入胜负；两份文本完全相同时 `judgePairwise` 不调用裁判、直接判平局。报告里的胜率要按非平局判定解释，全部平局写持平（ADR-0124）。
- `st-helper-host` 的共存批次不执行脚本：Node 里没有 iframe；开启组只做脚本库发现与状态栏渲染请求，两组提示词逐字节相同。脚本执行由沙箱单元测试与浏览器 e2e 覆盖，不要用这个批次代替脚本行为评测。
- EJS 模板里再写 `<%` 会被外层标签解析截断：内层模板通过变量或 `evalTemplate` 的第二参数传入，测试里用字符串拼接构造内层标签。
- `st-ejs` 的激活正则默认一次性生效（命中后停用），连续使用时显式传 `sticky: true`；注入标记与 `@INJECT` 必须独占一行才会被识别。
- `st-ejs` 的 `getwi` 在模板里需要 `await`；世界书、角色卡、预设与快捷回复数据由调用方注入，不要读 `eval-private/` 或 ST 安装目录。
- 沙箱里模板函数是同步的（远程调用会阻塞模板线程），函数参数与返回值必须能 JSON 化；`define` 只在一次执行内有效，`include` 不可用。流水线接入后，同一回合内的多次模板执行共用一个沙箱 worker，`define` 在回合内跨模板有效，换回合或沙箱超时重建后失效。
- 回合预算只从调用方传进来：槽位提供者用 `request.budget`，直接调用运行时用 `render(text, { budget })`。没有预算时不限时（沙箱自己的默认 5 秒仍生效）；预算模式必须用沙箱执行器。
- `StEjsVariableStore` 接入 `backend` 后，不指定作用域的写进入 `initial`（台账 `mvu`），global/message/local 仍是插件内存；接入台账的消费方要意识到写入会立即 `commit` 成当前楼层的 state diff。
- 模板生成只登记请求：`generate` 返回 id 不返回正文，宿主用 `createStEjsBackgroundGenerationRunner` 接后台客户端并在间隙 `drain`；结果只在内存里，进程结束就消失，需要跨进程时由调用方另行保存。
- `st-helper-host` 的宿主会话不做执行；脚本正文只在 `scripts` 里返回。`character` 作用域依赖调用方传入带台账后端的 `StEjsVariableStore`，否则写入只留在内存。改消息会切换 head，较早消息的修改按分支切换处理。
- `st-helper-host` 的沙箱 API 全部异步：`postMessage` 不能同步取返回值，脚本必须 `await`。事件监听用整数 token，`eventClearEvent`/`eventClearAll` 会同时清掉 iframe 与宿主两边的监听器。超时由宿主 `sweepTimeouts()` 驱动，调用方负责移除 iframe；超时执行注册的监听器会被清掉。
- STscript：`triggerSlash` 只执行 `ST_HELPER_SLASH_COMMANDS` 里的命令，未知命令按名字失败。变量命令默认作用域与上游一致（`setvar` 是 chat/local），`messages` 的单个数字是消息下标，不是“最后 N 条”。`addswipe` 默认不切换 head，`swipe` 在兄弟楼层之间循环。
- `/gen` 与 `/genraw` 只登记后台请求并返回请求 id，不返回正文，回合内不等待。正文用 `/genresult <id>` 读取，未完成或失败是空串；状态用 `session.generation.get(id)`。脚本请求与 EJS 模板请求共用 `StEjsGenerationScheduler` 的卡级上限，队列 `drain` 只执行脚本登记的请求。
- HTML 状态栏与开场页的渲染结果只在插件显示状态（`PluginDisplayState`，插件 `st-helper-host`，键 `statusBar`/`openingPage`）；要把它们接入界面时读 `readStHelperHtmlPage`，不要写回楼层原文或台账。沙箱里的页面脚本与卡片脚本共享同一份权限白名单，未声明的 API 调用会被拒绝并记录。
- 状态栏自动重渲染由变量写入触发，同一页面进行中的渲染会合并后续写入；连续自动刷新默认上限 8 次，超出后需要显式调用 `renderStatusBar` 才会恢复。开场页不参与自动重渲染。
- 酒馆助手的 API 覆盖率快照以本机 JS-Slash-Runner 4.8.10 为准；升级上游版本时要重新生成 `coverage.ts` 的名字清单并同步报告与测试断言。
- 助手任务不要复用 `turn_runs`：助手没有楼层，运行状态与事件在 `assistant_conversations`、`assistant_events` 里；批准助手动作时调用现有写入函数，不要新写一套数据库更新。
- 助手接口的请求与响应类型放在 `packages/protocol`，不要从 web 直接 import `@dramaticer/core` 的运行时；助手运行与剧情回合是两条路径，测试要断言正剧上下文里没有助手消息。
