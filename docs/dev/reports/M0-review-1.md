# M0-REVIEW-1 代码与不变量审查

- 日期：2026-11-06
- 门禁：`pnpm check` 通过（invariants、`tsc -b`、biome、vitest：23 个测试文件，157 个测试）
- 审查范围：`packages/core`、`packages/st-compat`、`scripts/`；任务要求检查的 TASKS、HANDOFF、DECISIONS、DESIGN、DEPENDENCIES 与代码的同步状态；导出模块与 CLI 的测试覆盖。
- 方法：按模块分成 7 个只读切片并行审查（core 存储、core 模型客户端与检索、ST 解析、导入与状态 diff、正则分类器与体检报告、评测集与脚本、文档与覆盖）。每条问题都在代码里定位到行号；主会话对关键结论逐条复核。审查期间没有修改任何代码。

## 一、不变量逐条核对

### I1 core 不依赖 st-compat，也不出现 ST 概念：符合

- `scripts/check-invariants.mjs:28-42` 对 `packages/core/src` 做两项检查：`st-compat` 的 import 与 ST 关键词。门禁运行结果为 ok。
- `packages/core/package.json:14-19` 的依赖只有 `better-sqlite3` 与类型包，没有工作区依赖指向 st-compat。
- 关键词集合覆盖 setvar、getvar、addvar、prompt_order、promptOrder、sillytavern、chatHistory、worldInfoBefore、worldInfoAfter、charDescription、personaDescription、tavern；`TavernDB` 这类只在 st-compat 出现的名字不在 core 里。
- 机械检查只扫描 `packages/core/src`，不扫描 core 的测试目录；当前测试也没有 ST 概念。

### I2 私有数据不被跟踪、代码里没有私有绝对路径：符合

- `scripts/check-invariants.mjs:44-62`：`git ls-files` 里 `eval-private/`、`data/`、`.env`（`.env.example` 除外）出现即失败；`packages` 下的源码与 JSON 里出现 `X:\SillyTavern` 或 `Users\...\AppData` 即失败。门禁通过。
- `git ls-files` 实际清单里没有私有目录与 `.env`（`.gitignore:6-10` 已覆盖）。
- 默认快照路径只出现在 `scripts/snapshot-private-data.mjs:9`，属于 AGENTS.md 允许的位置。
- 所有测试 fixture 都是合成数据（角色名如“测试角色”“表格故事”），没有正文片段。

### I3 运行时与开发依赖都在 DEPENDENCIES.md 登记：部分符合

- `scripts/check-invariants.mjs:64-88` 只检查“声明的依赖是否在文档里出现”，门禁通过，`docs/dev/DEPENDENCIES.md` 对 root、core、st-compat 声明的每个非工作区依赖都有对应行。
- 缺口一：`packages/st-compat/src/character-card.ts:2-5` 直接 import `png-chunks-extract` 与 `png-chunk-text`，而 `packages/st-compat/package.json:14-17` 没有声明这两个包，只有根 `package.json:20-21` 的 devDependencies。当前靠根 `node_modules` 解析成功，但这是未声明的依赖。
- 缺口二：`packages/st-compat` 依赖 `@dramaticer/core`（`workspace:*`），登记规则没有说明工作区依赖豁免，检查脚本 `:74` 也直接跳过。文档与实际规则不一致。

### I4 楼层原文不可修改：符合

