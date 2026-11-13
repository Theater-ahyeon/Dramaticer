# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 355：完成 C-T05.f（酒馆助手宿主的一致性测试与共存评测），兼容插件线 C-T01–C-T05 全部完成。
- 新增 `packages/st-compat/src/st-helper-host/coverage.ts`：
  - `ST_HELPER_UPSTREAM_API_SNAPSHOT` 记录本机 SillyTavern 里 JS-Slash-Runner 4.8.10 公开类型定义中的 140 个函数与 6 个非函数入口（只记录名字与来源文件名，不复制源码）。
  - `ST_HELPER_SCOPE_FUNCTIONS` 是 C-T05 任务范围内的 19 个上游函数；`ST_HELPER_EXTENDED_FUNCTIONS` 是上游 4.8.10 未声明的三个扩展名 `getVariable`、`insertOrAssignVariable`、`getChatMessage`。
  - `summarizeStHelperCoverage()` 给全量 16/140（11.4%）、范围 16/19（84.2%）、范围内缺口 `insertVariables`、`generate`、`generateRaw`；名称不在快照或扩展清单里直接抛错。
- 新增 `packages/st-compat/test/st-helper-consistency.test.ts`：31 条一致性用例，按来源（变量、事件、消息、STscript、沙箱、状态栏、脚本库）记录上游行为与期望；断言覆盖清单里每个函数至少一条用例，并断言覆盖率数字。
- 新增 `packages/st-compat/src/st-bench/st-helper-plugin.ts` 并注册进 `ST_BENCH_COEXIST_PLUGINS`：两组都用 `buildStContentCoexistResult`；开启组每轮读脚本库、从新楼层提取 HTML 状态栏并把渲染请求送进沙箱（Node 批次没有 iframe，请求保持等待）。测试 `st-helper-coexist.test.ts` 断言两组提示词逐字节相同、四项指标有样本量、报告不含正文。
- `compareBlindWin` 改为按非平局判定计算开启侧胜率：两份文本相同时裁判直接判平局，全部平局判“持平”。MVU 共存测试的胜率随之从 0.8 变成 1.0（另有 2 次平局），C-T01、C-T03 报告与 ADR-0100 的口径已同步。
- 新增 `docs/dev/reports/C-T05.md`：覆盖率、31 条用例、合成批次四项指标（矛盾率 0%/0% 8/8；编造回忆率 0%/0% 4/4 样本不足；盲测 10 次全部平局判持平；首字 P90 1/1 毫秒 5/5）与 C-T05 总验收逐条核对。
- ADR-0124；门禁通过（234 个测试文件、2074 个测试、5 个跳过）。

## 下一步（会话 356 先做）
1. **H-T00 细化应用内助手**：依赖 R5-T99、R3b-T99、E-T01 全部完成。按 DESIGN §10.3 写清抽屉界面与全部技能、类型化 server 接口、三级权限、对话保存与搜索、关掉抽屉后任务继续运行与状态提示、上下文自动与手动压缩、用量环，拆成可执行任务。
2. 其余可做任务：X1（依赖已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。
3. 兼容插件线已全部完成；剩余风险是覆盖率：全量 140 个上游函数只同名实现 16 个，未实现的分组见 `docs/dev/reports/C-T05.md`。

## C-T05.f 代码事实
- 覆盖率快照与范围清单都是静态常量，测试断言 140/16/19/16/3 这组数字；改动上游快照或实现清单时要同步改断言与报告。
- 生成能力没有 `generate`/`generateRaw` 全局函数，脚本用 `/gen`、`/genraw` 登记后台请求，`/genresult <id>` 读正文；一致性用例把这一条记为“函数名未暴露”。
- 共存适配器的开启组每轮新建一个宿主会话：读脚本库、`renderStatusBar(nodeId)` 登记渲染、写一条只含数字的 note（`st-helper-host：脚本库 N 条（启用 M 条），状态栏渲染请求 K 次（等待 iframe）`）。批次不执行脚本。
- `compareBlindWin` 现在按 `acceptedShare / (1 - tieShare)` 计算胜率，`decisive < 5` 判样本不足，没有非平局判定判持平；`on` 字段是全为平局时的 `null`。
- 一致性用例里 `/setvar` 必须写 `key=名字`（上游语法），`/messages` 默认带 `名字: ` 前缀，`names=off` 去掉。
- 沙箱一致性用例直接驱动 `StHelperSandboxHost`：`startScript` 之后用 `handleMessage` 发调用，结果从 `send` 回调里读；超时用 `sweepTimeouts()`。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a 至 C-T03.d、C-T04.a、C-T04.b.a、C-T04.b.b、C-T04.c.a、C-T04.c.b、C-T04.c.c、C-T04.c.d、C-T04.d、C-T05.a 至 C-T05.f。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成（含一致性测试与共存评测）。
- 数据库 schema 版本 43；本轮没有改 schema。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0124 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染与覆盖率/平局口径的决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 待处理（不阻塞）：清理 `C:\Users\theater\AppData\Local\Temp` 里累积的测试临时目录。
- HUMAN-17 待处理（不阻塞）：ST-Prompt-Template 上游许可证是 AGPL-3.0，提案写的是 MIT；本实现按文档独立实现、未复制源码。
- HUMAN-18 待处理（不阻塞）：酒馆助手（JS-Slash-Runner）上游许可证是 Aladdin Free Public License，提案写的是 MIT；本实现只记录公开类型定义里的函数名、按文档独立实现（ADR-0124）。

