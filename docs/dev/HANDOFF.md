# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 344：C-T04.c.a 完成，门禁通过（221 个测试文件、1971 个测试、5 个跳过）。
- 实现：
  - `packages/st-compat/src/st-ejs/sandbox.ts`：`StEjsSandbox` 实现 `StEjsTemplateExecutor`。worker 由内联源码启动（`eval: true`、空 `execArgv`），每次执行在 worker 里新建一个 `node:vm` 上下文；EJS 在 worker 里用 `ejs.compile({client: true, compileDebug: true, async: true})` 生成函数源码，再在上下文里用间接 `eval` 求值。模板因此拿不到 `process`、`require`、`Buffer`、`fetch`，动态 `import` 以 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` 失败，`Function` 构造的代码也只跑在上下文里。
  - 主线程只传模板文本、变量快照、允许的函数清单与格式化方式；上下文里的函数由 bootstrap 按清单定义，调用时把 `(名字, 参数 JSON)` 发给主线程，主线程在运行时函数表里执行后写 `SharedArrayBuffer` 并 `Atomics.notify`，模板线程 `Atomics.wait` 同步等待，所以 `getvar`/`setvar`/`getwi` 在模板里仍是同步调用。`getwi` 的嵌套渲染由主线程再申请一个新 worker。
  - 编解码 `encodeSandboxValue`/`decodeSandboxValue`：`undefined` 与正则换成带标记对象，函数、bigint、循环引用直接抛错。`print`、`define`、`evalTemplate` 在上下文里实现；`define` 的作用域是一次执行（含它的 `evalTemplate`），不跨多次 `render`。
  - 默认 5 秒预算（`budgetMs` 可配）：超时终止 worker 并抛 `StEjsSandboxTimeoutError`（来源、耗时、预算、调用的函数）；`run()` 把超时作为 `output: null`、`outcome: "timeout"` 的执行记录返回。超时 worker 不进空闲池，下一次执行重新启动。空闲 worker 最多 2 个。
  - `StEjsRuntime` 增加 `executor` 选项、`setExecutor`、`listSandboxFunctions`、`invokeSandboxFunction`、`formatEscapedValue`，`#buildLocals` 拆出 `#functionTable`；`#render` 在沙箱模式下只做 `prepareTemplate`（`<#escape-ejs>` 与 HTML 转义还原）再交给执行器，`<%=` 的自定义格式化经 `__escape` 远程调用。
- 测试：新增 `st-ejs-sandbox.test.ts` 10 个（变量写入、`print`/`define`/`evalTemplate`、格式化远程调用、逃逸检查含 `node:fs` 与 `node:net` 的 import、允许清单、超时后继续执行、超时错误带来源、世界书条目嵌套渲染、执行记录的函数与耗时、模板错误带来源）。ADR-0114。