- 写入路径：`StoryStore` 只有 `appendNode`（`packages/core/src/store/story-store.ts:190-236`）写 `nodes` 表，全仓库没有更新 `raw` 的公开方法。
- 数据库层：`nodes_immutable` 触发器（`packages/core/src/store/migrations.ts:37-41`）对 `nodes` 的任何 UPDATE 执行 `RAISE(ABORT)`；`nodes_fts_insert`/`nodes_fts_delete`（`:69-78`）只读写 `node_text`，不回写 `nodes`。
- 测试：`packages/core/test/store.test.ts:322`“数据库层面拒绝 UPDATE 楼层原文”用一个裸连接执行 `UPDATE nodes SET raw` 并断言抛错；`packages/st-compat/test/chat-import.test.ts:80`“主路径依次连接，其他 swipe 成为同一父节点的兄弟节点”与 `:164`“当前 swipe 被编辑过时，主路径使用当前正文，变量仍取自当前 swipe”覆盖了 swipe 与编辑各自新建节点的语义。
- 缺口：M0 还没有“用户编辑楼层”的正式接口（M2 才实现），所以没有对应的正向测试；现有证据是“不存在修改接口”加“数据库拒绝修改”。

### I5 状态按楼层存 diff、快照只是缓存：符合

- `nodes` 表没有快照列（`packages/core/src/store/migrations.ts:20-28`）；`state_diffs` 逐条保存 `path`、`op`、`value`、`ordinal`（`:42-54`）；`getStateDiffsAlongPath` 按根到叶顺序返回 diff（`story-store.ts:342-360`）。快照缓存属于 M2 任务（`docs/dev/TASKS.md` 的 M2 粗粒度条目），当前没有实现，不存在双份存储。
- 语义依据：`docs/dev/DECISIONS.md` ADR-0005（对象逐键递归、数组整体替换、根必须对象）与 ADR-0006（空对象表示没有更新）。
- 测试：`chat-import.test.ts:114`“沿主路径累加 diff 能还原每一层的变量快照”用 `toEqual` 逐字段比较；`:128`“diff 使用对象键路径，删除和整体替换都正确”；`:203`“空对象快照表示没有变量更新，不会删除已有状态”。`packages/st-compat/test/state-questions.test.ts:76` 覆盖 `readSnapshot` 的同一语义。
- 缺口：嵌套空对象（`{"stat_data":{}}`，ADR-0006 明确会生成删除 diff）没有测试；`getStateDiffs` 对不存在的节点静默返回空数组（`story-store.ts:332-340`），与 `getStateDiffsAlongPath` 的抛错行为不一致。两条都转成修复任务。

### I6 每轮只有一次主模型调用：不适用（M0 没有每轮生成路径）

- `packages/core` 与 `packages/st-compat` 里没有对话循环入口；`packages/st-compat/package.json:18-23` 的三个 CLI 是报告、状态题、事件题，全部是离线批处理。
- 唯一调用 LLM 的位置是 `packages/st-compat/src/evalset/event-questions.ts`，由 `evalset:events` 脚本驱动，属于评测集构建，不在运行时主循环内。
- M1 的 Turn Executor 实现后必须补这条测试；当前没有可违反的代码路径。

### I7 不做每轮多 agent、不做每轮 LLM 审核 LLM：不适用

- 运行时没有 agent 编排代码。事件题生成使用 LLM 离线出题，答案由人工抽查（HUMAN-03），不属于每轮审核。

### I8 显示、prompt、记忆三种视图从原文派生，正则和渲染不修改原文：符合（就现有代码范围）

- 块协议与渲染器尚未实现，当前没有修改正文的视图代码。
- 正则分类器只做字符串静态分析；`packages/st-compat/src` 中没有任何 `new RegExp`/`RegExp(`，不会执行用户正则（`regex-classifier.ts` 全文）。
- 体检模块只读原始文件：`chat-health.ts`、`entity-health.ts`、`preset-health.ts`、`duplication.ts` 只调用 `stat`/`readFile`/解析函数；唯一的写入在 `health/cli.ts:32-44`，目标固定为 `eval-private/reports/health.md` 与 `docs/dev/reports/M0-health.md`。各处排序都在副本上（如 `[...entries]`），没有就地改写。
- 缺口：统计版报告防泄漏只靠 `packages/st-compat/test/report.test.ts` 里五个字面量的反向断言，没有覆盖 ACU 段落；`renderAcuSection` 没有测试。

