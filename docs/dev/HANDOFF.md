# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 350：完成 C-T05.a（`st-helper-host` 脚本库发现与宿主会话 API），并把 C-T05 拆成 C-T05.a 至 C-T05.f。
- 新增 `packages/st-compat/src/st-helper-host/`：`scripts.ts` 读取角色卡 `extensions.tavern_helper.scripts`，保留禁用脚本，重复 id 与字段类型错误直接抛错；`variables.ts` 实现七个变量函数并映射到 EJS 的 `StEjsVariableStore`；`events.ts` 实现六个事件函数与 `tavern_events` 常量；`messages.ts` 把读消息、改消息与 `swipe_id` 映射到楼层树；`host.ts` 组装会话与 `ST_HELPER_IMPLEMENTED_FUNCTIONS` 清单。
- 变量作用域：`message` → 消息作用域（`message_id` 缺省 `latest`），`chat` → 局部作用域，`global` → 全局作用域，`character` → `initial`（台账 `mvu`，经结算器），`preset`、`script` 留在宿主会话。`st-content/ejs-pipeline.ts` 导出 `createStEjsMvuVariableBackend` 供两边共用。
- 消息修改：改正文调用 core 的 `applyMessageModification`，追加兄弟楼层并成为新的 head（界面里的新 swipe），原文逐字节不变；只改 `is_hidden` 写 `PluginDisplayState` 元数据；`swipe_id` 只把 head 切到已有兄弟楼层。
- 新增 `packages/st-compat/test/st-helper-host.test.ts` 12 个测试；ADR-0119；门禁通过（227 个测试文件、2029 个测试、5 个跳过）。

## 下一步（会话 351 先做）
1. **C-T05.b 沙箱 iframe 执行与权限声明**：把 C-T05.a 的宿主 API 通过 `postMessage` 暴露给沙箱 iframe；脚本在 iframe 里执行，拿不到主线程对象、文件系统与网络；代码插件权限声明列出脚本可用的 API，未声明的调用被拒绝并记录；脚本死循环或超时被终止，原因写进 Trace。先写测试台与权限拒绝用例，再实现宿主侧消息分发器与 iframe 文档。浏览器运行时放 `packages/web/src/chat/`，Node 侧测试覆盖消息协议、权限表与超时；真实 iframe 行为用 web 测试或 e2e 验证。这个任务如果超出一个会话，按 `.a`/`.b` 再拆。
2. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）、X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T05.a 代码事实
- 入口：`createStHelperHostSession({ store, storyId, card, displayState, variables?, userName?, characterName?, plugin? })` 返回 `{ api, scripts, events, dispose }`。`plugin` 缺省是 `st-helper-host`，决定显示状态与消息修改的归属。
- `variables` 不提供时，会话按当前 head 路径建一个空的消息变量种子；需要与 EJS 共用数据时把同一个 `StEjsVariableStore` 传进来。
- `character` 作用域的写入要求 store 接入了 `StEjsVariableBackend`；用 `createStEjsMvuVariableBackend({ store, storyId, nodeId, initial })` 构造，写入立即 `commit` 成该楼层的 `mvu` 台账事实。没有后端时 `character` 写入只改内存，不落台账。
- 变量路径与整棵树写入都会拒绝 `__proto__`、`constructor`、`prototype`；`insertOrAssignVariables` 对对象做深合，`updateVariablesWith` 把整棵作用域树交给更新函数并用返回值替换。
- `getChatMessages(range, options)` 的 `range` 支持数字（最后 N 条）、`latest`、`"start-end"`（负数从末尾数）、`{start, end}`；`options` 支持 `role`、`hide_state`、`include_swipes`。`getChatMessages(0)` 返回空数组。
- 消息对象字段：`message_id`、`name`、`role`、`message`、`is_hidden`、`swipe_id`，`include_swipes` 时额外有 `swipes`。`message_id` 是当前 head 路径上的下标，不是数据库行 id。
- 改正文后 head 指向新兄弟楼层，路径长度不变；如果改的是较早消息，后面的楼层会从当前路径上消失（分支切换语义）。`swipe_id` 选择兄弟楼层同样会切换 head。
- `setChatMessages` 的 `refresh` 只校验取值（`none`、`affected`、`all`），不做界面刷新；刷新由调用方负责。
- 脚本发现只读角色卡脚本库，不执行脚本；世界书与预设里的全局脚本留到后续任务。`source` 目前固定为 `"card"`。
- API 覆盖清单：`ST_HELPER_IMPLEMENTED_FUNCTIONS` 共 18 个名称（7 变量、6 事件、5 消息）；`ST_HELPER_TAVERN_EVENTS` 是事件常量表。
- 测试：`pnpm exec vitest run packages/st-compat/test/st-helper-host.test.ts`（12 个）。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a 至 C-T03.d、C-T04.a、C-T04.b.a、C-T04.b.b、C-T04.c.a、C-T04.c.b、C-T04.c.c、C-T04.c.d、C-T04.d、C-T05.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs` 的内容映射、模板引擎、装饰器/注入/激活正则、世界书与数据函数、沙箱执行、回合内时间预算、流水线接入、模板生成、一致性套件与共存评测全部完成；`st-helper-host` 已完成脚本库与宿主会话 API，沙箱 iframe、STscript、生成与 HTML 状态栏待做（C-T05.b 至 C-T05.f）。
- 数据库 schema 版本 43；本轮没有改 schema。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0119 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测与酒馆助手宿主的决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 待处理（不阻塞）：清理 `C:\Users\theater\AppData\Local\Temp` 里累积的测试临时目录。
- HUMAN-17 待处理（不阻塞）：ST-Prompt-Template 上游许可证是 AGPL-3.0，提案写的是 MIT；本实现按文档独立实现、未复制源码。

## 可重复命令
- 门禁：`pnpm check`。
- C-T05.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-helper-host.test.ts`（12 个）。
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
- `st-helper-host` 的宿主会话不做执行；脚本正文只在 `scripts` 里返回。`character` 作用域依赖调用方传入带台账后端的 `StEjsVariableStore`，否则写入只留在内存。改消息会切换 head，较早消息的修改按分支切换处理。
