# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 339：C-T03.d 完成，门禁通过。
- 实现：
  - `packages/st-compat/src/st-mvu/initvar.ts` 新增 `buildMvuCardInitState`：按世界书顺序读取 `[initvar]` 条目，再用角色卡开场白里的 `<initvar>` 块深度合并覆盖；单个条目解析失败只记录原因，`$meta` 结构非法直接抛错；没有任何初始变量时返回 `state: null`。
  - `packages/st-compat/src/st-bench/st-mvu-plugin.ts` 新增 id 为 `st-mvu` 的共存适配器：`apply` 只读初始变量并写报告说明，不改模板与槽位；`afterTurn` 在每轮助手楼层写入后解析 `<UpdateVariable>`，先断言楼层原文与刚产出的回复一致，再经 `MvuLedgerSession` 把补丁写成该楼层的 `mvu` diff 并提交。
  - `packages/st-compat/src/st-bench/coexist.ts`：`CoexistPluginAdapter` 增加可选 `afterTurn`，运行器在成功记录回复后调用，返回的说明只进报告；`runTurn` 返回 `nodeId`；`ST_BENCH_COEXIST_PLUGINS` 注册 `st-mvu`（排在 `st-content` 之后）。
- 测试：新增 `packages/st-compat/test/st-mvu-consistency.test.ts` 6 个、`packages/st-compat/test/st-mvu-coexist.test.ts` 2 个、合成卡 `test/fixtures/coexist-mvu-card.json`；MVU 五个测试文件合计 34 个。
- 报告与决策：`docs/dev/reports/C-T03.md`（一致性用例表、总验收逐条核对、zod 结构校验口径、共存数字）；ADR-0110。
- 门禁：`pnpm check` 通过（212 个测试文件、1880 个测试、5 个跳过，117.01 秒）。

