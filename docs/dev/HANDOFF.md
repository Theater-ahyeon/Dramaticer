# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 349：完成 C-T04.d（EJS 一致性测试与共存评测）。
- 新增 `packages/st-compat/test/st-ejs-consistency.test.ts` 18 个测试：按世界书、预设、角色卡、对话片段四类用例表逐条记录上游文档行为与期望输出；覆盖 `getwi` 递归、关键词与常驻激活、`[GENERATE:*]`、`@@if`、`getpreset`/`getqr`、`getchar`/`getCharData`、楼层读取、变量函数、`generate` 队列与激活正则。
- 内容范围用例：预设静态段、`history` 与 `lore` 执行 EJS；写作契约与 `state` 等 harness 槽位逐字节不变；`setvar` 经待结算视图与结算器落成 `mvu` 事实，楼层原文不变。
- `CoexistPluginAdapter` 新增可选 `baseline`：关闭组可以执行“同一份 ST 内容、只关掉本插件”；不提供时仍用默认模板与槽位，st-content、st-mvu 与 st-bench 的既有目录结构不变。
- `buildStContentCoexistResult(input, { ejs })` 拆出 EJS 开关；`st-content` 适配器行为不变。新增 `st-bench/st-ejs-plugin.ts`，`ST_BENCH_COEXIST_PLUGINS` 注册 `st-ejs`；关闭组是 `ejs: false`，开启组是 `ejs: true`。
- 修复第一轮没有楼层时 `prepareTurn` 直接跳过的问题：现在用 `nodeId: null` 渲染预设静态段，变量只留在运行时内存；有楼层后按台账 `mvu` 子树读写。
- 合成批次（1 张卡、5 轮、假客户端）：矛盾率 0%/0%（8/8）、编造回忆率 0%/0%（4/4，样本不足）、盲测胜率 100%（10/10）、首字 P90 1/0 毫秒（5/5），无变差项。`docs/dev/reports/C-T04.md` 逐条核对 C-T04 总验收；ADR-0118。门禁通过（226 个测试文件、2017 个测试、5 个跳过）。

## 下一步（会话 350 先做）
1. **C-T05 P-D `st-helper-host` 酒馆助手宿主**：依赖 C-T04，现在可以做。先搭一致性测试并让它变红，再实现酒馆助手脚本、角色卡内脚本、HTML 状态栏与开场页；运行在沙箱 iframe 里，提供变量读写、事件监听、`triggerSlash`/STscript、生成、读消息、改消息。修改消息一律映射成新楼层或新 swipe；脚本发起的生成按卡限流、走后台渠道并单独计数；变量写入经过结算器；写 `docs/dev/reports/C-T05.md` 并逐条核对验收。这明显超过一个会话，按 AGENTS.md 的上下文预算先拆成 `C-T05.a`、`.b`……再只做第一个。
2. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）、X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T04.d 代码事实
- 一致性用例表：`test/st-ejs-consistency.test.ts`，`CASES` 数组每项有 `name`、`source`、`doc`、`run`、`expected`；新增用例按同一结构追加。内容范围用例单独两个 `it`。
- 共存适配器：`st-bench/st-ejs-plugin.ts` 导出 `ST_EJS_PLUGIN_ID = "st-ejs"` 与 `ST_EJS_COEXIST_PLUGIN`；`apply` → `buildStContentCoexistResult(input, { ejs: true })`，`baseline` → `ejs: false`。
- `CoexistPluginAdapter.baseline` 只在关闭组调用；开启组仍然调用 `apply` 与 `afterTurn`。关闭组目录：有 `baseline` 时是 `<runDir>/<pluginId>/off`，没有时仍是 `<runDir>/baseline/off`。
- `buildStContentCoexistResult` 的返回在 `ejs: false` 时只有 `template`、`providers`、`notes`；`ejs: true` 时额外有 `prepareTurn`、`dispose` 与 EJS 模板段计数备注。
- 首轮 `prepareTurn` 以 `nodeId: null` 渲染；此时 `StEjsMvuVariableBackend` 不创建，`setvar` 只改运行时变量。需要写台账的模板要处理 `getvar` 返回 `undefined` 的情况（示例用 `Number(getvar('stat_data.hp') ?? 0)`）。
- 合成批次数据库：`<runDir>/st-ejs/{off,on}/<cardId>.db`；开启组最后一轮玩家楼层的 `mvu.stat_data.hp` 等于已完成轮数（首轮不写台账）。
- 报告只写指标、样本量与插件备注；备注里不出现模板正文。`docs/dev/reports/C-T04.md` 不写私有数据。