### I9 Director 的实时决策用纯程序实现：不适用

- Director 尚未实现（TASKS 的 M3）。当前没有运行时决策代码。

### I10 单元测试不访问网络、不使用私有数据：符合

- `scripts/check-invariants.mjs:90-105` 扫描所有非 `*.live.test.ts` 的测试文件：网络 URL（localhost、127.0.0.1、example 域除外）与私有路径出现即失败。门禁通过。
- 仓库里目前没有任何 `*.live.test.ts`；需要真实渠道的路径只在 `evalset:events` CLI 里，由人工运行。23 个测试文件、157 个测试全部离线。

## 二、代码问题

### 会导致数据或指标错误

1. **导入失败会留下半截数据。** `packages/st-compat/src/chat-import.ts:64-130` 先 `createStory`、逐条 `appendNode` 与 `appendStateDiffs`，再在下一条消息里校验快照；文件末尾的坏行或非法快照抛出时，已写入的故事、楼层、diff 与 FTS 条目全部留在库里。用同一个 `storyId` 重试会被“故事已存在”挡住。`chat-import.test.ts:228` 的“根快照不是对象时拒绝导入”只断言抛错，没有检查库内是否残留数据。修复要求：整次导入放进一个事务，失败后库内没有该故事与相关楼层；补“坏行在文件末尾”与“修正后重新导入”的测试。

2. **`swipe_id` 越界时下标来源不一致，状态被静默丢弃。** `packages/st-compat/src/chat-jsonl.ts:150` 用原始 `swipeId` 取 `variables[swipeId ?? 0]`（越界得到 null），`packages/st-compat/src/node-id.ts:4-16` 的 `currentSwipeIndex` 却把非法值回退到 0；`chat-import.ts:76-104` 用回退下标生成 `:s0` 主节点并跳过兄弟循环里的 0 号 swipe，于是 `variables[0]` 永远不会写进任何节点。真实快照的 `swipe_id` 全部合法（3 个对话 1222 条消息已核对），触发条件是文件被外部编辑或损坏。修复要求：越界或非整数 `swipe_id` 直接抛错，或让节点 id 与快照取同一个校验结果；补越界用例。

3. **聊天 JSONL 首行的 UTF-8 BOM 没有剥离。** `packages/st-compat/src/chat-jsonl.ts:88-89` 把首行原样交给 `JSON.parse`。另外三个解析器都剥离 BOM（`character-card.ts:48`、`world-info.ts:94`、`preset.ts:104`）并各有 BOM 测试。带 BOM 的聊天文件会以“第 1 行不是合法 JSON”失败。修复要求：首行剥离一个 U+FEFF，补 `parseChatJsonl` 与 `parseChatJsonlFile` 的 BOM 用例。

4. **2xx 响应解析失败会重复请求与重复计费，读取阶段的中止/超时被误报。** `packages/core/src/llm/client.ts:233-241` 把 `response.json()` 的任何错误都包成 `LlmResponseError("渠道返回的不是 JSON")` 并重试；`maxRetries` 默认 4，一次调用最多发出 5 次已计费请求。`AbortSignal.timeout` 的超时信号不体现在 `request.signal` 上，超时同样会重试；调用方中止后拿到的是 `LlmResponseError`，不是 `AbortError`。修复要求：只有 `SyntaxError` 走“响应体不是 JSON”的判定，其余读取错误原样抛出；2xx 且响应体非法时只发一次 HTTP 请求；中止用例断言抛出 `AbortError`。

5. **检索查询与索引两侧的规范化不一致。** `packages/core/src/retrieval/chunk-index.ts:42` 对查询做 NFKC 并删除标点、符号、空白，`add`（`:97`）写入原文。全角字母（`ＡＩ模型`）、带标点的短语（`深渊：龙`）查询会产生文档里不存在的三字窗口，命中不了字面存在的子串。修复要求：两侧使用同一套规范化，补“全角文本写入、全角查询命中”与“带标点查询命中”的用例。

