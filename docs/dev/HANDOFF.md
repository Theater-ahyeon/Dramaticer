# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 320：把 C-T01.b 拆成 C-T01.b.a 至 C-T01.b.c，完成 C-T01.b.a 沙箱 ST 配置、桩设置与启动器（ADR-0095）。`packages/st-compat/src/st-bench/launcher.ts` 新增 `configureSandboxServer` 与 `startSandboxServer`；CLI 新增 `serve [--configure-only]`；`packages/st-compat` 新增运行时依赖 `yaml` 并登记；7 个测试；真实沙箱 ST 1.18.0 冒烟（端口 8899）首页与 `/api/settings/get` 均 200，读回的自定义端点与桩模型，录制零请求；门禁通过（194 个测试文件、1712 个测试、5 个跳过）。

## 下一步（会话 321 先做）
1. 按 TASKS 从上往下选：C-T01 的父任务与 C-T01.b 保持 `[~]`，第一个未完成的子任务是 **C-T01.b.b 组合计划、run 清单与断点续跑**（依赖 C-T01.b.a，已满足）。
2. C-T01.b.b 要点：
   - 沙箱数据目前只有 `data/default-user/OpenAI Settings`。组合计划需要卡片与对话片段，先用 `node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:\SillyTavern" --replace` 补齐默认数据子集（约 500 MB；`node_modules` 用 junction）。`--replace` 会重建沙箱，之后要再跑一次 `serve` 写配置与桩设置。
   - 目录里读组合的口径：预设来自 `data/default-user/OpenAI Settings/*.json`（约 58 个，文件名即预设名）；卡片来自 `data/default-user/characters/`（PNG/JSON）；片段来自 `data/default-user/chats/` 下每个对话的 `*.jsonl`（也有 `chat metadata` 之类附属文件，要按扩展名与位置过滤）。只读文件名与统计，不把对话正文写进清单。
   - run 清单建议 `eval-private/st-sandbox/runs/<批次>/manifest.jsonl`，每行 `{combinationId, preset, character, chat, seqStart, seqEnd, floor, startedAt, finishedAt, status, reason?}`；组合 id 由三个名字的稳定哈希生成，排序固定，保证重跑顺序一致。录制序号范围对应 `index.jsonl` 的 `seq`。
   - 断点续跑：按组合 id 读回已完成行，跳过；中断后新批次复用同一批次目录时只补未完成组合。清单与录制数据都在私有目录，测试用 fixture 目录（不放私有数据）。
3. C-T01.b.c 要点：
   - Playwright 加进 `packages/st-compat` 的 devDependencies（`@playwright/test` 1.63.0，浏览器已装在 `packages/web`），在 `docs/dev/DEPENDENCIES.md` 登记，用 pnpm 安装。
   - 驱动打开 `http://127.0.0.1:<port>/`，按组合切换预设（`#settings_preset_openai` 或 UI）、选中卡片、打开对应对话或新建片段，点生成；生成前确认自定义端点仍是录制服务、模型仍是桩模型。
   - 失败组合写 `status: "failed"` 与原因并继续；不要用真实模型端点（I14）。
4. 其余可做任务：C-T02 起依赖 C-T01；H-T00 依赖 R5-T99、R3b-T99、E-T01（均已完成）；X1 依赖 R1-T99.a、R2-T99（均已完成）。M5-T00 依赖 R6-T99，不能先做；M6-T99 等待 HUMAN-15。