## C-T04.c.d 代码事实
- 调度器入口：`new StEjsGenerationScheduler({ run, maxPendingPerCard?, now? })`。`run` 是 `(input) => Promise<string>`；`submit({storyId, cardId, nodeId, prompt, systemPrompt?, maxTokens?})` 返回 `st-ejs-gen-<序号>`；`drain({cardId?, signal?})` 返回 `{runs, counts}`。
- `runs` 每条包含 `id/cardId/status("done"|"failed")/text/error/durationMs`；`counts` 是全量计数，按 `cardId` 过滤用 `getCounts(cardId)`。`get(id)` 读任务快照，`getGenerated(id)` 只在 done 时返回正文。
- 模板函数名是 `generate` 与 `getGenerated`；选项的键是 `system`（映射到 `systemPrompt`）与 `maxTokens`。函数返回 id 字符串，模板可以保存 id 并在之后的一轮读取结果。
- 流水线绑定：`createStEjsContentPipeline({ ..., generation, cardId })`；同一个流水线的回合运行时共享同一个调度器，结果跨回合可读。调度器由宿主创建与持有，`drain` 由宿主在间隙调用。
- 宿主接线：`createStEjsBackgroundGenerationRunner({ client: runtime.backgroundClient, model? })`；不要传正文客户端。
- 失败语义：模板参数错误与没有队列是回合内错误；`drain` 里的模型失败只写任务状态，不影响回合。请求没有持久化。

