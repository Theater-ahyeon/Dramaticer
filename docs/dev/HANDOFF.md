# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 319：把 C-T01 拆成 C-T01.a 至 C-T01.d，完成 C-T01.a 沙箱副本与零模型录制服务（ADR-0094）。`packages/st-compat/src/st-bench/` 新增 `sandbox.ts`、`recorder.ts`、`cli.ts`，`st-compat` 新增 `st-bench` 脚本；10 个测试；真实副本 `eval-private/st-sandbox/st`（ST 1.18.0）与录制冒烟通过；原目录在复制窗口内没有新写入；副本与录制被 git 忽略。门禁通过（193 个测试文件、1705 个测试、5 个跳过）。

## 下一步（会话 320 先做）
1. 按 TASKS 从上往下选：C-T01 的父任务保持 `[~]`，第一个未完成的子任务是 **C-T01.b 沙箱 ST 启动与生成驱动**（依赖 C-T01.a，已满足）。
2. C-T01.b 要点：
   - 沙箱副本已存在，但只复制了 `data/default-user/OpenAI Settings`。补齐卡片、世界书、对话片段用 `node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:\SillyTavern" --replace`（默认数据子集约 500 MB；`node_modules` 默认用 junction 链到源目录）。`pnpm --filter @dramaticer/st-compat st-bench -- ...` 会把 `--` 当成参数，直接用 node 调 `dist`。
   - ST 的 `config.yaml` 已复制。启动前把数据根目录、监听地址、端口改到沙箱内部（只监听 127.0.0.1），并写一份不含密钥的 `data/default-user/settings.json`，把自定义 OpenAI 兼容端点指向录制服务、模型名用桩模型。`secrets.json` 不能复制，沙箱里也不应该有真实密钥。
   - 录制服务：`startPromptRecorder({dir})` 或 `node packages/st-compat/dist/st-bench/cli.js record --dir <录制目录> [--port 8130] [--max-requests N]`；端点写 `http://127.0.0.1:<port>/v1`；`closed` 在服务关闭时完成，CLI 用 SIGINT 停止。
   - 驱动 ST 前端需要 Playwright：`@playwright/test` 1.63.0 与浏览器已装在 `packages/web`（devDependency），`packages/st-compat` 还没有这个依赖。加进 st-compat devDependencies 时要在 `docs/dev/DEPENDENCIES.md` 登记，并用 pnpm 安装。
   - 还没实现：run 清单（组合 → 请求记录的对应关系）、断点续跑、沙箱 ST 启动器、settings.json 生成。
3. 其余可做任务：C-T02 起依赖 C-T01；H-T00 依赖 R5-T99、R3b-T99、E-T01（均已完成）；X1 依赖 R1-T99.a、R2-T99（均已完成）。M5-T00 依赖 R6-T99，不能先做；M6-T99 等待 HUMAN-15。

## C-T01.a 代码事实
- `packages/st-compat/src/st-bench/sandbox.ts`：
  - `DEFAULT_PROGRAM_ENTRIES`：`server.js`、`plugins.js`、`recover.js`、`index.d.ts`、`package.json`、`package-lock.json`、`config.yaml`、`webpack.config.js`、`jsconfig.json`、`LICENSE`、`README.md`、`src`、`public`、`default`。
  - `DEFAULT_DATA_ENTRIES`：四类预设目录、`characters`、`worlds`、`chats`、`group chats`（目录名含空格）、`groups`、`sysprompt`、`instruct`、`QuickReplies`、`context`、`themes`、`reasoning`、`assets`、`backgrounds`、`User Avatars`、`user`（均在 `data/default-user/` 下）。
  - 排除：顶层 `.git`、`node_modules`、`backups`、`_cache`、`_errors`、`thumbnails`、`content.log`；任意位置的 `secrets.json` 与 `cookie-secret.txt`；`public/scripts/extensions/third-party/**`；`data/default-user/settings.json`。根 `plugins/` 不在程序清单里，不复制。
  - `copySillyTavernSandbox({sourceDir, privateRoot, targetDir, programEntries?, dataEntries?, nodeModules?: "link"|"skip"|"copy", replace?})`：目标必须在 `privateRoot` 内部、与源目录不互相包含；`node_modules` 在 Windows 用 `cmd /c mklink /J` 建 junction，其他平台用目录符号链接；写 `<target>/sandbox.json`（`format: "dramaticer.st-sandbox"`、`formatVersion: 1`、`sourceDir`、`targetDir`、`createdAt`、`stName`、`stVersion`、`license: "AGPL-3.0"`、`nodeModules`、`copied`、`skipped`）。
  - `stBenchPaths(repoRoot)` 返回 `{privateRoot, sandboxDir, recordingsDir}`，默认 `<repo>/eval-private/st-sandbox/{st,recordings/st}`。
