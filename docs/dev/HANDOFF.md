# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 356：完成 H-T00（细化应用内助手）。把 DESIGN §10.3 分成 H-T01 至 H-T09 与 H-T99，写清依赖与验收；新增 ADR-0125，记录助手存储、运行时隔离、三级权限、技能、压缩与接口的决定；迁移 v44–v46 预留给助手会话、待确认动作与压缩记录。本轮只改文档，门禁通过（234 个测试文件、2074 个测试、5 个跳过）。

## 下一步（会话 357 先做）
1. **H-T01 助手会话存储与类型化接口**：依赖 R5-T99、R3b-T99、E-T01、P2.g，全部完成。按 H-T01 的条目做迁移 v44、`StoryStore` 读写、`packages/protocol/src/assistant.ts` 与 `/api/assistant` 的会话接口。
2. 之后按 H-T02 → H-T03 → H-T04/H-T05/H-T06 → H-T07 → H-T08 → H-T09 → H-T99 的顺序做。H-T04 与 H-T05、H-T06 可以在 H-T03 完成后并行安排，但一个会话只做一个任务。
3. H-T00 完成后 R6-T00 的依赖已满足（R5-T99、R3b-T99、R1-T99.a、H-T00），但任务顺序上仍排在 H 之后；不要跳过 H。
4. 其余可做任务：X1（依赖已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## H-T00 的任务划分（ADR-0125）
- **H-T01** 迁移 v44：`assistant_conversations`、`assistant_messages`、`assistant_events`、trigram 索引；`StoryStore` 读写与搜索；`packages/protocol/src/assistant.ts`；`packages/server/src/assistant.ts` 的会话 CRUD、状态与事件续读接口。
- **H-T02** `runAssistantTurn` 复用 `runDeepTurn`，消息只来自技能提示、摘要与会话；只读工具包装 `explainNode`、检索、台账、导演、设置、模板与插件；SSE、取消、状态持久化与重启后的 `interrupted`；不写楼层、不进入剧情上下文。
- **H-T03** 迁移 v45：`assistant_actions` 与台账变更卡来源 `assistant`；三级权限映射；批准时调用现有写入函数；自动级别只直接执行渠道、模型、思考强度与界面设置。
- **H-T04** 技能注册表、排障与使用指南；`docs_search` 从 `--docs-root` 读取文档，trigram 检索，目录缺失时启动失败。
- **H-T05** 台账修订与参谋：`propose_ledger_change` 生成来源 `assistant` 的变更卡，`propose_director_plan` 生成待确认动作。
- **H-T06** 资料员、卡片工坊、设置向导；联网搜索必须显式开启；渠道读取不返回密钥。
- **H-T07** web 抽屉、会话搜索与改名、技能与权限选择、事件续读、关闭后继续运行与状态标记。
- **H-T08** 迁移 v46：`assistant_compactions`；自动与手动压缩、用量环；预算与正剧记忆独立。
- **H-T09** 待确认动作与台账变更卡审阅面板。
- **H-T99** 验收与 `docs/dev/reports/H.md`。

## H 设计要点
- 助手会话可以关联故事，也可以不关联；消息与事件独立于 `nodes`、`state_diffs`、`turn_runs`。
- 助手运行不调用 `generateAssistantTurn`，不组装剧情上下文；正剧上下文也不读取助手消息。
- 工具白名单不含草稿、提交、导演手记、正文写入、台账直接写入与生图。
- 只读级别只执行 `read`；确认级别把提案与有外部影响的操作写成待确认动作；自动级别只直接执行不改变剧情内容的渠道、模型、思考强度与界面设置。台账、记忆、故事设置、模板、世界书、卡片字段、导演计划与生图配置在任何级别都只生成待确认动作或变更卡。
- 台账变更卡锚定当前 head：`source_node_id` 取 head，`before` 取 head 快照，批准复用 `approveLedgerChangeCard`，事实来源为 `player`。
- 助手上下文预算默认 48,000 token，压缩阈值默认 0.8；较早消息合并成一条 `system` 摘要，保留最近 10 条与待确认动作引用的消息。
- 助手默认模型是 `roles.writer` 解析到的别名，会话可以覆盖；不新增渠道角色。
- 请求与响应类型放在 `packages/protocol`，运行时放在 `packages/core/src/assistant`，server 处理放在 `packages/server/src/assistant.ts`，web 放在 `packages/web/src/assistant`。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a 至 C-T03.d、C-T04.a、C-T04.b.a、C-T04.b.b、C-T04.c.a、C-T04.c.b、C-T04.c.c、C-T04.c.d、C-T04.d、C-T05.a 至 C-T05.f、H-T00。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成（含一致性测试与共存评测）。
- 数据库 schema 版本 43；v44–v46 已预留给 H 任务。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0125 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染、覆盖率口径与应用内助手的决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 待处理（不阻塞）：清理 `C:\Users\theater\AppData\Local\Temp` 里累积的测试临时目录。
- HUMAN-17 待处理（不阻塞）：ST-Prompt-Template 上游许可证是 AGPL-3.0，提案写的是 MIT；本实现按文档独立实现、未复制源码。
- HUMAN-18 待处理（不阻塞）：酒馆助手（JS-Slash-Runner）上游许可证是 Aladdin Free Public License，提案写的是 MIT；本实现只记录公开类型定义里的函数名、按文档独立实现（ADR-0124）。

## 可重复命令
- 门禁：`pnpm check`。
- H-T01 之后的助手接口目标测试按任务新增文件确定；web 端到端用例用 `pnpm --filter @dramaticer/web exec playwright test <spec> --project=desktop`，e2e 不在 `pnpm check` 里。
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
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以；助手类型从 `@dramaticer/protocol` 取。
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
