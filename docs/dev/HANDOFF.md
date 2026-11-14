# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-14 会话 373：X2.a 先按 T00 规则把 X2 细化成 X2.a 至 X2.d，然后实现统一导演评估接口与故事设置开关。新增 `packages/core/src/director/organization.ts`（`DirectorOrganizationKind` 取 `mechanisms`、`bits`，`DirectorEngine.evaluate`，`createDirectorEngine`）；现有机制序列包成 `mechanisms` 引擎，行为与 `evaluateDirector` 一致；`bits` 在 X2.b 之前由工厂直接失败。导演槽位改为持有引擎，`packKey` 带组织方式与机制名，单轮强度覆盖复用同一引擎。故事设置新增 `directorOrganization`（迁移 v49，默认 `mechanisms`），server、`dramaticer chat`、回放与评测入口传入设置。ADR-0131；新增 6 个测试；门禁通过（252 个测试文件、2,195 个测试、5 个跳过）。

## 下一步（会话 374 先做）
1. 按 TASKS 从上往下，下一个可做任务是 **X2.b 剧情小品引擎**。它在 `director/organization.ts` 的 `bits` 分支里实现，必须替换当前的“尚未实现”抛错。
2. X2.b 的对象设计：小品只有一种对象，字段为 id、条件（自然语言或台账查询）、指令、优先级、冷却楼层、顺序约束、可否重复与兜底；卡作者在 `extensions.dramaticer` 里附带自己的小品。条件解析与校验放在 `director/card-extension.ts` 的扩展解析里，未知字段、重复 id、非法条件抛错并指出路径。
3. 自然语言条件在间隙里一次调用批量判断，结果按楼层缓存；程序判定台账查询。冷却、顺序、可否重复与兜底由程序执行；同一层只给最高优先级的一条建议，决策记录写清命中与跳过原因（I9、I11、I13）。
4. X2.c 运行器与 X2.d 判定在 X2.b 之后：条件判断准确率必须用固定样本逐条核对，不能只靠裁判自评；盲测复用 R2 的 `runPreferenceSample` 与 `summarizePreferenceComparisons`。

## 当前状态
- 已完成：F0、M0–M3、D、M4-T00 至 M4-T06、R0、R1（含 R1-T99、R1-T99.a）、R3、O、R2、E、R4、R5、V-T01、M6-T00 至 M6-T05、R3b、P1–P4、C-T01 至 C-T05、H-T00 至 H-T99、X1.a 至 X1.e、X2.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成（含一致性测试与共存评测）。
- 数据库 schema 版本 49。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`、`H.md`、`X1.md`。
- 世界模型：默认 `ledger`；`wiki` 与 `temporal_graph` 已经可用，由故事设置 `worldModel` 选择，只有 `temporal_graph` 支持 `atStoryTime`。
- 导演组织方式：默认 `mechanisms`（现有机制序列）；`bits` 已登记在设置与工厂里，X2.b 之前调用会直接失败。
- X1 的原始数据在 `eval-private/reports/world-model-compare/`（含故事标题与回复，不进入仓库）；长任务脚本与 sidecar 在 `.devloop/scratch/X1.e/`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`。
- ADR-0088 至 ADR-0131 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染、覆盖率口径、应用内助手、世界模型接口、实体档案、时序图谱、对比运行器、X1 判定与导演组织方式的决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16、HUMAN-17、HUMAN-18 待处理（不阻塞）：临时目录清理、ST-Prompt-Template 与酒馆助手上游许可证确认。