- `packages/st-compat/src/st-bench/recorder.ts`：
  - `startPromptRecorder({dir, host?, port?, stubModel?, maxBodyBytes?, maxRequests?, shouldRecord?})` 返回 `{url, host, port, dir, records, closed, close()}`。
  - 默认记录全部 POST；`GET /v1/models` 返回桩模型列表且不记录；`GET /health` 返回计数；`OPTIONS` 返回 204。
  - 每条记录写 `requests/00000.json`（5 位序号）和 `index.jsonl` 一行。索引字段：`seq`、`at`、`method`、`path`、`model`、`stream`、`messageCount`、`bodyBytes`、`file`；正文文件另含 `headers`（`authorization`、`proxy-authorization`、`x-api-key`、`api-key`、`apikey`、`x-goog-api-key`、`cookie`、`set-cookie` 的值为 `<redacted>`）、`query`（`key`、`api_key`、`apikey`、`token` 脱敏）、`body`。
  - 非流式返回固定 JSON（内容 `"[dramaticer-st-bench record-only]"`）；`stream: true` 返回三段 `chat.completion.chunk` 加 `data: [DONE]`；响应里的 `model` 始终是桩模型名。
  - 正文超过 `maxBodyBytes`（默认 64 MiB）返回 413，`file: null`，索引记实际字节数；`maxRequests` 达到后自动关闭；`closed` 在服务端关闭时完成。
  - `readPromptRecordIndex(dir)` 与 `readPromptRecordFile(dir, summary)` 读回记录。
- CLI：`node packages/st-compat/dist/st-bench/cli.js sandbox --source <目录> [--target ...] [--node-modules link|copy|skip] [--data <相对路径>]... [--replace]`；`record [--dir ...] [--host 127.0.0.1] [--port 8130] [--stub-model ...] [--max-requests N]`。
- 测试 `packages/st-compat/test/st-bench.test.ts` 10 条：非流式记录与脱敏、流式 SSE 与自动停止、全局 `fetch` 抛错证明零外呼、413 与索引、允许清单复制且源 mtime 不变、目标守卫、数据条目校验、deny 规则、CLI sandbox、CLI 非法端口。
- 真实副本：`eval-private/st-sandbox/st`（ST 1.18.0，public 59M、src 18M、`node_modules` junction），只复制了预设数据；录制冒烟在 `eval-private/st-sandbox/recordings/smoke`（1 条记录，`authorization` 已脱敏）。复制后对 `D:\SillyTavern` 做 `find -maxdepth 2 -newermt` 没有新写入。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 已拆成 a–d，C-T01.a 完成；C-T02–C-T05 依赖 C-T01。
- ADR-0088 至 ADR-0093 记录插件决策；ADR-0094 记录 ST 一致性测试台的沙箱与录制分层。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T01.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench.test.ts`（10 个测试）。
- 沙箱副本：`node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:\SillyTavern" --replace`。
- 录制服务：`node packages/st-compat/dist/st-bench/cli.js record --dir eval-private/st-sandbox/recordings/<批次> --port 8130`。
- P4 目标测试：`pnpm exec vitest run packages/core/test/code-plugins.test.ts packages/core/test/code-plugin-installations.test.ts packages/core/test/code-plugin-worker.test.ts packages/core/test/code-plugin-installer.test.ts packages/core/test/code-plugin-examples.test.ts`（45 个测试）。
- 插件内核与扩展测试：`pnpm exec vitest run packages/core/test/plugins.test.ts packages/core/test/plugin-runtime.test.ts packages/core/test/chat-slot-plugins.test.ts packages/core/test/plugin-extensions.test.ts packages/core/test/plugin-background-tools.test.ts packages/core/test/turn-hooks.test.ts`。
- 不变量检查：`node scripts/check-invariants.mjs`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
