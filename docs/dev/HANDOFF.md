# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 324：完成 C-T01.b.c Playwright 生成驱动，C-T01.b 全部子任务完成。`packages/st-compat/src/st-bench/driver.ts` 新增 `driveSandboxBatch`、`prepareSandboxChat`、`sanitizeSandboxPresets`；启动前把沙箱 36 个预设的连接字段改写成录制端点与桩模型并清空代理与凭据，切换预设后再次用 `/api/settings/get` 复核；片段复制成 `chats/<角色>/bench-<组合 id>.jsonl` 再打开；每个组合写 `running` 与 `completed`/`failed` 及录制序号范围，失败重建页面继续。CLI 新增 `st-bench drive`；`@playwright/test` 1.63.0 进入 `packages/st-compat` 的 devDependencies 与 `docs/dev/DEPENDENCIES.md`；6 个驱动测试。真实沙箱（ST 1.18.0，端口 8899，录制 8130）连跑 5 个组合，每个组合一条请求，`completed` 序号范围 0..0 至 4..4，沙箱日志零 `FetchError`。ADR-0097。门禁通过（196 个测试文件、1729 个测试、5 个跳过）。

## 下一步（会话 325 先做）
1. 按 TASKS 从上往下选：第一个未完成任务是 **C-T01.c 逐条比对与覆盖报告**（依赖 C-T01.b，已满足）。
2. C-T01.c 要点：
   - 录制批次在 `eval-private/st-sandbox/runs/session324-sanitize`（5 个组合）与更早的 `drive-smoke8`、`drive-failtest`；完整计划用新批次重新 `drive`。
   - 按 `manifest.jsonl` 的 `completed` 行取 `seqStart`..`seqEnd`，从批次目录 `requests/NNNNN.json` 读请求，再与 Dramaticer 在相同输入下组装的请求比较。
   - 规范化消息序列、角色、深度注入位置、预填充、采样参数与模型无关字段；差异逐条写原因与定位；报告只含统计与结构哈希，不含提示词正文。
   - 忠实模式要关闭记忆、台账、导演、写作契约等原生功能；`core` 不能出现 ST 概念（I1）。
3. 其余可做任务：C-T01.d 依赖 C-T01.b 与 C-T01.c；C-T02 起依赖 C-T01；H-T00 依赖 R5-T99、R3b-T99、E-T01（均已完成）；X1 依赖 R1-T99.a、R2-T99（均已完成）。M5-T00 依赖 R6-T99，不能先做；M6-T99 等待 HUMAN-15。

## C-T01.b.c 代码事实
- `packages/st-compat/src/st-bench/driver.ts`：
  - `sanitizeSandboxPresets({dataRoot, endpointUrl, stubModel})` 遍历 `OpenAI Settings/*.json`，保留提示词、`prompt_order` 与采样参数，只改写 `chat_completion_source`、`custom_url`、`custom_model`、`reverse_proxy`、`proxy_password`、`custom_include_headers`；非对象预设直接抛错；返回 `{total, changed}`。
  - `prepareSandboxChat({dataRoot, combination})` 校验片段相对路径与角色卡文件名，把片段复制到 `chats/<角色>/bench-<组合 id>.jsonl`，返回 `chatName`（不含扩展名）与文件路径。
  - `driveSandboxBatch(options)` 先 `writeSandboxPlan`，再跳过已完成组合；无待驱动组合时不启动录制与 ST。启动录制（默认 8130）后先清洗预设，再用 C-T01.b.a 的 `startSandboxServer` 启动 ST；单组合默认时限 180 秒；失败写原因并换页面继续；结束时返回 `{total, completed, failed, skipped}`。
  - 浏览器内用 `getPresetManager('openai')` 的 `preset_names` 找预设选项值并 `selectPreset`，用 `selectCharacterById` 选卡，`openCharacterChat` 打开片段副本，`generate('normal')` 生成；每次切换预设后把连接三项写回内存与表单，`saveSettingsDebounced` 后轮询磁盘设置直到一致。
  - 录制序号只读 `index.jsonl` 中以换行结尾的完整行；`running` 行写下一个序号，完成后写实际最小与最大序号。
- `packages/st-compat/src/st-bench/cli.ts`：`st-bench drive [--sandbox] [--batch] [--limit] [--port] [--recorder-port] [--stub-model] [--combination-timeout 秒] [--headed]`；批次目录为 `<私有根>/st-sandbox/runs/<批次>`。
- `packages/st-compat/src/st-bench/plan.ts`：输入发现跳过 `bench-<32 位十六进制>.jsonl`，避免驱动副本进入下一批计划。
- 测试 `packages/st-compat/test/st-bench-driver.test.ts` 6 条：片段复制与越界拒绝、预设清洗（保留提示词与参数、清空代理与凭据、拒绝非对象）、已完成组合跳过且不启动服务、私有根目录守卫。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a、C-T01.b.a、C-T01.b.b、C-T01.b.c。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 已拆成 a–d，C-T01.b 已拆成 a–c，全部完成；C-T01.c 是下一个任务；C-T02–C-T05 依赖 C-T01。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型。需要恢复原始预设时用 `sandbox --replace` 重建。
- ADR-0088 至 ADR-0093 记录插件决策；ADR-0094 记录沙箱与录制分层；ADR-0095 记录沙箱配置、桩设置与启动器；ADR-0096 记录组合计划与 run 清单口径；ADR-0097 记录 Playwright 驱动与预设连接字段清洗。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T01.b.c 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-driver.test.ts packages/st-compat/test/st-bench-plan.test.ts packages/st-compat/test/st-bench-launcher.test.ts`（24 个测试）。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 驱动组合生成：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js drive --sandbox eval-private/st-sandbox/st --batch <批次> --limit <数量> --port 8899`。
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
