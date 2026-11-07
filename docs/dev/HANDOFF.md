# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：16
- 任务：M0-FIX-1 导入原子性与状态快照
- 结果：完成。`packages/core/src/store/story-store.ts` 新增 `runInTransaction`（显式 `BEGIN IMMEDIATE`，回调可以跨越异步边界，失败时 `ROLLBACK` 并原样抛出），`packages/st-compat/src/chat-import.ts` 的整次导入放在这个事务里，坏行、非法快照或非法 `swipe_id` 都不会在库里留下故事、楼层、diff 或 FTS 条目。`chat-jsonl.ts` 在解析阶段校验 `swipe_id`（非负整数且小于 swipe 数），`node-id.ts` 的 `currentSwipeIndex` 直接使用校验后的值，节点 id 与 MVU 快照下标一致。新增 6 个测试：事务回滚与提交、`swipe_id` 越界与非整数、坏行在文件末尾回滚并重新导入、导入后越界 swipe 无残留、嵌套空对象生成删除 diff、状态题答案与 store 回放一致；测试辅助 `packages/st-compat/test/store-replay.ts` 提供 `replayDiffs`/`snapshotAt`。`pnpm check` 通过（23 个测试文件，163 个测试），`pnpm --filter @dramaticer/st-compat report` 在真实快照上跑通，数字与上一版一致。

## 当前状态
- 门禁：`pnpm check` 通过（163 个测试）。
- 存储：`StoryStore.runInTransaction<T>(fn)` 是唯一的显式事务入口；`appendStateDiffs` 仍在内部用 `db.transaction`，嵌套时走 savepoint。
- 导入：失败路径全部回滚；`swipe_id` 非法直接在解析层抛错（错误信息带行号）。
- TASKS：M0-FIX-1 已标记 `[x]`；M0-FIX-2 到 M0-FIX-11 待做，依赖关系写在每条任务里；M0-T99 依赖全部 M0 任务。
- 门禁脚本（受保护，未改）：HUMAN-06 记录 I1 关键词缺 `marker`、I10 不扫描 test 目录里的 fixture 与辅助模块。

## 下一步
- 执行 M0-FIX-2（聊天与角色卡解析边界）：先读 `chat-jsonl.ts`、`character-card.ts`、`field-readers.ts` 与两个测试文件，按任务里的验收标准补 BOM 用例与 PNG 失败路径测试，删除没有消费者的导出和 `stripCarriageReturn`，然后 `pnpm check`。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- ACU 与检索的修复会改变 `docs/dev/reports/M0-health.md` 里的数字。M0-FIX-4、M0-FIX-5 跑完必须重新生成两份报告；本次跑 report 只改了生成时间，已手工恢复，不要把这个时间戳差异带进提交。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期（7 个测试实际 8 个、47.8% 实际 20.8%、9 个实际 8 个），M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- 缓存按模型与 `baseUrl` 区分；改动提示词会改变缓存键。删 `eval-private/llm-cache` 可以强制重新生成。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 9 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- `packages/core/test/` 下有 28 个 `.tmp-store-*` 残留目录（被 git 忽略），M0-FIX-6 会清理并补上测试清理逻辑。
