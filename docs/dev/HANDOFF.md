# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：14
- 任务：M0-T13 ACU 对照组
- 结果：完成。st-compat 新增 `src/evalset/acu.ts`：从三种来源还原提问楼层之前最近的表格内容——① 头部 `chat_metadata.sheets` 的 `cellHistory`（cell uid → 值）配合逐楼层 `hash_sheets` 的 cell uid 网格；② `TavernDB_ACU_Data` 与 `TavernDB_ACU_IsolatedData.independentData` 的整表 `content`；③ `TavernDB_ACU_IsolatedData.storageFrame.logEntries` 里的 SQL 更新，在内存 SQLite 里按楼层顺序重放（按 INSERT 列名建表，`sql_batch` 的参数绑定执行）。答案在 NFKC 规范化、去掉空白/标点/符号后做包含判断。报告新增“ACU 对照组（表格覆盖）”章节（私有版与统计版）。3 个对话 386 题：覆盖 91（23.6%），状态题 88/236（37.3%），事件题 3/150（2.0%）；按答案长度：1 字符 27/33、2–3 字符 39/61、4–9 字符 25/69、10 字符以上 0/223。7 个新测试，`pnpm check` 通过（157 个测试）。

## 当前状态
- 门禁：`pnpm check` 通过（157 个测试）。
- `packages/st-compat/src/evalset/acu.ts`（从 `index.ts` 导出）：
  - `normalizeForTableMatch(text)`：NFKC、转小写、删掉 `\s`、`\p{P}`、`\p{S}`。
  - `evaluateAcuCoverage({chatPath, storyId, questions})`：单次流式读聊天文件；提问楼层取该楼层处理前的表格状态（消息序号 `< askIndex`）；返回 `applicable`、`snapshotFloorCount`、`byKind`、`byAnswerLength` 与总覆盖数。
  - `collectAcuBaseline({rawRoot, evalsetRoot})`：按 manifest 读 `state-<故事>.jsonl`（必需）与 `event-<故事>.jsonl`（可选）；没有表格数据的对话 `applicable=false`，不进入合计。
  - 表格来源语义：`hash_sheets` 是整份替换（后出现的消息覆盖前一份）；`TavernDB_ACU_Data` / `independentData` 按 sheet uid 合并；`storageFrame.logEntries` 只走 SQL 重放。`sheet_replace` 的 `content` 不参与快照，避免与 SQL 状态重复和过期。
  - `AcuTableDatabase`：`sql_sheet_batch` 用 `exec`，`sql_batch` 用参数绑定；表不存在时按第一条 INSERT 的列名建表（`row_id` 为 INTEGER PRIMARY KEY，其余 TEXT）；建表失败或语句出错直接抛错。
- `evalset/question-files.ts`：`RetrievalQuestion` 新增 `answer`，解析时接受字符串、数字、布尔值（数字/布尔转文本），空字符串报错。
- 体检报告：`renderPrivateReport(report, retrieval?, acu?)`、`renderPublicReport(report, retrieval?, acu?)` 新增第三个参数；`health/cli.ts` 先跑体检、检索基线、ACU 基线再写两份报告。统计版的 ACU 章节只出现“对话 N”。
- 依赖：`better-sqlite3` 与 `@types/better-sqlite3` 加到 `packages/st-compat`（`DEPENDENCIES.md` 已有登记，不需要新增行）。
- 测试：新增 `test/acu.test.ts`（7 个）与 `test/fixtures/acu/`（cells、sql、none 三套聊天与 manifest、typed-answers）；`retrieval` 测试与 fixture 补了 `answer` 字段；`fixtures/evalset/state-测试角色.jsonl` 也补了 `answer`。

## 下一步
- 执行 M0-REVIEW-1（代码与不变量审查）：按 TASKS 里的条目逐条核对，结论写 `docs/dev/reports/M0-review-1.md`，发现的问题转成 `M0-FIX-n` 插在任务下面。
- 之后 M0-T99（M0 验收）：汇总所有报告，逐条审查 I1–I10，确认 M1 任务清单。

## 注意事项
- ACU 覆盖率的数字要连带解释：事件题答案通常是长句，规范化后整句包含几乎不会命中；状态题里 1–3 字符的答案（例如 `是`、`0`、`2`）在表格里很容易偶然出现。报告里已经按答案长度分档，引用数字时不要只引合计。
- 当前 `.env` 指向 `opendesign/deepseek-v4.1-flash`（HUMAN-05 已完成）。M0-T13 没有调用 LLM；ACU 判定只用字符串匹配。
- `pnpm --filter @dramaticer/st-compat report` 现在会跑三件事：体检、检索基线、ACU 基线，耗时约 9 秒；需要 `eval-private/evalset/` 里已有状态题和事件题文件。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- 缓存按模型区分；换模型不会命中旧缓存。删除 `eval-private/llm-cache` 可以强制重新生成。缓存和评测集都包含私有正文，只能留在被 git 忽略的目录。
- 状态题核对依赖“空对象表示没有更新”的语义（ADR-0006）；改动 `readSnapshot` 或快照展开规则时，必须同时重新跑 `evalset`。
- 检索基线的阈值：固定 400 字符、重叠 80；改动分块大小会改变命中率，报告里记录了这两个数字。state 题普遍命中低是因为变量值不写在正文里，这是基线应有的结果，不要为了数字去调整题目。
- `pnpm check` 之前会先跑 `tsc -b`；改了 CLI 或报告后直接跑对应脚本即可，脚本自身也会先编译。
- 分类器对正则做静态分析，不执行正则；新增判定规则时先补合成用例。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