6. **检索命中按块计数，一个长楼层可以占满 top-K。** `packages/st-compat/src/evalset/retrieval.ts:119-123` 直接对块级结果 `slice(0, depth)`；同一 `nodeId` 的多个块各占一个位次。召回率会随 `maxChars`/`overlapChars` 变化，跨配置不可比。修复要求：按 `nodeId` 保序去重后取前 K，补“同一楼层多个块只占一个位次”的用例，并重新生成一次基线数字。

7. **体检报告的字节合计对不上，字段合计被截断。** `packages/st-compat/src/health/report.ts:44` 的 `HealthTotals` 没有 `headerBytes`，`sumChats`（`:661-693`）也不累加，统计版的对话表把 `fileBytes` 与 `bodyBytes + variablesBytes + otherBytes` 并排展示，差额是聊天头部（私有报告里对话 3 的头部为 24.8 MB）。`aggregateFields`（`:697-712`）汇总的是 `chat-health.ts:164-167` 已经 `slice(0, 10)` 后的每对话前 10 字段，表头却写“全部对话合计”，某个字段在每个对话都排第 11 时整块从合计表消失。修复要求：合计增加头部字节并单列；字段统计保留全量，截断只在渲染层做；补合计差额小于 1% 的断言与“每个对话第 11 名字段相同”的 fixture。

8. **ACU 覆盖率把相邻单元格拼成一个字符串，产生误报。** `packages/st-compat/src/evalset/acu.ts:138-144` 把所有单元格值用 `\n` 拼成一段文本后做 `includes`，而 `normalizeForTableMatch`（`:88-93`）会删掉空白与标点，相邻单元格、相邻行的值被直接粘在一起。用已提交的 fixture `packages/st-compat/test/fixtures/acu/cells/chat.jsonl` 可复现：表格里只有独立的 `集市` 与 `时间` 两个单元格，答案 `集市时间` 却判为命中。`collectSnapshotText`（`:308-328`）与 `AcuTableDatabase.dump`（`:535-556`）都做了这种拼接。修复要求：快照返回单元格值数组，逐个规范化后判断包含；同一 fixture 上 `集市时间` 必须为未命中、`集市` 仍命中；报告里的 ACU 覆盖数字重新生成。

9. **检索评测对越界的 `askAtNode` 静默关闭“只检索提问楼层之前”的过滤。** `packages/st-compat/src/evalset/retrieval.ts:112-118` 用 `nodeIdByIndex.slice(0, askIndex)`，`askIndex` 大于数组长度时返回整个数组；提问楼层之后的证据会被算成命中，且不抛错。用 `test/fixtures/retrieval-chat.jsonl` 可复现：把 `askAtNode` 改成 `m999` 后命中从 0 变成 1。修复要求：楼层序号越界直接抛“提问楼层不存在”，补越界用例。

10. **ACU 覆盖率对不存在的提问楼层静默跳过题目。** `packages/st-compat/src/evalset/acu.ts:129-137` 只对能在聊天里找到的楼层计分；提问楼层写错时该题从分母里消失，整个故事可以返回 `questionCount: 0` 且 `applicable: true`。修复要求：循环结束后对比已计分 id 与题目集合，缺失时抛错并列出 id。

### 正确性瑕疵、隐藏错误与没有用到的代码