## 可重复命令
- 门禁：`pnpm check`。
- X2.a 目标测试：`pnpm exec vitest run packages/core/test/director-organization.test.ts packages/core/test/story-settings.test.ts packages/core/test/lore.test.ts packages/core/test/director.test.ts packages/core/test/assistant-store.test.ts packages/web/test/settings-form.test.ts`。
- X1 目标测试：`pnpm exec vitest run packages/st-compat/test/world-model-compare.test.ts`。
- X1 长任务（重跑会复用 sidecar）：`node .devloop/scratch/X1.e/run-compare.mjs`。
- X1 单个故事：`node packages/st-compat/dist/evalset/world-model-compare-cli.js --db eval-private/world-model-compare/source/<slug>.db --story <故事> --messages .devloop/scratch/X1.e/inputs/<slug>.messages.json --questions .devloop/scratch/X1.e/inputs/<slug>.questions.jsonl --rounds 8 --repeat 3 --seed 1 --dir .devloop/scratch/X1.e/runs/<slug>`。
- X1.c 目标测试：`pnpm exec vitest run packages/core/test/world-model.test.ts`。
- X1.b 目标测试：`pnpm exec vitest run packages/core/test/world-model.test.ts packages/core/test/assistant-store.test.ts`。
- X1.a 目标测试：`pnpm exec vitest run packages/core/test/world-model.test.ts packages/core/test/story-settings.test.ts packages/core/test/chat-providers.test.ts packages/web/test/settings-form.test.ts`。
- H-T99 真实渠道验收：`node .devloop/scratch/H-T99/live.mjs`。
- 不变量检查：`node scripts/check-invariants.mjs`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
- 不变量：I1–I18 的定义见 `AGENTS.md`；世界模型与导演组织方式实验不改变 I5、I6、I9、I11、I12、I15。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。X1 的 JSON 含回复与答案，只能放在私有目录。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁连跑或与大量临时目录写入同时进行时，Windows 的系统扫描会拖慢文件与 SQLite 操作，出现过后台 worker 激活超时与 `gap-pass-compare` 的 30 秒用例超时；这些用例单独运行都通过。门禁失败先看失败是否只在整轮并行时出现，不要连续并发跑多轮整仓测试；`gap-pass-compare` 的 3 个用例上限已放宽到 180 秒。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。上下文摘要按结构化请求处理，也使用 `NO_CONTINUATION`。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以；助手类型从 `@dramaticer/protocol` 取。
- 世界模型只用故事设置 `worldModel` 选择；新增调用方传 `settings.worldModel`，不要自己判断种类或回落到台账。状态槽位的 `packKey` 必须带种类（`state:<kind>`），否则不同表示会共用上下文包指纹。
- 导演组织方式只用故事设置 `directorOrganization` 选择；新增调用方传 `settings.directorOrganization`。导演槽位持有 `DirectorEngine`，`packKey` 带组织方式与机制名；单轮强度覆盖用 `engine` 重建槽位，不要重新按种类构造，否则会丢掉引擎里的缓存状态。
- `createDirectorEngine("bits")` 在 X2.b 实现前必须继续抛错并指出任务，不要改成回落到 `mechanisms`。
- `DirectorEngine.evaluate` 负责写本楼层的决策记录；导演关闭时返回 null 且不写记录。`mechanisms` 引擎的决策记录仍由 `evaluateDirector` 生成。
- `WorldModel.read` 的 `atStoryTime` 只有 `temporal_graph` 支持；台账与 wiki 会直接抛错。时间点标签必须是在当前路径上出现过的文字，顺序按首次出现建立（ADR-0128）；评测探针不要假设它等价于真实时间轴。
- 时序图谱的失效段只在当前视图的 `sections` 里；时间点查询的 `state` 由命中的版本累加，`sections` 为空。`versions(nodeId)` 是调试与评测入口，不在状态槽位里使用。
- 实体档案（`wiki`）的写入路径是 `["profile", "<人物>"]`，其余路径按台账 diff 校验；档案实体必须是台账 `character` 里的人物，人物字段逐项写，整对象写人物会被 `validateLedgerDiff` 拒绝。
- `world_wiki_revisions` 只追加：没有更新与删除接口，修改由触发器拒绝；读取按当前路径的递归 CTE，分支切换不跨分支。
- `WorldModel.write` 先逐条 `validateLedgerDiff` 再写，供对比运行器使用；剧情结算仍走 `applySettlementProposals`，不要用这个接口绕过结算器（I12）。
- X1.d 的源数据库只读打开一次用于挑探针，随后关闭；所有写入都在复制出来的数据库里。重跑复用 `runs/<候选>/<序号>.json`，修改玩家消息或种子会导致校验失败并提示删除 sidecar。
- X1.d 的盲测上下文只用玩家消息前缀，不包含候选各自的正文；两轮文本完全相同时裁判直接判平局，不调用模型。
- X1.d 的每轮成本只统计写作客户端的非缓存请求与 Trace 耗时；记忆题、探针与盲测裁判的请求单独发生，不计入每轮成本。
- X1 的源数据库用 ASCII 文件名：全角文件名在 Windows 的 Node `fs.rmSync` 上会直接以 `0xC0000409` 终止进程。
- X1 的矛盾率分母是召回探针加记忆题里被判为一致或矛盾的记录；不同候选的可判定记录数不同（97、77、81），比较时同时看样本数。
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
