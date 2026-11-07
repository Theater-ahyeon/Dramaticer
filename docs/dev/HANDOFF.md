# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：18
- 任务：M0-FIX-3 后台 LLM 客户端重试与中止
- 结果：完成。`packages/core/src/llm/client.ts`：
  - 2xx 响应体解析只把 `SyntaxError` 包装成 `LlmResponseError("渠道返回的不是 JSON：…")`，且不重试；中止、超时等读取错误原样抛出，`readPayload` 是唯一读取入口。
  - 重试循环改为 `for (let attempt = 1; ; …)`，删除循环末尾不可达的 `throw lastError` 与 `shouldRetry` 里的 `LlmResponseError` 分支；可重试的错误只剩 429/5xx 与 `TimeoutError`/`TypeError`，`AbortError` 不再重试。
  - 新增 `maxRetryAfterMs`（默认 60000）；`backoff` 用 `Math.min(Retry-After, maxRetryAfterMs)`，退避与限速等待统一走 `wait(ms, signal)`，先 `throwIfAborted` 再把信号交给 `sleep`；默认 `sleep` 是 `timers/promises` 的 `delay(ms, undefined, { signal })`。
  - `acquireSlot(signal)` 在排队与等待阶段都检查中止，被中止时不推进 `nextAllowedAt`。
  - 缓存键改为 sha256(`baseUrl` + "\n" + sha256(`apiKey`) + "\n" + `stableJson(body)`)，缓存内容仍不含密钥。
  - `stableJson` 与 `JSON.stringify` 语义一致：纯对象按键排序、值为 `undefined` 的属性丢弃，稀疏数组空位与 `undefined` 变 `null`，`Date` 与带 `toJSON` 的非纯对象交给 `JSON.stringify`。
- 测试：`packages/core/test/llm-client.test.ts` 新增 13 个用例（2xx 非 JSON 单次请求、非语法读取错误原样抛出、退避等待响应中止、已中止信号不发请求、`Retry-After` 上限、`undefined` 属性与 `Date` 影响缓存键、`apiKey` 影响缓存键、`parseCompletion` 四个错误分支、5xx 重试恢复、5xx 用尽抛 `status`/`body`）。`pnpm check` 通过（23 个测试文件，179 个测试）。
- 冒烟：用 `dist` 与真实默认 `sleep` 跑 `.devloop/scratch` 下的临时脚本（已删除），确认中止在 15ms 内以 `AbortError` 结束、2xx 非 JSON 只发一次请求、5xx 用尽抛出带 `status`/`body` 的 `LlmHttpError`。
- ADR：`docs/dev/DECISIONS.md` 的 ADR-0007 已改为最终行为（重试范围、`Retry-After` 上限、缓存键含 `baseUrl` 与 apiKey 摘要、2xx 非 JSON 不重试）。

## 当前状态
- 门禁：`pnpm check` 通过（179 个测试）。
- 存储：`StoryStore.runInTransaction<T>(fn)` 是唯一的显式事务入口；`appendStateDiffs` 内部用 `db.transaction`，嵌套时走 savepoint。
- 聊天解析：`parseChatJsonl` 只剥离首行的 BOM；`parseChatJsonlFile` 的错误包装为“解析聊天文件失败：<path>”。
- 角色卡：`isPngData` 是模块内函数；PNG 文本块先做 base64 规范化回环校验，再做 JSON 解析。
- LLM 客户端：`LlmRequest.signal` 贯穿请求、退避与限速等待；`sleep` 选项的签名是 `(ms, signal) => Promise<void>`；`LlmClient` 接口未变。
- TASKS：M0-FIX-1、M0-FIX-2、M0-FIX-3 已标记 `[x]`；M0-FIX-4 到 M0-FIX-11 待做；M0-T99 依赖全部 M0 任务。
- 门禁脚本（受保护，未改）：HUMAN-06 记录 I1 关键词缺 `marker`、I10 不扫描 test 目录里的 fixture 与辅助模块。

## 下一步
- 执行 M0-FIX-4（检索规范化与命中口径）：先读 `packages/core/src/retrieval/chunk-index.ts`、`packages/core/src/retrieval/chunk-text.ts`、`packages/st-compat/src/evalset/retrieval.ts` 与对应测试，让写入与查询共用同一套规范化，按 `nodeId` 保序去重后取前 K，`askAtNode` 越界抛错，补分块与索引边界用例，然后重新跑 `pnpm --filter @dramaticer/st-compat report` 并更新两份报告里的命中数字，最后 `pnpm check`。

## 注意事项
- 缓存键已包含 apiKey 摘要，`eval-private/llm-cache` 里旧键的文件不会命中；重新生成事件题会真实调用渠道。已有 `eval-private/evalset/` 的题目文件不受影响，M0 的修复任务不需要重新生成。
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- ACU 与检索的修复会改变 `docs/dev/reports/M0-health.md` 里的数字。M0-FIX-4、M0-FIX-5 跑完必须重新生成两份报告；单独跑 report 只会改生成时间，不要把这个时间戳差异带进提交。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期（7 个测试实际 8 个、47.8% 实际 20.8%、9 个实际 8 个），M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 9 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- `packages/core/test/` 下有 28 个 `.tmp-store-*` 残留目录（被 git 忽略），M0-FIX-6 会清理并补上测试清理逻辑。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