11. `packages/core/src/store/story-store.ts:332-340` `getStateDiffs` 对不存在的楼层返回空数组，调用方无法区分“没有 diff”与“楼层 id 写错”；同类的 `getStateDiffsAlongPath` 会抛错。要求：先检查节点存在。
12. `packages/core/src/store/migrations.ts:82-101` 没有校验迁移列表的版本连续与顺序，`LATEST_SCHEMA_VERSION` 取数组最后一个元素；乱序的迁移列表会让 `user_version` 停在较低版本而不报错。要求：入口校验 `MIGRATIONS[i].version === i + 1`。
13. `packages/core/src/store/story-store.ts:123-124` 把 `state_diffs.path` 的 JSON 直接断言成字符串数组；该列没有 CHECK 约束，裸连接写入 `{}` 后会把对象交给调用方。要求：解析后校验非空字符串数组。
14. `packages/core/src/llm/client.ts:279-286` 与 `:288-298` 的重试等待、限速等待都不接收中止信号，`Retry-After` 没有上限（渠道返回 3600 秒时会等满一小时）。修复要求：等待期间监听信号，`Retry-After` 设上限。
15. `packages/core/src/llm/client.ts:301-305` 的缓存键只含 `baseUrl` 与请求体，不含 `apiKey`；同一网关下换密钥（换账户或换上游部署）会命中对方缓存。要求：把密钥摘要并入缓存键，不写原文。
16. `packages/core/src/llm/client.ts:247-250` 循环末尾的 `throw lastError` 不可达；`:258-268` 的 `LlmResponseError` 分支在调用路径上不可达，实际效果是“响应体非 JSON 会重试，`payload.error` 与空 `choices` 不重试”。要求：删除不可达分支，或让 `parseCompletion` 的失败统一走重试判定。
17. `packages/core/src/llm/client.ts:456-462` `stableJson` 不跳过值为 `undefined` 的对象属性，也不处理 `Date` 等非纯对象，缓存键与线上请求体不等价。要求：与 `JSON.stringify` 的语义一致。
18. `packages/st-compat/src/evalset/event-questions.ts:538-553` 模型输出里缺字段或类型不符的条目被 `continue` 静默丢弃，`failures` 不记录；整个窗口都不合法时 `buildEventQuestions` 的报错文本会写“失败 0 条”。要求：解析阶段的校验失败也计入失败记录，补“缺字段条目”的用例。
19. `packages/st-compat/src/evalset/question-files.ts:33-47` 不检查题目 `id` 重复；两行相同 `id` 会各自进入分母、命中率与 ACU 分档。要求：用集合跟踪，重复时抛错并给出文件与行号。
20. `packages/st-compat/src/evalset/event-cli.ts:164-190` 只重跑一个对话时仍无条件覆盖全局的 `spotcheck.md` 与 `event-summary.json`，其他对话的题目与统计从这两个产物里消失。要求：过滤运行时按故事分别写文件并合并已有条目，或只允许全量运行写全局文件。
21. `packages/st-compat/src/evalset/event-cli.ts:229-240` 与 `packages/st-compat/src/evalset/cli.ts:112-124` 的抽样使用未播种的 `crypto.randomInt`；命中缓存重跑会得到不同的 `spotcheck.md` 与 `summary.json` 样本，HUMAN-03 的标注无法复现。要求：抽样由固定种子或题目 id 的确定性哈希决定，连续两次运行样本一致。
22. `packages/st-compat/src/health/manifest.ts:42-46` 丢弃 manifest 里的 `size` 与 `sha256`，仓库里没有任何代码校验它们；raw 文件被替换或截断后所有基线会静默变化。要求：读取 raw 前用 `stat` 与流式哈希比对，不一致时指出 `target` 并抛错。
23. `packages/st-compat/src/regex-classifier.ts:491-503` `hasRenderSibling` 不检查兄弟脚本的 `disabled`；启用的流式脚本只要同预设里存在同标签的渲染脚本（即使已停用）就被判为可升级，与 `health/regex-health.ts:121-127` 只统计启用脚本的口径冲突。要求：跳过停用的兄弟，补“启用流式 + 停用渲染”的用例。
24. `packages/st-compat/src/regex-classifier.ts:466-469` 的最后一段 `else if (trimmed !== "")` 恒真，`unclassified` 在该分支不可达（空正则的 `unclassified` 由 `:452-453` 产生）。要求：删除冗余条件与分支。
25. `packages/st-compat/src/health/duplication.ts:98` 只校验 `windowSize` 与 `step` 大于 0；`riseWindows: 0` 会访问 `windows[-1]`，`step: 2.5` 会产生小数下标，`ngramSize` 只在有配对时才校验。要求：入口统一校验四个参数为正整数，补三条用例。
26. `packages/st-compat/src/health/token-estimate.ts:38-52` 的 CJK 区间不含谚文（0xAC00–0xD7AF 等），韩文被按 4 字符/token 计算。要求：补区间并加用例。真实对话以中文为主，这一条不影响现有报告数字。
27. `packages/st-compat/src/health/chat-health.ts:176` 的 `extraSwipeCount` 用“总 swipe 数减楼层数”再钳到 0，真实数据 326/579、220/412、126/231 全部得到 0；该字段没有任何消费者。要求：按每条消息累加 `max(0, swipes.length - 1)`，或删除字段。
28. `packages/st-compat/src/health/report.ts:735-741` `ratio` 对 `0/0` 返回 0，`formatPercent` 打印 `0.0%`，把“无法计算”显示成“零”；ACU 段对同类情况用的是“不适用”。要求：返回 `null` 并显示 `—`，补两个用例。
29. `packages/st-compat/src/evalset/event-questions.ts:46-59` 的 `EventQuestionStats` 里 `messageCount`、`floorCount`、`questionCount` 没有读取方（CLI 与 `event-summary.json` 都不使用）。要求：删除这三个字段，或让 CLI 读取它们。
30. 计分与校验辅助重复：`createScore`/`addScore`/`toScore` 在 `evalset/acu.ts:280-306` 与 `evalset/retrieval.ts:222-247` 各一份；`requireNonEmpty` 在 `acu.ts:584`、`retrieval.ts:249`、`event-questions.ts:711`、`state-questions.ts:557`、`chat-import.ts:170`、`core/src/llm/client.ts:489` 共六份，且 event-questions 版本用 `trim()`、其余没有；`collectAcuBaseline` 与 `collectRetrievalBaseline` 的加载流程几乎逐行相同。要求：各抽出一份，行为统一后删除其余定义。
31. 没有用到的代码与重复实现：
    - `packages/st-compat/src/health/preset-health.ts:212` `analyzePresetFiles` 零引用；`:81` `countMacros` 只被测试使用。
    - `packages/st-compat/src/chat-jsonl.ts:122` `stripCarriageReturn` 零调用，`splitChatLines` 里内联了两份相同逻辑。
    - `packages/core/src/store/story-store.ts:161` `getLatestSchemaVersion` 零调用。
    - `packages/core/src/timeline.ts:47` `MemoryEvent` 没有使用方（M0-T06 声明“先只定义类型”）。
    - `packages/st-compat/src/index.ts` 公开了 `SourceLine`、`splitChatLines`、`isPngData`、`SnapshotDiffOp` 等没有外部消费者的符号。
    - `packages/core/src/json.ts:2` 的 `isRecord` 与 `packages/st-compat/src/json.ts:13` 的 `isJsonObject` 函数体逐字相同。
    - `packages/st-compat/src/character-card.ts:145-177` 的 `readText`/`optionalText`/`readTextList`/`expectObject` 与 `field-readers.ts` 的实现等价，M0-T05 引入 `field-readers.ts` 后没有回头替换。
    - `packages/st-compat/src/health/report.ts:25-26` 再次导出 `health/manifest.ts` 的符号，`evalset/cli.ts`、`evalset/event-cli.ts` 与 `evalset/retrieval.ts`、`evalset/acu.ts` 走了两条 import 路径。
    - `packages/st-compat/src/health/report.ts:39` 的 `totals.rawBytes` 只累加、不渲染。
