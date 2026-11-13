# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 342：C-T04.b.a 完成，门禁通过（217 个测试文件、1937 个测试、5 个跳过）。
- C-T04.b 拆成 `.b.a`（装饰器、内容注入、激活正则）与 `.b.b`（世界书与数据读取函数），本会话只做 `.b.a`。
- 实现：
  - `packages/st-compat/src/st-ejs/decorators.ts`：`parseStEjsDecorators` 只解析内容最前面连续的 `@@` 行，17 个已知名称；未知行整行丢弃并记入 `discarded`；`@@@` 开头的行按原文保留并结束装饰器块；`@@if` 必须带非空表达式；`evaluateStEjsDecoratorCondition` 用模板局部变量（`variables`、`getvar` 等）在 `new Function` + `with` 里求值，失败抛 `StEjsDecoratorError` 并带表达式原文。辅助函数 `hasStEjsDecorator`、`readStEjsDecoratorArgument`。
  - `packages/st-compat/src/st-ejs/injection.ts`：`parseStEjsInjections` 把独占一行的标记拆成正常输出与注入条目：`[GENERATE|RENDER:BEFORE|AFTER]`、`[GENERATE|RENDER:{n}:BEFORE|AFTER]`、`[GENERATE|RENDER:REGEX:pattern]`；标记之后到下一标记之间的文本归入该条注入。`@INJECT` 支持 `pos`（`before`/`after`）、`target`（任意槽位名，缺省 `generate`）、`regex`、`order`（缺省 100）、`role`（`system`/`user`/`assistant`），未知或重复属性、非法取值、未闭合引号直接抛 `StEjsInjectionError`。`parseStEjsInitialVariables` 解析 `[InitialVariables]`：先 JSON 再 YAML，必须是对象；空内容得到 `{}`。
  - `packages/st-compat/src/st-ejs/activate-regex.ts`：`createStEjsActivatedRegex`、`applyStEjsActivatedRegexes` 与 `StEjsRegexError`。字符串 pattern 走 `st-content/regex.ts` 的 `stRegexFromString`；`basic` 同时作用于生成与消息，`generate`/`message` 分别限定（都没写时同样两种都作用）；`before` 只匹配 `stage: "before"`，其余只在不带阶段时执行；`html: true` 只匹配 HTML 处理；带深度的脚本在调用方没有 `depth` 时跳过；按 `order` 再按注册顺序执行；没有 `sticky` 的脚本命中一次后停用。替换函数 `this` 上有 `variables`、`getvar`/`setvar`/`incvar`/`decvar`/`delvar`/`insvar`、`match`/`groups`/`offset`/`input`，写入照常记入 `StEjsVariableWrite`。
  - `StEjsRuntime` 新增 `activateRegex`、`getActivatedRegexes`、`applyRegex`、`evaluateCondition`、`defineInitialVariables`；`activateRegex` 同时是模板局部变量。`#buildLocals` 里的变量函数提成 `#variableFunctions`，模板与正则替换函数共用。
  - `StEjsVariableStore.addInitialVariables` 把初始变量并进 `initial` 作用域并重建合并视图，`initial` 仍然优先级最低。
  - ADR-0112；没有新增依赖（`yaml` 已在 `packages/st-compat`），没有改 schema，`core` 没有改动。
- 测试：新增 `packages/st-compat/test/st-ejs-decorators.test.ts` 8 个、`st-ejs-injections.test.ts` 12 个、`st-ejs-regex.test.ts` 11 个。

## 下一步（会话 343 先做）
1. **C-T04.b.b 世界书与数据读取函数**：依赖 C-T04.b.a，现在可以做。范围见 TASKS：`getwi`/`getWorldInfo`（含递归与同世界书省略世界书名）、`activewi`/`activateWorldInfo`、`activateWorldInfoByKeywords`、`getWorldInfoData`、`getWorldInfoActivatedData`、`getEnabledWorldInfoEntries`、`selectActivatedEntries`，`getchar`/`getCharData`/`getpreset`/`getqr`/`getQuickReplyData`，`parseJSON`、`jsonPatch`、`patchVariables`、`setVariableSchema`。世界书部分可以复用 `st-content/world-info-activation.ts` 的激活结果与 `card.ts`、`preset-mapping.ts` 的数据结构；函数需要的输入（世界书、角色卡、预设、快捷回复）通过运行时选项注入，不要读私有目录。
2. 然后 C-T04.c（worker 隔离、时间预算、流水线接入），依赖已改为 C-T04.b.b；C-T04.d 依赖 a 至 c。
3. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）、X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T04.b.a 代码事实
- 装饰器解析只看内容最前面；`@@@` 行原样保留在正文里，并结束装饰器块。正文中间的 `@@if` 不会被识别。装饰器名称区分大小写。
- `@@if` 的表达式求值没有单独的沙箱：它与模板一样用 `new Function` 执行，C-T04.c 的 worker 是唯一执行隔离边界。
- 注入标记必须独占一行；`[GENERATE]` 这种没有位置的裸标记不识别，按普通文本保留。`@INJECT` 的 `target` 可以是任意非空字符串，流水线在 C-T04.c 里决定映射。
- 注入拆分只产出数据，`parseStEjsInjections` 不修改运行时状态，也不把注入内容送回模板。
- `activateRegex` 的默认行为是一次性生效：命中一次后 `active = false`；测试里要连续调用时记得 `sticky: true`。`html` 只是额外的匹配条件，没有 `html` 的脚本在普通与 HTML 输出里都执行。
- 字符串替换保留 JavaScript 的 `$1`/`$&` 语义；函数替换拿到的 `offset` 是 UTF-16 下标（中文按 1 个字符计）。
- `[InitialVariables]` 解析后必须显式调用 `defineInitialVariables` 才会进 `initial` 作用域。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a 至 C-T03.d、C-T04.a、C-T04.b.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs` 的模板引擎与装饰器/注入/激活正则完成；`st-ejs` 的世界书与数据函数（C-T04.b.b）、隔离与评测（C-T04.c–d）与 `st-helper-host`（C-T05）待做。
- 数据库 schema 版本 43；本轮没有改 schema。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0112 记录插件、沙箱、比对、兼容内容映射与 EJS 决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 待处理（不阻塞）：清理 `C:\Users\theater\AppData\Local\Temp` 里累积的测试临时目录。
- HUMAN-17 待处理（不阻塞）：ST-Prompt-Template 上游许可证是 AGPL-3.0，提案写的是 MIT；本实现按文档独立实现、未复制源码。

## 可重复命令
- 门禁：`pnpm check`。
- C-T04.b.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-decorators.test.ts packages/st-compat/test/st-ejs-injections.test.ts packages/st-compat/test/st-ejs-regex.test.ts`（31 个）。
- 全部 EJS 测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-template.test.ts packages/st-compat/test/st-ejs-variables.test.ts packages/st-compat/test/st-ejs-decorators.test.ts packages/st-compat/test/st-ejs-injections.test.ts packages/st-compat/test/st-ejs-regex.test.ts`（57 个）。
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
- EJS 模板里再写 `<%` 会被外层标签解析截断：内层模板通过变量或 `evalTemplate` 的第二参数传入，测试不要直接嵌套标签。
- `st-ejs` 的激活正则默认一次性生效（命中后停用），连续使用时显式传 `sticky: true`；注入标记与 `@INJECT` 必须独占一行才会被识别。
