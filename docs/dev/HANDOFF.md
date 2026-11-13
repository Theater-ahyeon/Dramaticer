# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 327：完成 C-T01.d 共存开关对照评测入口与原生指标，C-T01 全部子任务完成并关闭。新增 `packages/st-compat/src/st-bench/coexist.ts`：`CoexistPluginAdapter` 只改写模板与槽位，`runCoexistComparisons` 对配置里的每个插件跑关闭与开启两组，每组使用独立数据库、相同角色卡、相同片段与相同脚本玩家消息；四项指标复用 R2 的跑后提问、两顺序盲评与 Trace。变差门槛：矛盾率与编造回忆率开启侧高 5 个百分点，盲测胜率低于 45%，首字 P90 超过关闭侧 1.2 倍且多 100 毫秒；样本少于 5 写「样本不足」。报告与 `metrics.json` 只含数字与样本量。CLI 新增 `st-bench coexist --config <路径> [--out <目录>]`，输出必须在私有根目录。插件注册表 `ST_BENCH_COEXIST_PLUGINS` 当前为空，等 C-T02–C-T05 追加。ADR-0100；3 个新测试；门禁通过。

## 下一步（会话 328 先做）
1. 按 TASKS 从上往下选：第一个未完成任务是 **C-T02 P-A `st-content` 内容与 prompt 组装**（依赖 C-T01、P2，均已完成）。
2. C-T02 明显超过一个会话的工作量（角色卡、世界书、预设、宏、正则、jsonl 导入、兼容报告、共存评测）。按 AGENTS 的上下文预算规则，**先把它在 TASKS.md 里拆成 `C-T02.a`、`.b`……再只做第一个**。
   - 建议顺序：a 角色卡与人设映射（V1/V2/V3、PNG/JSON、群聊卡、作者注释）；b 预设与提示词顺序（含深度注入、预填充、squash、采样参数）；c 世界书完整激活语义；d 宏与正则；e 对话 jsonl 导入导出；f 兼容报告与共存评测接入。
   - 每个子任务先写一致性测试并让它变红，再实现；用 C-T01 的 `st-bench` 录制批次作为规格。
3. C-T02 的共存评测接入：在 `ST_BENCH_COEXIST_PLUGINS` 注册一个适配器，实现 `CoexistPluginAdapter.apply`，只改写模板与槽位；然后准备 `st-bench coexist` 的配置文件（写在 `eval-private/`），用沙箱卡片与记忆题跑关闭/开启两组。
4. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）；X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T01.d 代码事实
- `packages/st-compat/src/st-bench/coexist.ts`：
  - `CoexistPluginAdapter { id, apply(input) }`；`apply` 收到 store、storyId、card、template、providers、budgetTokens、structuredOutput，返回可选的新 `template`、新 `providers` 与 `notes`（只进报告）。
  - `runCoexistComparisons({ config, plugins, writer, judge, runDir, now?, log? })` 返回每个插件一份 `CoexistComparison`。配置校验拒绝重复插件 id、重复卡 id/故事 id、空脚本消息、轮数超过消息条数、未知结构化输出方式；插件 id 只允许字母、数字、点、下划线与短横线。
  - 每张卡每组一个数据库：`<runDir>/<插件>/<off|on>/<卡>.db`。片段用 `importChatFileToStore` 导入后节点 id 形如 `<故事>:m<序号>:s<下标>`，记忆题可以用这些 id；没有片段时新建故事，节点 id 是随机 UUID。
  - 脚本玩家消息逐轮调用 `runChatTurn`；单轮失败记入轮次记录并继续。跑完后在最终 head 上调用 `runForgettingQuestions`。
  - 盲评样本：`kind: "historical"`，接受侧是开启组回复，放弃侧是关闭组回复；语境是导入片段的公共前缀加此前的脚本消息，两边相同。
  - `summarizeQuestionRecords`（在 `src/evalset/forgetting.ts`）是新导出的单次题目计数，与 `summarizeForgettingRuns` 使用同一套口径。
  - 报告写到 `<输出>/<插件>/report.md`，指标写到 `metrics.json`；`writeCoexistOutputs` 负责写文件。
- `packages/st-compat/src/st-bench/cli.ts`：新增 `coexist` 子命令，读取 `.env` 与 `data/channels.yaml`，正文模型取配置的 `writerModel`，裁判模型取配置的 `judgeModel` 或 `roles.judge`；不使用 Playwright 与沙箱 ST。
- 配置 JSON（`format` 为 `dramaticer.st-bench-coexist`，`version` 1）：`writerModel`、可空 `judgeModel`、可空 `budgetTokens`（CLI 默认 32,000）、可空 `maxTokens` 与 `temperature`、`structuredOutput`（`function-call` 或 `text-tags`）、可空 `rounds`、`plugins`、`cards`。每张卡有 `id`、`storyId`、`title`、`card`、可空 `chat`、非空 `messages`、可空 `questions`；相对路径按配置文件所在目录解析。题目文件格式与 `readMemoryQuestionFile` 相同。
- 测试 `packages/st-compat/test/st-bench-coexist.test.ts` 3 条：假插件替换 history 槽位后两组回复不同、矛盾率/编造回忆率/盲测胜率判为变差且首字延迟判为持平；未注册插件直接报错；配置加载与相对路径解析。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a、C-T01.b.a、C-T01.b.b、C-T01.b.c、C-T01.c、C-T01.c.a、C-T01.d（C-T01 全部完成）。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`（新增「共存开关对照」一节）。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 四个子任务全部完成；C-T02–C-T05 以 C-T02 为下一个任务。共存评测适配器注册表为空。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0100 记录插件、沙箱、比对与共存评测决策。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- 共存评测目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts`。
- C-T01 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts packages/st-compat/test/st-bench.test.ts packages/st-compat/test/st-bench-compare.test.ts packages/st-compat/test/st-bench-driver.test.ts`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 驱动组合生成：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js drive --sandbox eval-private/st-sandbox/st --batch <批次> --limit <数量> --port 8899`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
- 共存评测：`node packages/st-compat/dist/st-bench/cli.js coexist --config <配置.json> [--out <目录>]`（当前没有已注册插件）。
- 单独启动录制：`node packages/st-compat/dist/st-bench/cli.js record --dir eval-private/st-sandbox/runs/<批次> --port 8130`。
- 单独启动沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899`。
- P4 目标测试：`pnpm exec vitest run packages/core/test/code-plugins.test.ts packages/core/test/code-plugin-installations.test.ts packages/core/test/code-plugin-worker.test.ts packages/core/test/code-plugin-installer.test.ts packages/core/test/code-plugin-examples.test.ts`（45 个测试）。
- 不变量检查：`node scripts/check-invariants.mjs`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