32. `packages/core/test/store.test.ts:87-94` 的“拒绝打开版本高于代码的数据库”用 `tempDbPath()` 建目录却没有注册清理，`packages/core/test/` 下已积累 28 个 `.tmp-store-*` 目录（被 `.gitignore:6` 忽略，但会持续增长）。

## 三、文档同步问题

1. `docs/dev/TASKS.md:55` M0-T07 写“7 个测试”，`chat-import.test.ts` 实际 8 个；`docs/dev/LOG.md:12` 同样。
2. `docs/dev/TASKS.md:60` M0-T08 与 `docs/dev/LOG.md:13` 写“diff/快照 47.8%”，ADR-0006 之后报告合计为 20.8%（`docs/dev/reports/M0-health.md:39`）。
3. `docs/dev/TASKS.md:71` M0-T10 写“9 个新测试”，`state-questions.test.ts` 实际 8 个；`docs/dev/LOG.md:15` 同样。
4. `docs/dev/HANDOFF.md:16` 写“`sheet_replace` 的 `content` 不参与快照”，代码里没有 `sheet_replace` 的专门分支（`packages/st-compat/src/evalset/acu.ts:398-430` 只按 `uid`+`content` 收集）。
5. `docs/DESIGN.md:76` §5 把 `state_diffs` 写成 `{key, op, value, reason, source}`，实现是 `path: string[]` 加 `ordinal`、`source`、`created_at`（`packages/core/src/timeline.ts:21-32`，ADR-0005 用 `path`）。
6. `docs/dev/DECISIONS.md` ADR-0007 写“按请求内容的 sha256 做文件缓存”，缓存键还包含 `baseUrl`（`packages/core/src/llm/client.ts:301-305`）。
7. `docs/dev/DEPENDENCIES.md:13-14` 把两个 PNG 库登记为根目录开发依赖，而 `packages/st-compat/src/character-card.ts` 在运行时 import 它们；`:3` 的规则没有说明工作区依赖豁免。
8. `docs/dev/HANDOFF.md:8` 的“157 个测试”与门禁一致。