## 可重复命令
- 门禁：`pnpm check`。
- C-T05.f 目标测试：`pnpm exec vitest run packages/st-compat/test/st-helper-consistency.test.ts packages/st-compat/test/st-helper-coexist.test.ts packages/st-compat/test/st-mvu-coexist.test.ts packages/st-compat/test/st-ejs-coexist.test.ts packages/st-compat/test/st-bench-coexist.test.ts`。
- C-T05.e 目标测试：`pnpm exec vitest run packages/st-compat/test/st-helper-html.test.ts packages/st-compat/test/st-helper-host.test.ts packages/st-compat/test/st-helper-sandbox.test.ts packages/st-compat/test/st-helper-slash.test.ts packages/st-compat/test/st-helper-generation.test.ts packages/web/test/helper-sandbox.test.ts`（53 个）。
- 酒馆助手浏览器用例：`pnpm --filter @dramaticer/web exec playwright test e2e/helper-sandbox.spec.ts --project=desktop`（3 个；e2e 不在 `pnpm check` 里）。
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
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式；用 Python 等外部工具改写文件后要重跑 biome，它会带 CRLF，需要格式化回 LF。
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
- `StEjsVariableStore` 接入 `backend` 后，不指定作用域的写落在 `initial`（台账 `mvu`），global/message/local 仍是插件内存；接入台账的消费方要意识到写入会立即 `commit` 成当前楼层的 state diff。
- 模板生成只登记请求：`generate` 返回 id 不返回正文，宿主用 `createStEjsBackgroundGenerationRunner` 接后台客户端并在间隙 `drain`；结果只在内存里，进程结束就消失，需要跨进程时由调用方另行保存。
- `st-helper-host` 的宿主会话不做执行；脚本正文只在 `scripts` 里返回。`character` 作用域依赖调用方传入带台账后端的 `StEjsVariableStore`，否则写入只留在内存。改消息会切换 head，较早消息的修改按分支切换处理。
- `st-helper-host` 的沙箱 API 全部异步：`postMessage` 不能同步取返回值，脚本必须 `await`。事件监听用整数 token，`eventClearEvent`/`eventClearAll` 会同时清掉 iframe 与宿主两边的监听器。超时由宿主 `sweepTimeouts()` 驱动，调用方负责移除 iframe；超时执行注册的监听器会被清掉。
- STscript：`triggerSlash` 只执行 `ST_HELPER_SLASH_COMMANDS` 里的命令，未知命令按名字失败。变量命令默认作用域与上游一致（`setvar` 是 chat/local），`messages` 的单个数字是消息下标，不是“最后 N 条”。`addswipe` 默认不切换 head，`swipe` 在兄弟楼层之间循环。
- `/gen` 与 `/genraw` 只登记后台请求并返回请求 id，不返回正文，回合内不等待。正文用 `/genresult <id>` 读取，未完成或失败是空串；状态用 `session.generation.get(id)`。脚本请求与 EJS 模板请求共用 `StEjsGenerationScheduler` 的卡级上限，队列 `drain` 只执行脚本登记的请求。
- HTML 状态栏与开场页的渲染结果只在插件显示状态（`PluginDisplayState`，插件 `st-helper-host`，键 `statusBar`/`openingPage`）；要把它们接入界面时读 `readStHelperHtmlPage`，不要写回楼层原文或台账。沙箱里的页面脚本与卡片脚本共享同一份权限白名单，未声明的 API 调用会被拒绝并记录。
- 状态栏自动重渲染由变量写入触发，同一页面进行中的渲染会合并后续写入；连续自动刷新默认上限 8 次，超出后需要显式调用 `renderStatusBar` 才会恢复。开场页不参与自动重渲染。
- 酒馆助手的 API 覆盖率快照以本机 JS-Slash-Runner 4.8.10 为准；升级上游版本时要重新生成 `coverage.ts` 的名字清单并同步报告与测试断言。
