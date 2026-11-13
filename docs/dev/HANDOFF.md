# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 326：完成 C-T01.c.a 录制请求与聊天片段一致性。原因有两类：`Default` 预设的上下文预算（4095 上下文 / 300 输出）放不下最新一楼，ST 从最新开始插入历史时一条都放不下；三个 `Gemini Summary` 预设的 `prompt_order` 100001 组没有启用 `chatHistory`，ST 有意不送历史。驱动在切换预设后把沙箱 `openai_max_context` 抬到 2,000,000（ST 对自定义模型的上限）并用 `/api/settings/get` 读回确认。忠实模式改用 100001 组（缺少时回退 100000，再回退 `prompts` 顺序），补 `new_chat_prompt`，按 `names_behavior` 给带 `force_avatar` 的用户消息加 `名字: ` 前缀并去掉 `\r`；修正 `injection_position` 语义（0 相对、1 绝对）。`compare` 新增逐请求历史诊断（片段楼层、进入请求楼层、原因：提示词顺序未启用、上下文预算裁剪、正则或宏修改），`{{user}}` 改取沙箱 `settings.json` 的 `username`。批次 `compare-smoke4`：`Default` 61/61 楼进入请求，摘要预设 0 楼并给出提示词顺序原因，`GrayWill` 2/2 楼；消息覆盖率 3.80%，采样参数 25/25；ADR-0099；门禁通过（197 个测试文件、1740 个测试，5 个跳过）。

## 下一步（会话 327 先做）
1. 按 TASKS 从上往下选：第一个未完成任务是 **C-T01.d 共存开关对照评测入口与原生指标**（依赖 C-T01.b、C-T01.c，均已完成）。
2. C-T01.d 要点：
   - 提供「同一批卡在开启与关闭每个兼容插件时各跑一遍」的评测入口，输出两组对比报告；入口供 C-T02–C-T05 共用。
   - 四项原生指标复用 R2 的评测与裁判口径：矛盾率、编造回忆率、盲测胜率、首字延迟；报告写数字与样本量。
   - 开关由配置控制；变差时报告列出差异与样本量；入口不得调用玩家本机 ST 额度（I14）。
   - 当前只有声明式插件与代码插件内核，`st-content` 等兼容插件要到 C-T02 才有；入口可以先以「插件开关集合 + 运行器 + 指标汇总」的形式落地，用假插件或空开关跑通测试。
3. 其余可做任务：C-T02 起依赖 C-T01（C-T01.d 完成后可关闭父任务 C-T01）；H-T00 依赖 R5-T99、R3b-T99、E-T01（均已完成）；X1 依赖 R1-T99.a、R2-T99（均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15。P5 依赖 M5-T99。

## C-T01.c.a 代码事实
- `packages/st-compat/src/st-bench/driver.ts`：
  - 新增 `DEFAULT_BENCH_CONTEXT_TOKENS = 2_000_000`；`runBrowserTurn` 的输入带 `contextTokens`，`enforceRecorderEndpoint` 同时写 `custom_url`、`custom_model`、`openai_max_context`，`readSavedSettings` 读回 `openai_max_context`，任何一项不一致都在 8 秒后抛错。
  - 预设选择与角色卡/片段打开流程不变；`openCharacterChat` 后等待 1 秒并核对副本名与楼层数。
- `packages/st-compat/src/st-bench/faithful.ts`：
  - `selectPromptOrderGroup(preset)`：100001 优先，其次 100000 或 null，再次第一个组；`resolvePromptOrder` 使用它。
  - `chatHistory` 启用时，历史槽位第一条是 `new_chat_prompt`（预设未保存时用 `[Start a new Chat]`）；空文本与只有空白的内容跳过。
  - `formatHistoryContent`：`names_behavior` 为 2（CONTENT）时全部加名字；为 0（DEFAULT）且 `forceAvatar` 且名字不同于 `{{user}}` 时加名字；先去掉 `\r`。
  - `injection_position === 1` 才按 `injection_depth` 插入历史；`0` 是普通条目；其他值为不支持。未知 marker、宏、世界书、对话示例仍逐条记入不支持。
- `packages/st-compat/src/st-bench/compare.ts`：
  - `HistoryDiagnosis { floors, includedFloors, reason }` 进入 `RequestComparison`；`summarizeComparisons` 增加 `historyFloors` 与 `historyIncludedFloors`。
  - `diagnoseHistory` 先按整条正文匹配，再按 `名字: 正文` 匹配，长文本用包含匹配；未包含时按「提示词顺序未启用」→「预算裁掉全部」→「只保留最近 N 楼」→「N 楼内容被正则或宏修改」的顺序给出原因。
  - `readChatMessages` 跳过系统消息，带 `name` 与 `forceAvatar`；`readSandboxUserName` 读取沙箱 `settings.json` 的 `username` 作为 `{{user}}`。
  - 报告新增「片段历史」总计与逐请求列表，仍只含统计与原因，不含正文。
- 测试 `packages/st-compat/test/st-bench-compare.test.ts` 8 条：新增 100001 组选择；`depthNote` 改用 `injection_position: 1`，未知位置用 2；批次报告断言「3/3 楼」历史。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a、C-T01.b.a、C-T01.b.b、C-T01.b.c、C-T01.c、C-T01.c.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 已拆成 a–d；a、b、c（含 c.a）完成；C-T01.d 是下一个任务；C-T02–C-T05 依赖 C-T01。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0099 记录插件、沙箱与比对决策；ADR-0099 记录本次历史口径。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T01.c.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-compare.test.ts packages/st-compat/test/st-bench-driver.test.ts`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 驱动组合生成：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js drive --sandbox eval-private/st-sandbox/st --batch <批次> --limit <数量> --port 8899`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
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
