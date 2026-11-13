# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 334：完成 C-T02.f「兼容报告与共存评测接入」。`StPresetEntryMapping` 增加 `tokens`；新增 `packages/st-compat/src/st-content/compat-report.ts`，`buildStContentCompatReport` 汇总启用条目 token 规模（进入 prompt 与无法映射分开计）、未识别 marker、角色卡未知字段与扩展键、无法映射的深度与角色、重复条目、总结类与规划类条目、内嵌世界书启用规模；`renderStContentCompatReport` 与 `summarizeStContentCompatReport` 不含正文；CLI 新增 `st-bench preset --preset <路径> --card <路径> [--out <路径>]`。
- 共存评测：`CoexistCardSpec`/`CoexistApplyInput` 带 `preset`，配置卡新增可选 `preset` 路径；新增 `st-bench/st-content-plugin.ts`，`ST_BENCH_COEXIST_PLUGINS` 注册 `st-content`。开启组用 `mapStPreset`（宏引擎带卡字段与当前路径楼层）、`createStWorldInfoProviders`（`worldInfoBefore/After` → `lore`，来源加 `st-content：` 前缀）、`createStHistoryProvider`（深度注入）与预设正则；缺少预设直接报错。
- 新增测试：`st-content-compat-report.test.ts` 3 条、`st-content-coexist.test.ts` 3 条（开/关各 5 轮，矛盾率 8/8、编造回忆率 5/5、盲评 10/10、首字 5/5，四项指标均有数字）。门禁通过（205 个测试文件、1834 个测试、5 个跳过，108 秒）。

## 下一步（会话 335 先做）
1. 按 TASKS 从上往下选：**C-T03 P-C `st-mvu` MVU 兼容**（依赖 C-T02，已完成）。先搭一致性测试并让它变红，再实现 `initvar`、`<UpdateVariable>`、JSONPatch、`[值, 说明]`、`$meta`、zod 校验；变量进入台账 `mvu` 命名空间，更新交给结算器（I12）；插件临时视图与结算后以台账为准；改正文生成新 swipe（I4）。
2. C-T03 的对照评测可直接复用 `st-bench coexist`：给 `st-mvu` 注册适配器，配置卡可带预设；`st-content` 已注册，`plugins` 里可以同时列两个。
3. C-T02 总验收的逐条核对记录见 `docs/dev/reports/C-T02.md`：一致性用例、导入字段、I1、槽位预算、写作契约、兼容报告字段、正则/宏范围、开关对照。
4. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01）、X1（依赖 R1-T99.a、R2-T99）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T02.f 代码事实
- `packages/st-compat/src/st-content/compat-report.ts`：
  - `buildStContentCompatReport({preset, card, mapping})` 输入必需三件；卡报告由 `mapCharacterCard` 重新生成，不暴露 `mapStPreset` 内部的卡片映射。
  - `promptTokens` 只计启用且 `kind` 为 `static`/`injection` 的条目；`unmappedTokens` 计启用且 `kind === "unmapped"`；`tokensByKind` 覆盖五种 `kind`。
  - `unknownMarkers` 取启用且原因为 `unknown-marker` 的标识，去重排序；`unmappable` 只收 `role`、`injection-depth`、`injection-position`、`marker-injection`、`persona-depth`，细节来自预设条目字段。
  - `duplicates` 只统计启用条目：同一标识出现多次，或同一条目的 `name` 被多个启用条目使用；不推断互斥。
  - `classifyStPresetEntry(identifier, name)`：英文按词边界匹配 `summary/summarize/recap/condense/compress` 与 `plan/planner/planning/outline/director`，中文匹配总结/摘要/概括/归纳与规划/大纲/计划/导演。
  - 世界书统计用 `worldInfoFromCharacterBook(card.characterBook, card.name)`，只看 `disabled` 与 `content` 的 token，不输出正文。
- `packages/st-compat/src/st-content/preset-mapping.ts`：`StPresetEntryMapping.tokens` 由模块级 `createTokenEstimator()` 计算；`entryReport` 改收 `text: string | null`，`addUnmapped` 也收正文并按启用状态计入报告。
- `packages/st-compat/src/st-bench/st-content-plugin.ts`：`ST_CONTENT_PLUGIN_ID = "st-content"`、`ST_CONTENT_TRACE_SOURCE = "st-content"`；`tagProviderSource` 只给 `lore` 加前缀，历史槽位不加，因为历史本身是原生内容。
- `packages/st-compat/src/st-bench/coexist.ts`：`CoexistCardSpec.preset`、`CoexistApplyInput.preset`、`CoexistCardFile.presetPath`；`parseCardFile` 的配置键是 `preset`；`loadCoexistCards` 用 `parsePresetFile`。`ST_BENCH_COEXIST_PLUGINS` 目前只有 `st-content`。
- `packages/st-compat/src/st-bench/cli.ts`：新增 `preset` 子命令；`runPresetReport` 固定 `structuredOutput: "text-tags"`，`--out` 写 Markdown，否则打印；宏引擎带角色卡字段。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43；本轮没有改 core 与 schema。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 与 C-T02 全部完成；共存注册表已有 `st-content`，C-T03–C-T05 继续追加。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0106 记录插件、沙箱、比对与兼容内容映射决策。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T02.f 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-compat-report.test.ts packages/st-compat/test/st-content-coexist.test.ts packages/st-compat/test/st-bench-coexist.test.ts`。
- 预设报告：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js preset --preset <预设.json> --card <卡> [--out <报告.md>]`。
- C-T02.e 目标测试：`pnpm exec vitest run packages/st-compat/test/chat-export.test.ts packages/st-compat/test/chat-jsonl.test.ts packages/st-compat/test/chat-import.test.ts`。
- C-T02.d 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-macros-regex.test.ts`。
- C-T02.c 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-world-info.test.ts`。
- C-T02.b 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-preset.test.ts packages/st-compat/test/st-content.test.ts`。
- C-T02.a 与导入相关测试：`pnpm exec vitest run packages/st-compat/test/st-content.test.ts packages/st-compat/test/character-card.test.ts packages/st-compat/test/chat-cli.test.ts`。
- 共存评测目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts`。
- C-T01 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts packages/st-compat/test/st-bench.test.ts packages/st-compat/test/st-bench-compare.test.ts packages/st-compat/test/st-bench-driver.test.ts`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 驱动组合生成：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js drive --sandbox eval-private/st-sandbox/st --batch <批次> --limit <数量> --port 8899`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
- 共存评测：`node packages/st-compat/dist/st-bench/cli.js coexist --config <配置.json> [--out <目录>]`（已注册插件：`st-content`）。
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
- 整轮并行门禁连跑或与大量临时目录写入同时进行时，Windows 的系统扫描会拖慢文件与 SQLite 操作，出现过后台 worker 激活超时与 `gap-pass-compare` 的 30 秒用例超时；这些用例单独运行都通过。门禁失败先看失败是否只在整轮并行时出现，不要连续并发跑多轮整仓测试。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
