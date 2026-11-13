# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 336：完成 **C-T03.b「台账命名空间与待结算视图」**。
- `packages/core/src/ledger/pending.ts` 新增 `PendingLedgerView` 与 `PendingLedgerWrite`、`PendingLedgerRejection`、`PendingLedgerOutcome`、`PendingLedgerCommit`：
  - `open(store, nodeId, prefix?)` 读台账快照；`stage(writes, source)` 用 `validateLedgerDiff` 逐条校验，合法写入留在内存，非法写入逐条拒绝并给出原因；
  - `read()` 返回台账快照叠加尚未提交的写入；`pending()` 返回尚未提交的写入；
  - `commit({storyId, source})` 通过 `store.appendStateDiffs` 写入，提交后重新从台账读取并清空待结算写入；重复提交不新增行。
  - 限定前缀时，前缀之外或与前缀等长的路径直接拒绝；不限定前缀时走完整的台账命名空间校验。
- `packages/core/src/state.ts` 新增 `StateDiffEntry` 与 `applyDiffEntriesTo`；`applyStateDiffsTo` 委托给它，完整 diff 与待结算写入共用同一套路径累加规则。
- `packages/st-compat/src/st-mvu/ledger.ts` 新增 `MvuLedgerSession`（从 `st-mvu/index.ts` 导出）：
  - `open({store, nodeId, state, onTrace?})` 在 `["mvu"]` 前缀上打开待结算视图；台账没有 `mvu` 子树时把 initvar 初始数据用 `diffSnapshots({}, data)` 变成待结算写入；
  - `apply(operations)` 读待结算数据 → `applyMvuPatch` → 只对变化路径 `diffSnapshots` → `mvuLedgerPath` → `stage`；补丁拒绝与被视图拒绝的写入各记一条 Trace；会话只保存 `MvuSchemaNode` 与根级开关，不另存变量；
  - `commit({storyId, source?})` 返回写入的 `StateDiff[]`、转成 `action: "delete"` 的修复记录与 Trace；之后 `read()` 直接来自台账。
  - Trace 条目形如 `{plugin: "st-mvu", action: "ledger-write", target: "mvu", outcome, path, reason}`，与代码插件的 `ledger-write` 记录同形。
- 新增 9 个测试：`packages/core/test/ledger-pending.test.ts`（5 个）与 `packages/st-compat/test/st-mvu-ledger.test.ts`（4 个）。测试证明：提交前台账不可见、提交后读取与结算路径都以台账为准；常规结算窗口把已写入的 `mvu` 路径视为已覆盖，模型提案不会覆盖；锁定对象新增键被拒绝并留 Trace；同一楼层再次打开会话从台账读起。
- ADR-0108；`core` 只新增通用的待结算视图，没有 ST 概念，没有 schema 变更，没有新增依赖；门禁通过（208 个测试文件、1860 个测试、5 个跳过）。

## 下一步（会话 337 先做）
1. 按 TASKS 从上往下选：**C-T03.c 消息修改分类与显示状态**。改正文的类型生成新 swipe（参考 `StoryStore` 追加节点与 `chat-import` 的 swipe 写法，`packages/core/src/chat/turn.ts` 的 `recordRegeneratedSwipe`）；只改显示或元数据的类型写进插件显示状态，不新建节点；状态栏刷新与 `<StatusPlaceHolderImpl/>` 等显示副作用不进入台账、不写楼层。
2. C-T03.d：补 MVU 一致性用例并逐条核对 C-T03 总验收；在 `ST_BENCH_COEXIST_PLUGINS` 注册 `st-mvu` 并跑开关对照；卡内 zod 脚本执行复用 C-T05 的酒馆助手宿主，当前只消费消息变量里的结构 JSON。
3. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01）、X1（依赖 R1-T99.a、R2-T99）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T03.b 代码事实
- `PendingLedgerView` 的提交路径不写 `ledger_settlements`：楼层仍由常规结算任务记录一次结算；已写入的 `mvu` 路径进入 `WindowFloor.covered`，`planFloor` 跳过同路径提案。非法 `mvu` 写入与其它命名空间的非法写入一样，由 `readWindowFloor` 记入 `invalid`，结算时删除并记 `repairs`。
- 初始数据只在台账没有 `mvu` 子树时写入；`buildMvuInitState` 返回的 `data` 已去掉 `$meta`，结构保存在会话内存里。需要从已保存结构恢复时，用 `parseMvuSchema` 读出结构再传给 `MvuLedgerSession.open`。
- 同一会话里连续 `apply` 会以“待结算值”为基准生成新 diff；同一路径可能出现多条写入，台账按写入顺序回放，最后一条生效。
- `MvuLedgerSession.open` 传给 `onTrace` 的回调在 `apply` 与 `commit` 时各调用一次；`apply` 只记拒绝，`commit` 记每条实际写入与提交时的拒绝。
- `packages/core/src/ledger/settle.ts` 的 `validateLedgerDiff` 对 `mvu` 只要求路径至少两段；变量结构校验在引擎里完成（C-T03.a）。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a、C-T03.b。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- C-T03 已拆成 a–d：a、b 完成，c（消息修改分类）、d（一致性与共存评测）待做。
- 数据库 schema 版本 43；本轮没有改 schema。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`。
- 兼容插件线：`st-content` 完成；`st-mvu` 引擎、台账写入与待结算视图完成，尚未接运行时与共存评测。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0108 记录插件、沙箱、比对与兼容内容映射决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T03.b 目标测试：`pnpm exec vitest run packages/core/test/ledger-pending.test.ts packages/st-compat/test/st-mvu-ledger.test.ts`（9 个）。
- C-T03.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-mvu.test.ts`（17 个）。
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
