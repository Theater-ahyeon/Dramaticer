# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 325：完成 C-T01.c 逐条比对与覆盖报告。`packages/st-compat/src/st-bench/compare.ts` 把 ST 录制请求与忠实模式请求规范化为角色、SHA-256 正文哈希、长度、采样参数与流式开关，逐位比较并输出覆盖率、差异路径与结构哈希；`faithful.ts` 关闭记忆、台账、导演与写作契约，只映射预设条目、角色卡字段、聊天历史、深度注入与预填充，无法映射的功能逐条记入不支持；`core` 的 `ContextStaticSegment` 增加可选 `role`（默认 `system`），忠实模式才能保留 user/assistant 角色；CLI 新增 `st-bench compare [--sandbox] [--batch] [--limit]`，批次报告写到 `<批次>/compare/`（`report.md`、`diffs.jsonl`、`summary.json`），不含提示词正文。驱动增加录制开关、片段加载稳定等待、副本名与楼层数核对。合成测试 8/8 匹配、覆盖率 100%；真实批次采样参数 25/25 一致，消息覆盖率 0%（录制请求缺聊天历史，另立 C-T01.c.a）。ADR-0098；门禁通过（197 个测试文件、1739 个测试、5 个跳过）。

## 下一步（会话 326 先做）
1. 按 TASKS 从上往下选：第一个未完成任务是 **C-T01.c.a 录制请求与聊天片段一致性**（依赖 C-T01.c）。
2. C-T01.c.a 要点：
   - `st-bench compare --sandbox eval-private/st-sandbox/st --batch <批次>` 已能逐条给出差异。当前 5 个组合的录制请求消息数为 3、2、2、2、6，而对应片段有 61、35、107、1、3 楼；`Default` 组合的请求只有 main、`[Start a new Chat]` 与世界观三条系统消息。
   - 手工在沙箱页面打开同一份 `bench-<组合 id>.jsonl` 后，`SillyTavern.getContext().chat.length` 为 62，手动触发一次生成得到的请求包含 7 条消息（含聊天历史）；驱动路径仍只得到 2–3 条。优先核对 `selectPreset` 之后、`openCharacterChat` 完成之前是否有待完成的 `createOrEditCharacter` 把聊天清空，以及 ST 的 `openai_max_context`（Default 为 4095）与 `chatHistory` 条目在生成时的实际状态。
   - 修复后重新驱动一个小批次（`st-bench drive --batch <新批次> --limit 5`），再 `st-bench compare`；把新的覆盖率写进 `docs/dev/reports/C-T01.md` 并更新 TASKS。
3. 其余可做任务：C-T01.d 依赖 C-T01.b 与 C-T01.c；C-T02 起依赖 C-T01；H-T00 依赖 R5-T99、R3b-T99、E-T01（均已完成）；X1 依赖 R1-T99.a、R2-T99（均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15。P5 依赖 M5-T99。

## C-T01.c 代码事实
- `packages/st-compat/src/st-bench/compare.ts`：
  - `normalizeRecordedBody(body)` 校验 messages 数组与角色，采样参数取 `temperature`、`top_p`、`max_tokens`、`frequency_penalty`、`presence_penalty`；`top_k`、`top_a`、`min_p`、`repetition_penalty`、`seed`、`n`、`reasoning_effort`、`assistant_impersonation` 记为 `ignoredParameters`；模型名与流式开关不参与比较。
  - `compareRequests` 逐位比较消息；差异路径为 `messages[i]`、`messages[i].content`、`sampling.*`、`features.*`；`unsupported` 与 `ignoredParameters` 也作为差异条目。
  - `renderComparisonReport` 只输出统计、路径、哈希、长度、参数值与条目标识；逐条差异最多列 200 条，其余在 `diffs.jsonl`。
  - `compareSandboxBatch` 读取 `completed` 行的序号区间，按 `index.jsonl` 找请求文件，用同一份预设、角色卡与聊天片段组装忠实请求；聊天头部的 `user_name` 作为 `{{user}}`。
- `packages/st-compat/src/st-bench/faithful.ts`：
  - 预设顺序取 `character_id` 为 null 或 100000 的全局组，缺省时用 `prompts` 数组；普通条目作为静态消息，`charDescription`/`charPersonality`/`scenario`/`personaDescription` 映射到卡字段与人设，`chatHistory` 映射到历史槽位，深度注入按 `injection_depth` 插入历史，`assistant_prefill` 放最后。
  - 只替换 `{{char}}` 与 `{{user}}`；其余宏、世界书、对话示例、正则、绝对位置注入、附加条目、未知 marker、`prompt.extra`、角色未知与缺失 prompt 逐条记入不支持。
  - 模板 id 为 `st-faithful`，预算 10,000,000，不含记忆、台账、导演、写作契约与 `block_format`。
- `packages/st-compat/src/st-bench/recorder.ts`：新增 `isRecordingEnabled`；关闭时仍返回桩响应但不写 `requests/`、不占序号，`ignoredRequests` 累加。
- `packages/st-compat/src/st-bench/driver.ts`：`openBenchPage` 通过 `page.exposeFunction` 注入 `__dramaticerStartRecording`；`runBrowserTurn` 在 `generate` 前打开录制开关；打开片段后等 1 秒，核对 `characters[characterId].chat === chatName` 且 `chat.length >= floor`；组合结束或失败后关闭开关。
- 测试 `packages/st-compat/test/st-bench-compare.test.ts` 7 条：规范化、角色/正文/采样差异、非法角色、忠实组装（含深度注入与预填充）、不支持功能、批次 CLI 报告不含正文、覆盖率汇总；`packages/st-compat/test/st-bench.test.ts` 新增录制开关用例；core 新增静态段角色与非法角色用例。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a、C-T01.b.a、C-T01.b.b、C-T01.b.c、C-T01.c。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 已拆成 a–d，C-T01.b 已拆成 a–c，全部完成；C-T01.c 完成；C-T01.c.a 是下一个任务；C-T01.d 依赖 C-T01.b 与 C-T01.c；C-T02–C-T05 依赖 C-T01。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke2`、`compare-smoke3`（各 5 个组合）与更早的 `session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0093 记录插件决策；ADR-0094 记录沙箱与录制分层；ADR-0095 记录沙箱配置、桩设置与启动器；ADR-0096 记录组合计划与 run 清单口径；ADR-0097 记录 Playwright 驱动与预设连接字段清洗；ADR-0098 记录逐条比对、忠实模式与覆盖率口径。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T01.c 目标测试：`pnpm exec vitest run packages/core/test/context-assembler.test.ts packages/st-compat/test/st-bench-compare.test.ts packages/st-compat/test/st-bench.test.ts packages/st-compat/test/st-bench-driver.test.ts`。
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