## 下一步（会话 345 先做）
1. **C-T04.c.b 回合内时间预算与 Trace**：依赖 C-T04.c.a，现在可以做。把沙箱执行记录接到 `TurnHookTraceEntry`（扩展点、插件、来源、耗时、outcome、跳过原因，函数列表一起写），超时跳过该条模板并让回合继续；`dramaticer explain` 输出里能读到。注意 `runTurnHook` 的返回结构只有 `value`/`trace`，需要在不破坏现有调用方的前提下扩展 `TurnHookTraceEntry` 或新增 EJS 专用字段。
2. 然后 C-T04.c.c（st-content 流水线接入与变量视图；同时决定沙箱实例的生命周期，`define` 的跨模板作用域在这里定）、C-T04.c.d（模板发起的生成，后台任务与卡级限流）。
3. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）、X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T04.c.a 代码事实
- 沙箱入口：`createStEjsSandbox({ runtime, budgetMs?, allowedFunctions?, responseBytes?, maxIdleWorkers? })`；`execute(execution)` 抛错，`run(execution)` 返回 `{ output, trace }`，超时 `output` 为 null。`execution` 是 `{ template, source, escape: "string" | "remote" }`，`template` 已经做过转义处理（直接调用 `execute` 时由调用方负责）。
- 启用沙箱的写法：`const sandbox = createStEjsSandbox({ runtime }); runtime.setExecutor(sandbox);`。构造校验允许清单里每个名字都出现在 `runtime.listSandboxFunctions()` 里，未知名字直接抛错。
- 远程调用只支持可 JSON 化的值；`activateRegex` 的函数替换参数、`define` 的函数值只在沙箱内部有效，跨进程的调用参数里出现函数会抛 `StEjsVariableError`。
- 每次执行使用新上下文，变量来自 `runtime.variables.variables` 的快照；每次远程调用回包里带新的合并视图，模板里写后立刻读到。`define` 的名字只在本次执行（含 `evalTemplate`）有效。
- `evalTemplate` 的新模板由 worker 编译、在同一个上下文里执行，不再回到主线程；`include` 在沙箱里直接抛错。
- 模板错误统一包装成 `StEjsTemplateError`，来源是 `execution.source`；EJS 的行号仍在错误消息里（`readErrorLine` 对 ejs 错误一直取不到 `line`）。
- 超时只由主线程计时；嵌套渲染各自计时，总的回合预算留给 C-T04.c.b。
- 空闲 worker 复用同一个进程，但每次执行新建上下文；不要用空闲池承载跨故事的状态。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a 至 C-T03.d、C-T04.a、C-T04.b.a、C-T04.b.b、C-T04.c.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs` 的模板引擎、装饰器/注入/激活正则、世界书与数据函数、沙箱执行完成；`st-ejs` 的 Trace 接入（C-T04.c.b）、流水线接入（c.c）、生成（c.d）与评测（C-T04.d）待做；`st-helper-host`（C-T05）待做。
- 数据库 schema 版本 43；本轮没有改 schema。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0114 记录插件、沙箱、比对、兼容内容映射、EJS 与沙箱执行决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 待处理（不阻塞）：清理 `C:\Users\theater\AppData\Local\Temp` 里累积的测试临时目录。
- HUMAN-17 待处理（不阻塞）：ST-Prompt-Template 上游许可证是 AGPL-3.0，提案写的是 MIT；本实现按文档独立实现、未复制源码。

## 可重复命令
- 门禁：`pnpm check`。
- C-T04.c.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-sandbox.test.ts`（10 个）。
- 全部 EJS 测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-template.test.ts packages/st-compat/test/st-ejs-variables.test.ts packages/st-compat/test/st-ejs-decorators.test.ts packages/st-compat/test/st-ejs-injections.test.ts packages/st-compat/test/st-ejs-regex.test.ts packages/st-compat/test/st-ejs-world-info.test.ts packages/st-compat/test/st-ejs-data.test.ts packages/st-compat/test/st-ejs-json.test.ts packages/st-compat/test/st-ejs-sandbox.test.ts`（91 个）。
- C-T04.b.b 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-world-info.test.ts packages/st-compat/test/st-ejs-data.test.ts packages/st-compat/test/st-ejs-json.test.ts`（24 个）。
- C-T04.b.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-decorators.test.ts packages/st-compat/test/st-ejs-injections.test.ts packages/st-compat/test/st-ejs-regex.test.ts`（31 个）。
- C-T04.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-template.test.ts packages/st-compat/test/st-ejs-variables.test.ts`（26 个）。
- C-T03.d 目标测试：`pnpm exec vitest run packages/st-compat/test/st-mvu-consistency.test.ts packages/st-compat/test/st-mvu-coexist.test.ts`（8 个）。
- 全部 MVU 测试：`pnpm exec vitest run packages/st-compat/test/st-mvu.test.ts packages/st-compat/test/st-mvu-ledger.test.ts packages/st-compat/test/st-mvu-message.test.ts packages/st-compat/test/st-mvu-consistency.test.ts packages/st-compat/test/st-mvu-coexist.test.ts`（34 个）。
- C-T03.c 目标测试：`pnpm exec vitest run packages/core/test/message-modification.test.ts packages/st-compat/test/st-mvu-message.test.ts`（12 个）。
- C-T03.b 目标测试：`pnpm exec vitest run packages/core/test/ledger-pending.test.ts packages/st-compat/test/st-mvu-ledger.test.ts`（9 个）。
- C-T03.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-mvu.test.ts`（17 个）。
- C-T02.f 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-compat-report.test.ts packages/st-compat/test/st-content-coexist.test.ts packages/st-compat/test/st-bench-coexist.test.ts`。
- 预设报告：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js preset --preset <预设.json> --card <卡> [--out <报告.md>]`。
- C-T02.e 目标测试：`pnpm exec vitest run packages/st-compat/test/chat-export.test.ts packages/st-compat/test/chat-jsonl.test.ts packages/st-compat/test/chat-import.test.ts`。
- C-T02.d 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-macros-regex.test.ts`。
- C-T02.c 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-world-info.test.ts`。
- C-T02.b 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-preset.test.ts packages/st-compat/test/st-content.test.ts`。
- C-T02.a 与导入相关测试：`pnpm exec vitest run packages/st-compat/test/st-content.test.ts packages/st-compat/test/character-card.test.ts packages/st-compat/test/chat-cli.test.ts`。
- 共存评测目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts packages/st-compat/test/st-mvu-coexist.test.ts`。
- C-T01 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts packages/st-compat/test/st-bench.test.ts packages/st-compat/test/st-bench-compare.test.ts packages/st-compat/test/st-bench-driver.test.ts`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 驱动组合生成：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js drive --sandbox eval-private/st-sandbox/st --batch <批次> --limit <数量> --port 8899`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
- 共存评测：`node packages/st-compat/dist/st-bench/cli.js coexist --config <配置.json> [--out <目录>]`（已注册插件：`st-content`、`st-mvu`）。
- 单独启动录制：`node packages/st-compat/dist/st-bench/cli.js record --dir eval-private/st-sandbox/runs/<批次> --port 8130`。
- 单独启动沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899`。
- P4 目标测试：`pnpm exec vitest run packages/core/test/code-plugins.test.ts packages/core/test/code-plugin-installations.test.ts packages/core/test/code-plugin-worker.test.ts packages/core/test/code-plugin-installer.test.ts packages/core/test/code-plugin-examples.test.ts`（45 个测试）。
- 不变量检查：`node scripts/check-invariants.mjs`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁连跑或与大量临时目录写入同时进行时，Windows 的系统扫描会拖慢文件与 SQLite 操作，出现过后台 worker 激活超时与 `gap-pass-compare` 的 30 秒用例超时；这些用例单独运行都通过。门禁失败先看失败是否只在整轮并行时出现，不要连续并发跑多轮整仓测试；`gap-pass-compare` 的 3 个用例上限已放宽到 180 秒。
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
- EJS 模板里再写 `<%` 会被外层标签解析截断：内层模板通过变量或 `evalTemplate` 的第二参数传入，测试里用字符串拼接构造内层标签。
- `st-ejs` 的激活正则默认一次性生效（命中后停用），连续使用时显式传 `sticky: true`；注入标记与 `@INJECT` 必须独占一行才会被识别。
- `st-ejs` 的 `getwi` 在模板里需要 `await`；世界书、角色卡、预设与快捷回复数据由调用方注入，不要读 `eval-private/` 或 ST 安装目录。
- 沙箱里模板函数是同步的（远程调用会阻塞模板线程），函数参数与返回值必须能 JSON 化；`define` 只在一次执行内有效，`include` 不可用。