## 四、测试覆盖缺口

### 没有直接测试的导出

- `packages/core/src/json.ts:2` `isRecord`。
- `packages/core/src/llm/client.ts:87` `LlmResponseError`（没有 `toBeInstanceOf` 断言）。
- `packages/st-compat/src/chat-jsonl.ts:50` `splitChatLines`、`character-card.ts:41` `isPngData`、`state-diff.ts:44` `diffSnapshots`、`node-id.ts:4,18,25,34` 的四个函数：只被间接覆盖。
- `packages/st-compat/src/evalset/question-files.ts:18,22` `sanitizeFileName`、`storyIdOf`。
- `packages/st-compat/src/evalset/event-questions.ts:293,333` 与 `state-questions.ts:172,200` 的四个 `*FromFile` 包装：测试只覆盖内存版本。

### 没有测试的 CLI 路径

- `packages/st-compat/src/health/cli.ts`：仓库根与输出路径硬编码，没有可注入的参数，也没有测试；被调用的三个收集函数各自有测试。
- `packages/st-compat/src/evalset/cli.ts`：50–100 题的区间硬编码在 CLI 里（`:47`），与 `state-questions.ts:143-145` 的默认值重复；`summary.json` 的写出没有测试。
- `packages/st-compat/src/evalset/event-cli.ts`：`.env` 缺失时静默继续（`:19`），随后才由 `requireEnv` 抛出不带文件名的错误；spotcheck 生成没有测试。

### 弱断言与边界缺口

- `packages/core/test/chunk-index.test.ts:65-78` 六处 `toThrow()` 不校验消息；文件模式、`limit` 上限、同一节点重复写入没有用例。
- `packages/core/test/chunk-text.test.ts:15-28` 没有覆盖“长度正好等于 `maxChars`”“等于 `maxChars + 1`”“末尾残片小于 `step`”与 `\r\n` 归一化。
- `packages/core/test/llm-client.test.ts:209-221` 只断言错误类型，不校验 `status`/`body`；`parseCompletion` 的四个错误分支、2xx 非 JSON、中止、超时、空密钥不发送 Authorization、5xx 重试都没有用例。
- `packages/st-compat/test/chat-health.test.ts` 把恒为 0 的 `extraSwipeCount` 固定成期望值。
- `packages/st-compat/test/report.test.ts:82-125` 没有执行 `renderAcuSection`；`collectHealthReport` 的两条抛错分支（manifest 缺 chat、路径越界）没有测试。
- `packages/st-compat/test/character-card.test.ts:185-196` 没有覆盖 tEXt 解码失败与非法 base64 两条失败路径。

