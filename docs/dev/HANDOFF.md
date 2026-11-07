# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：13
- 任务：M0-T12 朴素 BM25 检索基线
- 结果：完成。core 新增 `src/retrieval/chunk-text.ts`（固定窗口分块，默认 400 字符、重叠 80）和 `src/retrieval/chunk-index.ts`（FTS5 trigram 块索引，查询侧取三字窗口用 OR 连接）；st-compat 新增 `evalset/retrieval.ts`（按题目在提问楼层之前检索、统计命中@5/10/20）和 `evalset/question-files.ts`（题目文件读取与文件名工具），体检报告新增检索基线章节。3 个对话 386 题：命中@5 = 126（32.6%），@10 = 143（37.0%），@20 = 153（39.6%）；事件题分别是 113/128/137（75.3%/85.3%/91.3%），状态题 13/15/16（5.5%/6.4%/6.8%）。16 个新测试，`pnpm check` 通过（invariants → typecheck → lint → 150 个测试）。

## 当前状态
- 门禁：`pnpm check` 通过（150 个测试）。
- core/retrieval（从 `index.ts` 导出）：
  - `chunkText(text, {maxChars, overlapChars})`：按 Unicode 码点切固定窗口，默认 400/80；空白文本返回空数组；不会拆开代理对。
  - `ChunkIndex`：`open(path = ":memory:")`，`add(chunks)`，`search(query, {storyId, nodeIds, limit})`，`count()`，`close()`。FTS5 表名 `chunk_text`，trigram 分词，`bm25()` 升序排序（分数越小越相关）。
  - `buildTrigramQuery(text)`：NFKC 后删除标点、符号和空白，生成全部连续三字窗口，`"..." OR "..."`；不足三字返回 null。
  - `search` 的 `nodeIds` 用 JSON `json_each` 过滤；传入空数组直接返回空结果。
- st-compat/evalset：
  - `question-files.ts`：`RetrievalQuestion`（id、story、askAtNode、question、evidenceNodes、kind）、`readQuestionFile`、`sanitizeFileName`、`storyIdOf`。状态题 CLI 和事件题 CLI 已改用这里的工具，删掉了各自的副本。
  - `retrieval.ts`：`evaluateRetrieval({chatPath, storyId, questions, maxChars?, overlapChars?})` 现场建块索引，只允许提问楼层之前的节点；`collectRetrievalBaseline({rawRoot, evalsetRoot})` 按 manifest 读 `state-<故事>.jsonl`（必需）和 `event-<故事>.jsonl`（可选），汇总每个对话、每种题型的命中数。
- 体检报告：
  - `health/manifest.ts`：从 `report.ts` 移出的 manifest 类型与读取函数；`report.ts` 继续 re-export，旧的 import 不用改。
  - `report.ts` 的 `renderPrivateReport(report, retrieval?)` 和 `renderPublicReport(report, retrieval?)` 接受可选的检索基线，追加“## 检索基线（BM25）”章节；统计版只显示“对话 N”，不出现故事名。
  - `health/cli.ts` 先跑体检，再跑检索基线，两个报告一起写。因此 `pnpm --filter @dramaticer/st-compat report` 现在要求 `eval-private/evalset/state-*.jsonl` 已经生成（M0-T10）。
- 数据核对：386 道题的所有 askAtNode 和 evidenceNodes 都是当前 swipe 的节点 id，块索引覆盖全部证据楼层（0 个缺失、0 个 swipe 不一致），所以基线数字没有受 swipe 影响。
- 依赖没有变化；core 不出现 ST 概念（I1）。`scripts/` 与 `tools/` 未修改。

## 下一步
- 执行 M0-T13（ACU 对照组）：先探测 `chat_metadata.sheets`、消息里的 `TavernDB_ACU_*`、`hash_sheets`，在提问楼层时刻取表格内容，用规范化字符串匹配判断答案是否出现；没有 ACU 数据的对话记“不适用”。把覆盖率写进 health（私有版和统计版）。
- 之后 M0-T99（M0 验收）：汇总所有报告，逐条审查 I1–I10，确认 M1 任务清单。
- M1 之前处理 HUMAN-05：后台渠道账号仍被停用；第三个对话用了 `auto/deepseek-v4.1-flash`。换模型会让 `eval-private/llm-cache` 全部失效。
- HUMAN-01 里的 antigravity 账号被停用属于上游封禁，不是代码问题，不要反复重试。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- 当前 `.env` 仍指向已停用的 `antigravity/gemini-3.8-flash`。临时换模型用命令行环境变量覆盖，例如 `DRAMATICER_BG_MODEL=auto/deepseek-v4.1-flash pnpm --filter @dramaticer/st-compat evalset:events`。
- 缓存按模型区分；换模型不会命中旧缓存。删除 `eval-private/llm-cache` 可以强制重新生成。缓存和评测集都包含私有正文，只能留在被 git 忽略的目录。
- 状态题核对依赖“空对象表示没有更新”的语义（ADR-0006）；改动 `readSnapshot` 或快照展开规则时，必须同时重新跑 `evalset`。
- 检索基线的阈值：固定 400 字符、重叠 80；改动分块大小会改变命中率，报告里记录了这两个数字。state 题普遍命中低是因为变量值不写在正文里，这是基线应有的结果，不要为了数字去调整题目。
- `pnpm check` 之前会先跑 `tsc -b`；改了 CLI 或报告后直接跑对应脚本即可，脚本自身也会先编译。
- 分类器对正则做静态分析，不执行正则；新增判定规则时先补合成用例。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