## C-T04.c.c 代码事实
- 流水线入口：`createStEjsContentPipeline({ store, storyId, card, preset, worlds?, tokenBudget?, estimateTokens?, generation?, cardId? })`。`beginTurn(nodeId)` 返回活动回合；同一楼层重复调用复用；换楼层先结束上一回合。`dispose()` 结束时收回 global 并释放沙箱。
- `renderTemplate(template, { nodeId, budget? })`：只处理 `kind === "static"` 且 id 不是 `WRITING_CONTRACT_SEGMENT_ID`、正文含 `<%` 或 `<#escape-ejs>` 的段。`wrapProviders(providers)` 返回新的 providers 映射，`history`/`lore` 被包装，其余槽位保持同一对象。
- 槽位模板执行使用 `ContextSlotRequest.budget`（子预算先于钩子截止）；预设静态段在 `prepareTurn` 里使用 `createStEjsTurnBudget(DEFAULT_TURN_HOOK_BUDGET_MS)` 的独立预算。
- 活动回合内的运行时与沙箱被所有模板共用；`#render` 用 `turn.tail` 串行化顶层渲染。嵌套 `getwi` 走运行时自己的预算链，不经过这条队列，因此不会死锁。
- 台账锚点：`beginTurn` 的 `nodeId`。评测里是每轮追加玩家楼层之前的 head；写入挂在该楼层，读取到玩家楼层时仍能看到。
- 后端写：`setvar('stat_data.hp', 3)` → `mvu.stat_data.hp`；`scope: 'initial'` 与 `[InitialVariables]` 同样写台账；`setGlobalVar`/`setMessageVar`/`setLocalVar` 不写台账。`patchVariables` 的默认写回也随后端写到台账。
- 结算器拒绝（例如空路径段）会让模板渲染直接抛错，回合失败，不静默丢弃。
- `CoexistPrepareTurnInput` 提供 `store/storyId/card/round/template/providers`；返回 `template/providers/notes`。适配器返回的 `dispose` 在 `runVariant` 的 finally 中调用。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a 至 C-T03.d、C-T04.a、C-T04.b.a、C-T04.b.b、C-T04.c.a、C-T04.c.b、C-T04.c.c、C-T04.c.d、C-T04.d。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs` 的内容映射、模板引擎、装饰器/注入/激活正则、世界书与数据函数、沙箱执行、回合内时间预算、流水线接入、模板生成、一致性套件与共存评测全部完成；`st-helper-host`（C-T05）待做。
- 数据库 schema 版本 43；本轮没有改 schema。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0118 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成与一致性评测决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 待处理（不阻塞）：清理 `C:\Users\theater\AppData\Local\Temp` 里累积的测试临时目录。
- HUMAN-17 待处理（不阻塞）：ST-Prompt-Template 上游许可证是 AGPL-3.0，提案写的是 MIT；本实现按文档独立实现、未复制源码。

## 可重复命令
- 门禁：`pnpm check`。
- C-T04.d 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-consistency.test.ts packages/st-compat/test/st-ejs-coexist.test.ts`（19 个）。
- EJS 全部测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-template.test.ts packages/st-compat/test/st-ejs-variables.test.ts packages/st-compat/test/st-ejs-decorators.test.ts packages/st-compat/test/st-ejs-injections.test.ts packages/st-compat/test/st-ejs-regex.test.ts packages/st-compat/test/st-ejs-world-info.test.ts packages/st-compat/test/st-ejs-data.test.ts packages/st-compat/test/st-ejs-json.test.ts packages/st-compat/test/st-ejs-sandbox.test.ts packages/st-compat/test/st-ejs-budget.test.ts packages/st-compat/test/st-content-ejs-pipeline.test.ts packages/st-compat/test/st-ejs-generation.test.ts packages/st-compat/test/st-ejs-consistency.test.ts packages/st-compat/test/st-ejs-coexist.test.ts`（131 个）。
- 共存评测：`pnpm exec vitest run packages/st-compat/test/st-content-coexist.test.ts packages/st-compat/test/st-bench-coexist.test.ts packages/st-compat/test/st-mvu-coexist.test.ts packages/st-compat/test/st-ejs-coexist.test.ts`。
- C-T04.c.d 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-generation.test.ts`（9 个）。
- C-T04.c.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-sandbox.test.ts`（10 个）。
- C-T04.b.b 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-world-info.test.ts packages/st-compat/test/st-ejs-data.test.ts packages/st-compat/test/st-ejs-json.test.ts`（24 个）。
- C-T04.b.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-decorators.test.ts packages/st-compat/test/st-ejs-injections.test.ts packages/st-compat/test/st-ejs-regex.test.ts`（31 个）。
- C-T04.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-template.test.ts packages/st-compat/test/st-ejs-variables.test.ts`（26 个）。
- C-T03.d 目标测试：`pnpm exec vitest run packages/st-compat/test/st-mvu-consistency.test.ts packages/st-compat/test/st-mvu-coexist.test.ts`（8 个）。
- 全部 MVU 测试：`pnpm exec vitest run packages/st-compat/test/st-mvu.test.ts packages/st-compat/test/st-mvu-ledger.test.ts packages/st-compat/test/st-mvu-message.test.ts packages/st-compat/test/st-mvu-consistency.test.ts packages/st-compat/test/st-mvu-coexist.test.ts`（34 个）。
- 预设报告：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js preset --preset <预设.json> --card <卡> [--out <报告.md>]`。
- 共存评测：`node packages/st-compat/dist/st-bench/cli.js coexist --config <配置.json> [--out <目录>]`（已注册插件：`st-content`、`st-mvu`、`st-ejs`）。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 驱动组合生成：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js drive --sandbox eval-private/st-sandbox/st --batch <批次> --limit <数量> --port 8899`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
- 单独启动录制：`node packages/st-compat/dist/st-bench/cli.js record --dir eval-private/st-sandbox/runs/<批次> --port 8130`。
- 单独启动沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899`。
- 不变量检查：`node scripts/check-invariants.mjs`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁连跑或与大量临时目录写入同时进行时，Windows 的系统扫描会拖慢文件与 SQLite 操作，出现过后台 worker 激活超时与 `gap-pass-compare` 的 30 秒用例超时；这些用例单独运行都通过。门禁失败先看失败是否只在整轮并行时出现，不要连续并发跑多轮整仓测试；`gap-pass-compare` 的 3 个用例上限已放宽到 180 秒。
- 回合预算的截止与子任务截止不能重叠：`remainingMs()` 已扣除 50 毫秒收尾预留，子任务用 `remainingMs()` 作为自己的上限才能先于外层截止结束。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
- MVU 引擎的 `[值, 说明]` 判定与 MVU 一致：长度为 2 且第二个元素是字符串的普通数组也会被当成值加说明，测试与真实卡都要避开这种歧义；需要真正两个元素的列表时用三个元素或开启 `strictSet` 后显式写结构。
- 显示状态只在当前会话；需要跨进程显示时由台账快照重新渲染，不要把它写成楼层原文或台账事实。
- 共存适配器在 `apply` 之后按轮调用 `afterTurn`；插件写错直接让运行失败，不要吞掉错误。`st-mvu` 适配器要求卡里有 `[initvar]` 世界书或开场白 `<initvar>`，没有时它不改任何内容。
- 共存评测的关闭组：适配器提供 `baseline` 时用 `<runDir>/<pluginId>/off`；不提供时用 `<runDir>/baseline/off`。`afterTurn` 只在开启组执行。
- EJS 模板里再写 `<%` 会被外层标签解析截断：内层模板通过变量或 `evalTemplate` 的第二参数传入，测试里用字符串拼接构造内层标签。
- `st-ejs` 的激活正则默认一次性生效（命中后停用），连续使用时显式传 `sticky: true`；注入标记与 `@INJECT` 必须独占一行才会被识别。
- `st-ejs` 的 `getwi` 在模板里需要 `await`；世界书、角色卡、预设与快捷回复数据由调用方注入，不要读 `eval-private/` 或 ST 安装目录。
- 沙箱里模板函数是同步的（远程调用会阻塞模板线程），函数参数与返回值必须能 JSON 化；`define` 只在一次执行内有效，`include` 不可用。流水线接入后，同一回合内的多次模板执行共用一个沙箱 worker，`define` 在回合内跨模板有效，换回合或沙箱超时重建后失效。
- 回合预算只从调用方传进来：槽位提供者用 `request.budget`，直接调用运行时用 `render(text, { budget })`。没有预算时不限时（沙箱自己的默认 5 秒仍生效）；预算模式必须用沙箱执行器。
- `StEjsVariableStore` 接入 `backend` 后，不指定作用域的写落在 `initial`（台账 `mvu`），global/message/local 仍是插件内存；接入台账的消费方要意识到写入会立即 `commit` 成当前楼层的 state diff。
- 模板生成只登记请求：`generate` 返回 id 不返回正文，宿主用 `createStEjsBackgroundGenerationRunner` 接后台客户端并在间隙 `drain`；结果只在内存里，进程结束就消失，需要跨进程时由调用方另行保存。
- 流水线第一轮没有楼层时用 `nodeId: null` 渲染预设静态段；`getvar` 读不到初始变量，模板要处理 `undefined`（例如 `Number(getvar(...) ?? 0)`）。