## 五、需要人类确认的门禁脚本修改

这两条涉及 `scripts/check-invariants.mjs`，按 AGENTS.md 的约定不在本会话修改，已写入 `docs/dev/HUMAN.md`（HUMAN-06）。

1. `scripts/check-invariants.mjs:31` 的 I1 关键词表漏了 AGENTS.md 明列的 `marker`；`\b` 边界让 `worldInfoBefore|worldInfoAfter` 覆盖不到 `worldInfo` 前缀写法。core 引入 `marker` 时机械检查不会失败。
2. `scripts/check-invariants.mjs:93-98` 的 I10 只扫描 `*.test.*` 文件，`packages/*/test/fixtures/` 下的数据文件与 `test/png-fixture.ts` 这类辅助模块不在扫描范围；把私有原文放进新的 fixture 可以绕过。建议把 `packages/*/test/` 下的全部文本文件纳入同一套 URL 与私有路径扫描（`*.live.test.ts` 除外）。

## 六、转成的修复任务

修复任务已写入 `docs/dev/TASKS.md`，插在 M0-REVIEW-1 下面，编号 M0-FIX-1 到 M0-FIX-11。顺序与依赖：

|任务|内容|依赖|
|---|---|---|
|M0-FIX-1|导入事务、`swipe_id` 校验、嵌套空对象用例、状态题与 store 回放交叉验证|M0-REVIEW-1|
|M0-FIX-2|聊天 BOM、PNG 失败路径测试、角色卡改用 `field-readers`、删除无消费者的导出与 `stripCarriageReturn`|M0-REVIEW-1|
|M0-FIX-3|LLM 客户端重试与中止语义、缓存键、不可达分支、测试补齐|M0-REVIEW-1|
|M0-FIX-4|检索两侧规范化一致、命中按楼层去重、`askAtNode` 越界抛错、分块边界测试、基线重跑|M0-REVIEW-1|
|M0-FIX-5|ACU 快照改成逐单元格判定、提问楼层缺失抛错、覆盖率重新生成|M0-FIX-4|
|M0-FIX-6|存储层节点存在性、迁移顺序、`path` 校验、测试临时目录清理|M0-REVIEW-1|
|M0-FIX-7|体检报告头部字节与字段合计口径、`ratio` 空值、`extraSwipeCount`、ACU 段测试、CLI 抽出可注入入口并测试|M0-FIX-4、M0-FIX-5|
|M0-FIX-8|正则分类器停用兄弟、不可达分支、重复度参数校验、token 估算谚文、导出收紧|M0-REVIEW-1|
|M0-FIX-9|评测集 CLI 与题目文件：重复 id、确定性抽样、`--story` 不覆盖全局文件、事件统计里没有读取方的字段、`*FromFile` 与 `.env` 测试、辅助函数合并|M0-REVIEW-1|
|M0-FIX-10|manifest 的 `size`/`sha256` 校验|M0-REVIEW-1|
|M0-FIX-11|依赖声明（PNG 库）、`isRecord`/`isJsonObject` 合并、`MemoryEvent` 与 `totals.rawBytes`、文档同步（DESIGN §5、ADR-0007、TASKS/LOG 数字、DEPENDENCIES、HANDOFF）|M0-FIX-2、M0-FIX-7|

每条任务的验收标准写在 TASKS.md 里，都要求新增对应测试并让 `pnpm check` 通过。
