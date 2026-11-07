# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：15
- 任务：M0-REVIEW-1 代码与不变量审查
- 结果：完成。按 7 个只读切片审查 `packages/core`、`packages/st-compat`、`scripts/`（core 存储、core 模型客户端与检索、ST 解析、导入与状态 diff、正则分类器与体检报告、评测集与脚本、文档与覆盖）。结论写入 `docs/dev/reports/M0-review-1.md`：I1–I10 逐条给出判断依据（I1、I2、I4、I5、I8、I10 符合；I3 部分符合；I6、I7、I9 在 M0 没有实现路径，标为不适用），32 条代码问题、7 条文档不同步、测试覆盖缺口清单。发现问题转成 M0-FIX-1 到 M0-FIX-11；`scripts/check-invariants.mjs` 的两处覆盖缺口按约定写进 HUMAN-06。没有修改任何代码；`pnpm check` 通过（157 个测试）。

## 当前状态
- 门禁：`pnpm check` 通过（157 个测试）。
- 审查报告：`docs/dev/reports/M0-review-1.md`。按严重程度的三条结论：
  - ACU 覆盖率把相邻单元格用换行拼成一段文本再删掉空白，`集市` + `时间` 会拼成 `集市时间`，导致命中误报；386 题的 ACU 覆盖数字（91）在 M0-FIX-5 之前不能引用。
  - ST 聊天导入不是事务：文件末尾坏行或非法快照抛错后，已写入的故事、楼层、diff 留在库里，同一 `storyId` 无法重试。
  - 检索命中按块计数，同一楼层的多个块可以占满 top-5/10/20；跨 `maxChars` 配置的命中率不可比。
- TASKS：M0-REVIEW-1 已标记 `[x]`；下面新增 M0-FIX-1 到 M0-FIX-11，依赖关系写在每条任务里。M0-T99 依赖全部 M0 任务，排在最后。
- 门禁脚本（受保护，未改）：HUMAN-06 记录 I1 关键词缺 `marker`、I10 不扫描 test 目录里的 fixture 与辅助模块。

## 下一步
- 执行 M0-FIX-1（导入原子性与状态快照）：先写测试，再改 `chat-import.ts`、`chat-jsonl.ts`、`state-diff.ts` 相关语义。之后按依赖顺序做 M0-FIX-2 到 M0-FIX-11，最后 M0-T99。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- ACU 与检索的修复会改变 `docs/dev/reports/M0-health.md` 里的数字。M0-FIX-4、M0-FIX-5 跑完必须重新生成两份报告，M0-FIX-11 顺手清理 TASKS、LOG 里过期的计数。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期（7 个测试实际 8 个、47.8% 实际 20.8%、9 个实际 8 个），M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- 缓存按模型与 `baseUrl` 区分；改动提示词会改变缓存键。删 `eval-private/llm-cache` 可以强制重新生成。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 9 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- `packages/core/test/` 下有 28 个 `.tmp-store-*` 残留目录（被 git 忽略），M0-FIX-6 会清理并补上测试清理逻辑。
