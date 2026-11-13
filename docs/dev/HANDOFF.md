# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 343：C-T04.b.b 完成，门禁通过（220 个测试文件、1961 个测试、5 个跳过）。
- 实现：
  - `packages/st-compat/src/st-ejs/world-info.ts`：`getwi`/`getWorldInfo` 省略世界书名时用 `currentWorld`，没有当前世界书时按顺序搜索全部世界书；按 `comment` 再按关键词精确匹配（默认不区分大小写），显式读取可以读到禁用条目。默认把条目正文当成模板渲染，`raw: true` 跳过；渲染结果计入 `estimateTokens` 并受 `tokenBudget` 限制（`StEjsBudgetError`），嵌套读取上限 8 层。`recursive: true` 用首次渲染结果做 `activateStWorldInfo` 扫描（`scanDepth: 1`、递归、默认 3 轮），常量条目与首次命中的条目不重复返回。
  - 同一模块的激活函数维护本次运行的强制激活表：`activateWorldInfo(world, keys?)` 加入指定世界书的启用条目，`activateWorldInfoByKeywords(text)` 用文本扫描后加入；`getWorldInfoActivatedData()` 先返回当前楼层关键词命中的条目（`activatedBy: "keyword"`），再接强制激活条目，条目元数据从世界书补齐；`selectActivatedEntries` 接受名称、`世界.uid`、`世界/注释` 或条目对象；`getWorldInfoData` 与 `getEnabledWorldInfoEntries` 提供条目视图。激活结果按运行时楼层扫描一次后缓存。
  - `packages/st-compat/src/st-ejs/data.ts`：角色卡、预设、快捷回复通过 `StEjsRuntimeOptions.data` 注入。`getchar`/`getCharData` 支持字段别名（`first_mes`、`firstMessage`、`mes_example` 等）与整卡视图；`getpreset(name?)` 省略名称用当前预设；`getqr(label)` 跨集合按标签查找，`getqr(set, label)` 限定集合；`getQuickReplyData(name?)` 返回全部或指定集合；`normalizeStEjsQuickReplySet` 归一酒馆 `qrList` 格式。未知名称与缺数据直接抛 `StEjsDataError`。
  - `packages/st-compat/src/st-ejs/json.ts`：`parseJSON` 先严格 JSON，只有以 `{` 或 `[` 开头才用 YAML 接受单引号与尾逗号；`jsonPatch` 按 RFC 6902 支持 `add`、`remove`、`replace`、`move`、`copy`、`test`，实现 JSON Pointer 转义、数组 `-` 与下标边界，拒绝原型路径，输入对象不变，错误带序号与操作名。
  - `packages/st-compat/src/st-ejs/schema.ts`：`StEjsVariableSchemaNode`（`type`、`properties`、`items`、`required`、`enum`）与注册时校验、按路径取值校验。
  - `StEjsRuntime` 新增 `getWorldInfo`、`activateWorldInfo`、`activateWorldInfoByKeywords`、`getWorldInfoData`、`getWorldInfoActivatedData`、`getEnabledWorldInfoEntries`、`selectActivatedEntries`、`getCharData`、`getPreset`、`getQuickReply`、`getQuickReplyData`、`patchVariables`、`setVariableSchema`、`getTokenUsage`、`getTokenTotal`、`setTokenBudget`，模板局部变量里有对应的 `getwi`/`getWorldInfo`、`activewi`/`activateWorldInfo`、`getchar`/`getCharData`、`getqr`/`getQuickReplyData`、`parseJSON`、`jsonPatch`、`patchVariables`、`setVariableSchema`。`patchVariables` 把变化的顶层键写回目标作用域；`setVariableSchema` 校验 `setvar`、`incvar`、`decvar` 与补丁结果。
- 测试：新增 `st-ejs-world-info.test.ts` 10 个、`st-ejs-data.test.ts` 7 个、`st-ejs-json.test.ts` 7 个。ADR-0113。

