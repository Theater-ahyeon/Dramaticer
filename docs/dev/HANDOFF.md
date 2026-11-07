# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：17
- 任务：M0-FIX-2 聊天与角色卡解析边界
- 结果：完成。`packages/st-compat/src/chat-jsonl.ts` 在首行解析前剥离一个 U+FEFF，`splitChatLines` 的两处内联 `\r` 处理改为调用 `stripCarriageReturn`；`packages/st-compat/src/character-card.ts` 改用 `field-readers.ts` 的 `readString`/`optionalString`/`readStringList`/`optionalObject`/`readObject`，删除本地 `readText`/`optionalText`/`readTextList`/`expectObject`/`readCharacterBook`/`readExtensions`，PNG 载荷解码增加 base64 回环校验（不合法时抛“PNG 里的角色卡数据不是合法 base64”）；`SourceLine`、`splitChatLines`、`isPngData`、`SnapshotDiffOp` 不再导出（`SnapshotDiffOp` 无引用，直接删除），因此 `src/index.ts` 也不再公开它们。`test/png-fixture.ts` 增加 `raw` 选项按 ISO-8859-1 原样写入 tEXt 文本。新增 3 个测试：BOM 覆盖 `parseChatJsonl`（整体与任意切分）与 `parseChatJsonlFile`、tEXt 解码失败、非法 base64。`pnpm check` 通过（23 个测试文件，166 个测试）；用 `dist` 对 `eval-private/raw/cards` 下的 3 张真实卡跑过解析，全部是 `chara_card_v3` 且带内嵌世界书。

## 当前状态
- 门禁：`pnpm check` 通过（166 个测试）。
- 存储：`StoryStore.runInTransaction<T>(fn)` 是唯一的显式事务入口；`appendStateDiffs` 内部用 `db.transaction`，嵌套时走 savepoint。
- 聊天解析：`parseChatJsonl` 只剥离首行的 BOM；后续行的 U+FEFF 视为普通字符（合法 JSON 里不会出现在对象开头）。`parseChatJsonlFile` 的错误仍包装为“解析聊天文件失败：<path>”。
- 角色卡：`isPngData` 是模块内函数；PNG 文本块先做 base64 规范化回环校验，再做 JSON 解析，两类错误文案不同。
- TASKS：M0-FIX-1、M0-FIX-2 已标记 `[x]`；M0-FIX-3 到 M0-FIX-11 待做，依赖关系写在每条任务里；M0-T99 依赖全部 M0 任务。
- 门禁脚本（受保护，未改）：HUMAN-06 记录 I1 关键词缺 `marker`、I10 不扫描 test 目录里的 fixture 与辅助模块。

## 下一步
- 执行 M0-FIX-3（后台 LLM 客户端重试与中止）：先读 `packages/core/src/llm/client.ts` 与 `packages/core/test/llm-client.test.ts`，按任务里的验收标准改错误分类、中止、`Retry-After` 上限、缓存键、`stableJson`，并补六组用例，然后 `pnpm check`。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- ACU 与检索的修复会改变 `docs/dev/reports/M0-health.md` 里的数字。M0-FIX-4、M0-FIX-5 跑完必须重新生成两份报告；单独跑 report 只会改生成时间，不要把这个时间戳差异带进提交。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期（7 个测试实际 8 个、47.8% 实际 20.8%、9 个实际 8 个），M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- 缓存按模型与 `baseUrl` 区分；改动提示词会改变缓存键。删 `eval-private/llm-cache` 可以强制重新生成。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 9 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- `packages/core/test/` 下有 28 个 `.tmp-store-*` 残留目录（被 git 忽略），M0-FIX-6 会清理并补上测试清理逻辑。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
