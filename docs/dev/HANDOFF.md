# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 321：完成 C-T01.b.b 组合计划、run 清单与断点续跑（ADR-0096）。`packages/st-compat/src/st-bench/plan.ts` 新增 `discoverSandboxInputs`、`planSandboxCombinations`、`combinationId`、`readSandboxRunManifest`、`latestSandboxRunEntries`、`writeSandboxPlan`、`appendSandboxRunEntry`、`findSandboxRunEntryBySeq`、`assertBatchDir`、`assertBatchName`；CLI 新增 `st-bench plan [--sandbox] [--batch] [--limit]`；11 个测试。真实沙箱用 `sandbox --source "D:/SillyTavern" --replace` 重建后得到 36 个预设、68 张卡、88 个聊天片段，`plan` 生成 88 个组合，重复运行不新增行；沙箱已重新 `serve --configure-only`（端口 8899、端点 `http://127.0.0.1:8130/v1`、桩模型 `dramaticer-st-bench`）；门禁通过（195 个测试文件、1723 个测试、5 个跳过）。

## 下一步（会话 322 先做）
1. 按 TASKS 从上往下选：C-T01 的父任务与 C-T01.b 保持 `[~]`，第一个未完成的子任务是 **C-T01.b.c Playwright 生成驱动**（依赖 C-T01.b.a、C-T01.b.b，均已满足）。
2. C-T01.b.c 要点：
   - Playwright 加进 `packages/st-compat` 的 devDependencies（`@playwright/test` 1.63.0，浏览器已装在 `packages/web`），在 `docs/dev/DEPENDENCIES.md` 登记，用 pnpm 安装。
   - 用 `startSandboxServer` 启动沙箱；`st-bench record --dir <批次目录>` 的录制服务与 `serve` 的端点端口要一致（默认 8130）。
   - 按 `plan` 的 88 个组合逐个切换预设（`#settings_preset_openai` 或 UI）、选中卡片、打开对应对话或新建片段，点生成；生成前用 `/api/settings/get` 确认自定义端点仍是录制服务、模型仍是桩模型。
   - 每次生成前后读 `<录制目录>/index.jsonl` 的 `seq`，用 `appendSandboxRunEntry` 写 `running` 与 `completed`/`failed`（含 `seqStart`/`seqEnd`、时间与原因）；失败组合记录原因后继续。
   - 不要用真实模型端点（I14）；驱动只操作沙箱副本与私有录制目录。
3. C-T01.b 总验收在 b.c 完成后核对：零模型调用下每个组合产出一条或一组请求记录；run 清单能把每条记录对应回组合；中断后续跑不重复已完成组合；驱动只操作沙箱副本与私有录制目录；失败组合记录原因并继续；沙箱与录制数据不在提交里。
4. 其余可做任务：C-T01.c 依赖 C-T01.b；C-T02 起依赖 C-T01；H-T00 依赖 R5-T99、R3b-T99、E-T01（均已完成）；X1 依赖 R1-T99.a、R2-T99（均已完成）。M5-T00 依赖 R6-T99，不能先做；M6-T99 等待 HUMAN-15。

## C-T01.b.b 代码事实
- `packages/st-compat/src/st-bench/plan.ts`：
  - `discoverSandboxInputs({dataRoot})` 返回 `{presets, characters, chats}`。预设取 `data/default-user/OpenAI Settings/*.json`（文件名去 `.json`，排序按码点）；卡取 `data/default-user/characters/` 顶层 `.png`/`.json`（跳过子目录）；片段递归取 `chats/**/*.jsonl`，id 是相对 `chats/` 的 posix 路径。聊天只流式读行，楼层数为非空行数，首行含 `chat_metadata` 时减一；任一类为空直接抛错。
  - `planSandboxCombinations(inputs, {limit?})`：组合数取三份长度的最大值，第 i 个组合取预设 `i % P`、卡 `i % C`、片段 `i % S`；`limit` 只截前缀且不能超过最大值；组合 id 为 `preset\0character\0chat` 的 SHA-256 前 32 位；重复 id 抛错。
  - `readSandboxRunManifest(batchDir)` 读 `<batchDir>/manifest.jsonl`，缺失文件返回空数组，非法行抛错；`latestSandboxRunEntries` 取每个组合最后一行。
  - `writeSandboxPlan({batchDir, privateRoot, combinations})`：无记录补 `pending`；`completed` 跳过；`pending` 保留；`running`（中断）与 `failed` 补一条 `pending` 重试；返回 `{total, created, completed, pending, retried}`。已有记录的输入字段与计划不一致时抛错。
  - `appendSandboxRunEntry({batchDir, privateRoot, entry})` 追加一条状态行；`findSandboxRunEntryBySeq(entries, seq)` 按 `seqStart`/`seqEnd` 反查组合，越界序号直接抛错。
  - 批次目录必须严格位于私有根目录内部；`assertBatchName` 只允许 `A-Za-z0-9._-`，拒绝 `.` 与 `..`。
- `packages/st-compat/src/st-bench/cli.ts`：`plan` 默认沙箱 `<私有根>/st-sandbox/st`、批次 `default`、清单 `<私有根>/st-sandbox/runs/<批次>/manifest.jsonl`；日志只打印三类输入数量、组合计数与清单路径，不打印名字。`--limit` 走 `parsePositiveInteger`。
- `packages/st-compat/src/index.ts` 导出 `st-bench/plan.js`。
- 测试 `packages/st-compat/test/st-bench-plan.test.ts` 11 条：输入发现与过滤、空输入报错、计划稳定与每个输入至少出现一次、`limit`、首次写入与重复运行、完成跳过与中断/失败重试、序号反查、批次目录与批次名守卫、非法清单行、CLI 统计输出与私有根目录守卫。
- 真实沙箱现状：`eval-private/st-sandbox/st` 已重建为完整数据子集（33 项，node_modules junction），配置仍指向 `http://127.0.0.1:8130/v1` 与 `dramaticer-st-bench`；`eval-private/st-sandbox/runs/dry-run/manifest.jsonl` 是 88 行 `pending` 的真实数据验证结果，C-T01.b.c 应使用新批次名。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a、C-T01.b.a、C-T01.b.b。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 已拆成 a–d，C-T01.b 已拆成 a–c；C-T01.a、C-T01.b.a、C-T01.b.b 完成；C-T02–C-T05 依赖 C-T01。
- ADR-0088 至 ADR-0093 记录插件决策；ADR-0094 记录沙箱与录制分层；ADR-0095 记录沙箱配置、桩设置与启动器；ADR-0096 记录组合计划与 run 清单口径。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T01.b.b 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-plan.test.ts`（11 个测试）。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 启动录制：`node packages/st-compat/dist/st-bench/cli.js record --dir eval-private/st-sandbox/runs/<批次> --port 8130`。
- 启动沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899`。
- C-T01.a 沙箱副本参数见上一条重建命令。
- C-T01.b.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-launcher.test.ts`（7 个测试）。
- P4 目标测试：`pnpm exec vitest run packages/core/test/code-plugins.test.ts packages/core/test/code-plugin-installations.test.ts packages/core/test/code-plugin-worker.test.ts packages/core/test/code-plugin-installer.test.ts packages/core/test/code-plugin-examples.test.ts`（45 个测试）。
- 不变量检查：`node scripts/check-invariants.mjs`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 `http://` 之外被 I10 拦截的地址：允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid`，也不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