## C-T01.b.a 代码事实
- `packages/st-compat/src/st-bench/launcher.ts`：
  - 常量：`SANDBOX_SERVER_HOST = "127.0.0.1"`、`DEFAULT_SANDBOX_SERVER_PORT = 8000`、`DEFAULT_STUB_MODEL = "dramaticer-st-bench"`、`DEFAULT_READINESS_TIMEOUT_MS = 180000`。
  - `configureSandboxServer({sandboxDir, privateRoot, port?, endpointUrl, stubModel?, maxContext?, maxTokens?})` 返回 `SandboxServerSetup`（`url`、`configFile`、`settingsFile`、`dataRoot`、生效的端点/模型/额度）。守卫：沙箱目录必须在私有根目录内部、不能等于私有根目录、必须含 `sandbox.json` 且 `format` 为 `dramaticer.st-sandbox`。
  - 配置改写用 `yaml` 的 `parseDocument`/`setIn`/`stringify`，保留其余键与注释。写入：`dataRoot: "./data"`、`port`、`listen: false`、`protocol.ipv4 true`、`protocol.ipv6 false`、`whitelistMode true`、`whitelist ["127.0.0.1","::1"]`、`basicAuthMode false`、`basicAuthUser {username:"",password:""}`、`enableUserAccounts false`、`browserLaunch.enabled false`、`extensions.enabled false`、`extensions.autoUpdate false`、`thumbnails.enabled false`、`enableCorsProxy false`、`requestProxy.enabled false`、`ssl.enabled false`、`hostWhitelist.enabled false`、`backups.chat.enabled false`、`logging.enableAccessLog false`。
  - `settings.json` 形状：顶层 `firstRun`、`main_api: "openai"`、`username`、`amount_gen`、`max_context`、`power_user: {}`、`extension_settings: {}`，以及 `oai_settings`（`chat_completion_source: "custom"`、`custom_url`、`custom_model`、`openai_max_context`、`openai_max_tokens`、`stream_openai`、其余关闭字段）。自定义源在 ST 里是 keyless，不需要 `secrets.json`。
  - 端点校验：http/https、主机只能是 `127.0.0.1`、`localhost`、`::1`、`[::1]`、不能带账号密码；端口 1–65535；`maxTokens <= maxContext`。
  - `startSandboxServer({...})` 先配置再 `spawn(process.execPath, ["server.js", "--port", String(port)], {cwd: sandboxDir, stdio: ["ignore","pipe","pipe"], windowsHide: true})`；stdout/stderr 写 `<sandbox>/st-bench-server.log` 并逐行回调 `log`；轮询 `GET <url>/` 每 500 毫秒、单次 2 秒超时，首页 200 即返回；子进程提前退出抛 `沙箱 ST 在就绪前退出（退出码 N）`；超时先 `stop()` 再抛错。`SandboxServerHandle` 有 `setup`、`url`、`process`、`logFile`、`closed`、幂等 `stop()`。
  - 命令行：`node packages/st-compat/dist/st-bench/cli.js serve [--sandbox <目录>] [--port 8000] [--endpoint http://127.0.0.1:8130/v1] [--stub-model <名称>] [--configure-only]`；默认沙箱是 `<repo>/eval-private/st-sandbox/st`。`serve` 启动后按 Ctrl+C 停止；`--configure-only` 只写配置与桩设置。
- `packages/st-compat/src/st-bench/sandbox.ts`：原来的 `isInside` 导出为 `isPathInside`，供启动器复用。
- 测试 `packages/st-compat/test/st-bench-launcher.test.ts` 7 条：配置只改沙箱并清空口令、桩设置无密钥、私有根目录与清单守卫、非回环端点/非法端口/越界预算、假服务器启动与停止、提前退出报告退出码、CLI `--configure-only`。
- 真实沙箱现状：`eval-private/st-sandbox/st` 已是配置好的状态（`config.yaml` 回环、`settings.json` 指向 `http://127.0.0.1:8130/v1`、模型 `dramaticer-st-bench`）；`public/lib.js` 已由 webpack 编译；`st-bench-server.log` 是最后一次启动日志。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a、C-T01.b.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 已拆成 a–d，C-T01.b 已拆成 a–c；C-T01.a 与 C-T01.b.a 完成；C-T02–C-T05 依赖 C-T01。
- ADR-0088 至 ADR-0093 记录插件决策；ADR-0094 记录沙箱与录制分层；ADR-0095 记录沙箱配置、桩设置与启动器。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T01.b.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-launcher.test.ts`（7 个测试）。
- 配置真实沙箱：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 启动沙箱：先 `node packages/st-compat/dist/st-bench/cli.js record --dir eval-private/st-sandbox/recordings/<批次> --port 8130`，另开一个终端 `node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899`。
- C-T01.a 沙箱副本：`node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:\SillyTavern" --replace`。
- P4 目标测试：`pnpm exec vitest run packages/core/test/code-plugins.test.ts packages/core/test/code-plugin-installations.test.ts packages/core/test/code-plugin-worker.test.ts packages/core/test/code-plugin-installer.test.ts packages/core/test/code-plugin-examples.test.ts`（45 个测试）。
- 插件内核与扩展测试：`pnpm exec vitest run packages/core/test/plugins.test.ts packages/core/test/plugin-runtime.test.ts packages/core/test/chat-slot-plugins.test.ts packages/core/test/plugin-extensions.test.ts packages/core/test/plugin-background-tools.test.ts packages/core/test/turn-hooks.test.ts`。
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