## 下一步（会话 340 先做）
1. **C-T04 `st-ejs` Prompt Template 兼容**：依赖 C-T03，现在可以做。工作量大，先在 TASKS 里拆成 `C-T04.a`（模板解析与函数库）、`C-T04.b`（装饰器、激活正则与世界书条目能力）、`C-T04.c`（worker 隔离、时间预算与 Trace）、`C-T04.d`（共存适配器与评测），本会话只做 `.a`。作用范围：EJS 只作用于来自 ST 的内容，不碰 harness 槽位。
2. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）、X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T03.d 代码事实
- `buildMvuCardInitState` 的输入是世界书条目 `{name, content}` 与开场白；`usedSources` 列出实际使用的条目名与 `"开场白"`，`issues` 只记录条目解析失败。世界书条目来自 `worldInfoFromCharacterBook(card.characterBook, card.name).entries`，名字取 `comment`。
- 适配器的初始变量在第一个助手楼层提交：`MvuLedgerSession.open` 在台账没有 `mvu` 子树时把整份初始值放进待结算视图，`commit` 后才成为台账事实。因此第一轮请求看不到变量，第二轮起 `state` 槽位带着 `mvu` 子树。
- 每轮写入只写该楼层的 diff（I5）；`afterTurn` 会先读楼层并比对 `raw === input.raw`，被改写就抛错。补丁拒绝与格式问题只写进 Notes，不中断正文；适配器自身的错误直接让这次共存运行失败。
- 共存评测的关闭组是 baseline（不加载任何适配器），开启组的模板与槽位和关闭组相同，唯一差别是每轮的变量写入。
- 合成批次的数字：矛盾率 0%/0%（8/8，持平）、编造回忆率 0%/0%（4/4，样本不足）、盲测胜率 80%（10/10，更好）、首字 P90 0/1 毫秒（5/5，持平），无变差项。这一批是假客户端与假裁判，胜负由固定标记决定，不代表真实模型效果。
- zod 结构校验口径：只消费 `MvuObjectSchemaNode` 的 JSON 投影（`type`、`properties`、`elementType`、`extensible`、`recursiveExtensible`、`template`、`required`）；`strictSet`、`strictTemplate`、`concatTemplateArray` 由 `MvuState.options` 携带，不在结构 JSON 里；卡内 zod 脚本要执行时走 C-T05 的酒馆助手宿主。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a 至 C-T03.d。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content` 与 `st-mvu` 完成（引擎、台账写入、待结算视图、消息修改分类、卡级接入与共存评测）；`st-ejs`（C-T04）与 `st-helper-host`（C-T05）待做。
- 数据库 schema 版本 43；本轮没有改 schema，没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0110 记录插件、沙箱、比对与兼容内容映射决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 待处理（不阻塞）：清理 `C:\Users\theater\AppData\Local\Temp` 里累积的测试临时目录。

## 可重复命令
- 门禁：`pnpm check`。
- C-T03.d 目标测试：`pnpm exec vitest run packages/st-compat/test/st-mvu-consistency.test.ts packages/st-compat/test/st-mvu-coexist.test.ts`（8 个）。
- 全部 MVU 测试：`pnpm exec vitest run packages/st-compat/test/st-mvu.test.ts packages/st-compat/test/st-mvu-ledger.test.ts packages/st-compat/test/st-mvu-message.test.ts packages/st-compat/test/st-mvu-consistency.test.ts packages/st-compat/test/st-mvu-coexist.test.ts`（34 个）。
- C-T03.c 目标测试：`pnpm exec vitest run packages/core/test/message-modification.test.ts packages/st-compat/test/st-mvu-message.test.ts`（12 个）。
- C-T03.b 目标测试：`pnpm exec vitest run packages/core/test/ledger-pending.test.ts packages/st-compat/test/st-mvu-ledger.test.ts`（9 个）。
- C-T03.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-mvu.test.ts`（17 个）。
- C-T02.f 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-compat-report.test.ts packages/st-compat/test/st-content-coexist.test.ts packages/st-compat/test/st-bench-coexist.test.ts`。
- 预设报告：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js preset --preset <预设.json> --card <卡> [--out <报告.md>]`。
- C-T02.e 目标测试：`pnpm exec vitest run packages/st-compat/test/chat-export.test.ts packages/st-compat/test/chat-jsonl.test.ts packages/st-compat/test/chat-import.test.ts`。
- C-T02.d 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-macros-regex.test.ts`。
- C-T02.c 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-world-info.test.ts`。
- C-T02.b 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-preset.test.ts packages/st-compat/test/st-content.test.ts`。
- C-T02.a 与导入相关测试：`pnpm exec vitest run packages/st-compat/test/st-content.test.ts packages/st-compat/test/character-card.test.ts packages/st-compat/test/chat-cli.test.ts`。
- 共存评测目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts packages/st-compat/test/st-mvu-coexist.test.ts`。
- C-T01 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts packages/st-compat/test/st-bench.test.ts packages/st-compat/test/st-bench-compare.test.ts packages/st-compat/test/st-bench-driver.test.ts`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 驱动组合生成：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js drive --sandbox eval-private/st-sandbox/st --batch <批次> --limit <数量> --port 8899`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
- 共存评测：`node packages/st-compat/dist/st-bench/cli.js coexist --config <配置.json> [--out <目录>]`（已注册插件：`st-content`、`st-mvu`）。
- 单独启动录制：`node packages/st-compat/dist/st-bench/cli.js record --dir eval-private/st-sandbox/runs/<批次> --port 8130`。
- 单独启动沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899`。
- P4 目标测试：`pnpm exec vitest run packages/core/test/code-plugins.test.ts packages/core/test/code-plugin-installations.test.ts packages/core/test/code-plugin-worker.test.ts packages/core/test/code-plugin-installer.test.ts packages/core/test/code-plugin-examples.test.ts`（45 个测试）。
- 不变量检查：`node scripts/check-invariants.mjs`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁连跑或与大量临时目录写入同时进行时，Windows 的系统扫描会拖慢文件与 SQLite 操作，出现过后台 worker 激活超时与 `gap-pass-compare` 的 30 秒用例超时；这些用例单独运行都通过。门禁失败先看失败是否只在整轮并行时出现，不要连续并发跑多轮整仓测试；`gap-pass-compare` 的 3 个用例上限已放宽到 180 秒。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
- MVU 引擎的 `[值, 说明]` 判定与 MVU 一致：长度为 2 且第二个元素是字符串的普通数组也会被当成值加说明，测试与真实卡都要避开这种歧义；需要真正两个元素的列表时用三个元素或开启 `strictSet` 后显式写结构。
- 显示状态只在当前会话；需要跨进程显示时由台账快照重新渲染，不要把它写成楼层原文或台账事实。
- 共存适配器在 `apply` 之后按轮调用 `afterTurn`；插件写错直接让运行失败，不要吞掉错误。`st-mvu` 适配器要求卡里有 `[initvar]` 世界书或开场白 `<initvar>`，没有时它不改任何内容。
