# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：19
- 任务：M0-FIX-4 检索规范化与命中口径
- 结果：完成。
  - `packages/core/src/retrieval/chunk-index.ts` 新增导出 `normalizeRetrievalText`（NFKC 后去掉 `\p{P}`、`\p{S}`、空白）。`ChunkIndex.add` 写入规范化后的文本，规范化结果为空的块跳过；`buildTrigramQuery` 用同一函数，查询与索引口径一致。`buildTrigramQuery` 不再接受非字符串输入（错误由 `normalizeRetrievalText` 抛出）。
  - `packages/st-compat/src/evalset/retrieval.ts` 检索结果先按 `nodeId` 保序去重再取前 K；`askAtNode` 解析出的楼层下标在 `nodeIdByIndex` 中不存在时抛出 `题目 <id> 的提问楼层 <nodeId> 超出故事 <story> 的楼层范围`。
  - `packages/st-compat/src/health/report.ts` 的检索章节说明补上写入与查询共用规范化、同一楼层只占一个位次。
- 测试：`chunk-text.test.ts` 新增 4 个边界用例（长度等于 `maxChars`、`maxChars + 1`、末尾残片小于步长、`\r\n` 归一化），非法参数改为按消息断言；`chunk-index.test.ts` 新增 3 个用例（全角写入与带标点查询命中、纯标点块不写入、重复写入保留两条记录），非法参数按消息断言并覆盖 `limit` 上限；`retrieval.test.ts` 新增 2 个用例（同一楼层多个块只占一个位次、越界 `askAtNode` 抛错），配 fixture `packages/st-compat/test/fixtures/retrieval-dup-chat.jsonl`。`pnpm check` 通过（23 个测试文件，188 个测试）。
- 冒烟：`pnpm --filter @dramaticer/st-compat report` 用真实快照重跑，检索命中从 126/143/153 升到 141/156/163（@5/@10/@20）；对话 2 的块数从 3548 变成 3547，因为一个只有标点的块规范化后为空，不再写入索引。
- 报告：`docs/dev/reports/M0-health.md` 已随报告重新生成，ACU 数字未变（91/386）。

## 当前状态
- 门禁：`pnpm check` 通过（188 个测试）。
- 检索：写入与查询共用 `normalizeRetrievalText`；检索评测按 `nodeId` 去重；`askAtNode` 越界抛错。
- 存储：`StoryStore.runInTransaction<T>(fn)` 是唯一的显式事务入口；`appendStateDiffs` 内部用 `db.transaction`，嵌套时走 savepoint。
- 聊天解析：`parseChatJsonl` 只剥离首行的 BOM；`parseChatJsonlFile` 的错误包装为“解析聊天文件失败：<path>”。
- 角色卡：`isPngData` 是模块内函数；PNG 文本块先做 base64 规范化回环校验，再做 JSON 解析。
- LLM 客户端：`LlmRequest.signal` 贯穿请求、退避与限速等待；`sleep` 选项的签名是 `(ms, signal) => Promise<void>`；`LlmClient` 接口未变。
- TASKS：M0-FIX-1 到 M0-FIX-4 已标记 `[x]`；M0-FIX-5 到 M0-FIX-11 待做；M0-T99 依赖全部 M0 任务。
- 门禁脚本（受保护，未改）：HUMAN-06 记录 I1 关键词缺 `marker`、I10 不扫描 test 目录里的 fixture 与辅助模块。

## 下一步
- 执行 M0-FIX-5（ACU 快照逐单元格判定）：先读 `packages/st-compat/src/evalset/acu.ts` 与 `packages/st-compat/test/acu.test.ts`、`fixtures/acu/`，把单元格历史与 SQL 重放都改成返回值列表，逐值规范化后判断包含；提问楼层在聊天里不存在时抛出并列出题目 id；补“只有 `集市` 与 `时间` 两个单元格时 `集市时间` 不命中、`集市` 命中”的负例，然后 `pnpm --filter @dramaticer/st-compat report` 更新两份报告的 ACU 数字，最后 `pnpm check`。

## 注意事项
- 检索规范化会改变命中数字；M0-FIX-5 之后 ACU 数字也会变。每次跑 report 都会更新 `docs/dev/reports/M0-health.md`，单独重跑只改生成时间的差异不要带进提交。
- `ChunkIndex.add` 会跳过规范化后为空的块；`chunkCount` 报告的是实际写入索引的块数。
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期（7 个测试实际 8 个、47.8% 实际 20.8%、9 个实际 8 个），M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 10 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- `packages/core/test/` 下有 28 个 `.tmp-store-*` 残留目录（被 git 忽略），M0-FIX-6 会清理并补上测试清理逻辑。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
