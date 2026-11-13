# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 335：拆分 C-T03 并完成 **C-T03.a「MVU 变量引擎」**。
- 新增 `packages/st-compat/src/st-mvu/`（`schema.ts`、`initvar.ts`、`update.ts`、`index.ts`），从 `packages/st-compat/src/index.ts` 导出：
  - `collectMvuInitVarRaw([{name, content}])` 只收名字含 `[initvar]` 的条目，按输入顺序深度合并；`parseMvuInitVarText` 支持 YAML、JSON、整段代码块与 `<initvar>` 块；`mergeMvuInitVarRaw` 用于开场白覆盖。对象递归合并，数组整体替换。
  - `buildMvuInitState(value)` 读取并移除 `$meta`，返回 `{data, schema, options}`。支持 `extensible`（默认 false）、`required`、`recursiveExtensible`（向子孙传递，显式 false 截断）、`template`、数组元素 `"$__META_EXTENSIBLE__$"`、`$arrayMeta: true` 元信息对象；根级 `strictSet`（默认 false）、`strictTemplate`（默认 false）、`concatTemplateArray`（默认 true）。
  - `parseMvuSchema` 读回酒馆消息变量里保存的结构；`validateMvuSchemaValue` 校验类型、必填键、锁定对象的新增键与数组元素类型，错误带完整路径。
  - `parseMvuUpdate(text)` 从所有 `<UpdateVariable>` 里取 `<Analysis>` 与 `<JSONPatch>`；支持 `replace`、`delta`、`insert`/`add`、`remove`、`move`，路径是 JSON Pointer，数组追加用 `/-`。非法 JSON 整段拒绝，未知操作逐条拒绝。
  - `applyMvuPatch(state, operations)` 每条操作在副本上执行并整份校验，失败只拒绝该条（`rejected[].reason` 以路径开头），合法操作保留。返回 `{data, schema, options, applied, rejected}`。
  - `[值, 说明]`：长度 2 且第二个元素是字符串；未开 `strictSet` 时 `replace`/`delta` 只改第 0 个元素；结构操作必须显式写到 `[0]` 或更深，否则拒绝。数字结构允许数字字符串转换；路径与新增键拒绝 `__proto__`、`constructor`、`prototype`。
- 新增 16 个测试 `packages/st-compat/test/st-mvu.test.ts`；ADR-0107；`core` 无改动，无新增依赖；门禁通过（206 个测试文件、1850 个测试、5 个跳过）。

## 下一步（会话 336 先做）
1. 按 TASKS 从上往下选：**C-T03.b 台账命名空间与待结算视图**。用 `applyMvuPatch` 把当前 `mvu` 快照算出新值，再用 `diffSnapshots`（`packages/st-compat/src/state-diff.ts`）比较前后快照，路径经 `mvuLedgerPath` 变成 `["mvu", ...]`。
2. C-T03.b 需要接进 `packages/core/src/ledger/settle.ts` 的写入路径：MVU 写入与模型写入一样先校验、失败或修复记 `repairs` 与 Trace（I12）；插件临时视图只保存尚未结算的 diff，结算完成后从 `readLedger(store, nodeId, "mvu")` 读取，确保只有一份事实。
3. C-T03.c 处理消息修改分类：改正文生成新 swipe（参考 `StoryStore` 现有的追加节点与 `chat-import` 的 swipe 写法），只改显示或元数据写插件显示状态，不新建节点。
4. C-T03.d 补 MVU 一致性用例、在 `ST_BENCH_COEXIST_PLUGINS` 注册 `st-mvu` 并跑开关对照；卡内 zod 脚本执行要复用 C-T05 的酒馆助手宿主，当前只消费消息变量里的结构 JSON。
5. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01）、X1（依赖 R1-T99.a、R2-T99）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T03.a 代码事实
- `packages/st-compat/src/st-mvu/schema.ts`：
  - `buildMvuInitState` 要求根是对象；`buildMvuNode(value, inheritedExtensible)` 是内部通用入口，更新时用它处理新插入值里的 `$meta`。
  - `recursiveExtensible: true` 在当前层等效 `extensible: true`，并向子孙传递；任意层显式 `extensible: false` 截断。
  - 生成的节点字段与酒馆一致：`type`、`properties`、`elementType`、`extensible`、`required`、`template`、`recursiveExtensible`。
  - `validateMvuSchemaValue` 对 `[值, 说明]` 只看第 0 个元素；长度为 2 且第二个元素是字符串的普通数组也按值加说明处理（与 MVU 的歧义一致）。
- `packages/st-compat/src/st-mvu/update.ts`：
  - `applyMvuPatch` 对每条操作克隆数据与结构，成功后替换；`delta` 只接受数字（值加说明只看第 0 个元素）。
  - `replace` 会按新值重建该路径的结构节点；`strictSet` 打开时把值加说明整体换成新值，结构随之变成新类型。
  - `insert`/`add` 对锁定对象的新增键、锁定数组的增删都拒绝；对象新增键用父结构的 `template`，数组插入用数组的 `template`；`concatTemplateArray` 关闭时按位置融合。
  - `remove` 检查父对象/数组的 `extensible` 与子节点的 `required`；`move` 先删后插，目标在源路径之下时拒绝。
- `packages/st-compat/src/st-mvu/initvar.ts`：`collectMvuInitVarRaw` 的 `issues` 只跳过失败条目；`usedSources` 记录实际参与合并的条目名。空内容视为解析失败。
- 测试：`pnpm exec vitest run packages/st-compat/test/st-mvu.test.ts`（16 个）。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- C-T03 已拆成 a–d：a 完成，b（台账与待结算视图）、c（消息修改分类）、d（一致性与共存评测）待做。
- 数据库 schema 版本 43；本轮没有改 core 与 schema。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`。
- 兼容插件线：`st-content` 完成；`st-mvu` 引擎完成，尚未接台账与运行时。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0107 记录插件、沙箱、比对与兼容内容映射决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T03.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-mvu.test.ts`（16 个）。
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
- MVU 引擎的 `[值, 说明]` 判定与 MVU 一致：长度为 2 且第二个元素是字符串的普通数组也会被当成值加说明，测试与真实卡都要避开这种歧义；需要真正两个元素的列表时用三个元素或开启 `strictSet` 后显式写结构。