## 下一步（会话 344 先做）
1. **C-T04.c worker 隔离、时间预算与流水线接入**：依赖 C-T04.b.b，现在可以做。把模板编译与执行放进 `worker_threads`，主线程只传文本、变量快照与允许的函数清单；超时终止 worker 并重建；每个模板执行计入回合内时间预算，超时跳过并写 Trace（来源、耗时、跳过原因），`dramaticer explain` 可读。接入 `st-content` 的预设、世界书与深度注入，EJS 只作用于 ST 内容；变量读经台账快照、写经待结算视图与结算器校验；模板发起的生成按卡限流并作为后台任务（I6、I11）。
2. 然后 C-T04.d（一致性用例、`ST_BENCH_COEXIST_PLUGINS` 注册 `st-ejs`、开关对照与报告）。
3. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）、X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T04.b.b 代码事实
- 世界书数据完全由 `StEjsRuntimeOptions.worldInfo` 注入；`worldInfo.messages` 省略时用运行时的楼层正文（旧到新），内部传给 `activateStWorldInfo` 前会反转成最新在前。`currentWorld` 不在 `worlds` 里时构造直接抛 `StEjsWorldInfoError`。
- `getWorldInfoActivatedData()` 在没有消息时仍会返回常量条目；`activateWorldInfoByKeywords` 与 `getwi` 的递归扫描都会过滤常量条目，避免重复。
- `getwi` 的 `recursive` 轮数缺省 3；显式传 0 时只返回首次命中的条目。`@@` 装饰器行在读取时去掉，但 `@@if` 不求值；求值与激活过滤由 C-T04.c 的流水线决定。
- token 用量只统计 `getwi` 的输出（嵌套渲染的条目各自计一条），来源是 `世界书 <世界>:<注释或关键词>`；超预算时已经计入的用量保留。
- `getWorldInfoData` 返回的 `content` 是未渲染的原文；`getWorldInfoActivatedData` 的 `content` 来自激活结果（已去掉 `@@` 装饰器、已做宏替换，但没有渲染 EJS）。
- `patchVariables` 按顶层键写回，嵌套对象整键赋值；删除的键走 `delvar`。`setVariableSchema` 只作用于 `setvar`、`incvar`、`decvar` 与 `patchVariables`，`insvar` 与 `store.assign` 的直接调用不校验。
- `parseJSON` 对不以 `{`/`[` 开头的文本直接报错；`jsonPatch` 的 `move` 允许 from 与 path 相同，拒绝 from 是 path 的严格上级。
- 模板里调用异步函数需要 `await`：`<%- await getwi('条目') %>`。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.f、C-T03.a 至 C-T03.d、C-T04.a、C-T04.b.a、C-T04.b.b。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs` 的模板引擎、装饰器/注入/激活正则、世界书与数据函数完成；`st-ejs` 的隔离与评测（C-T04.c–d）与 `st-helper-host`（C-T05）待做。
- 数据库 schema 版本 43；本轮没有改 schema。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0113 记录插件、沙箱、比对、兼容内容映射与 EJS 决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16 待处理（不阻塞）：清理 `C:\Users\theater\AppData\Local\Temp` 里累积的测试临时目录。
- HUMAN-17 待处理（不阻塞）：ST-Prompt-Template 上游许可证是 AGPL-3.0，提案写的是 MIT；本实现按文档独立实现、未复制源码。

## 可重复命令
- 门禁：`pnpm check`。
- C-T04.b.b 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-world-info.test.ts packages/st-compat/test/st-ejs-data.test.ts packages/st-compat/test/st-ejs-json.test.ts`（24 个）。
- 全部 EJS 测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-template.test.ts packages/st-compat/test/st-ejs-variables.test.ts packages/st-compat/test/st-ejs-decorators.test.ts packages/st-compat/test/st-ejs-injections.test.ts packages/st-compat/test/st-ejs-regex.test.ts packages/st-compat/test/st-ejs-world-info.test.ts packages/st-compat/test/st-ejs-data.test.ts packages/st-compat/test/st-ejs-json.test.ts`（81 个）。
- C-T04.b.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-decorators.test.ts packages/st-compat/test/st-ejs-injections.test.ts packages/st-compat/test/st-ejs-regex.test.ts`（31 个）。
- C-T04.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-template.test.ts packages/st-compat/test/st-ejs-variables.test.ts`（26 个）。
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
- EJS 模板里再写 `<%` 会被外层标签解析截断：内层模板通过变量或 `evalTemplate` 的第二参数传入，测试不要直接嵌套标签。
- `st-ejs` 的激活正则默认一次性生效（命中后停用），连续使用时显式传 `sticky: true`；注入标记与 `@INJECT` 必须独占一行才会被识别。
- `st-ejs` 的 `getwi` 在模板里需要 `await`；世界书、角色卡、预设与快捷回复数据由调用方注入，不要读 `eval-private/` 或 ST 安装目录。
