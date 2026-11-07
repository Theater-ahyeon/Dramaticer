# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：20
- 任务：M0-FIX-5 ACU 快照逐单元格判定
- 结果：完成。
  - `packages/st-compat/src/evalset/acu.ts`：`collectSnapshotText` 换成 `collectSnapshotValues`，返回表格值列表。三处来源都按单元格收集：`hash_sheets` 行里的 uid 对应单元格值、`TavernDB_ACU_Data` 的整表内容（`collectSheetContents` 存 `readonly string[]`，原 `renderRows` 拆成 `collectCellValues`）、`AcuTableDatabase.values()`（原 `dump()`）。匹配时每个值单独 `normalizeForTableMatch`，`tableValues.some(value => value.includes(answerText))`；相邻单元格不再拼接。
  - 沿用问题进行中的楼层记录 `seenFloors`；流式读完后把没出现过的提问楼层汇总抛错：`故事 <story> 缺少提问楼层：<nodeId>（题目 <id>、<id>）`。
  - `packages/st-compat/src/health/report.ts`：ACU 章节与公共说明改成“每个单元格和答案分别规范化后判断答案是否出现在某一个单元格里”。
  - 测试：`acu.test.ts` 新增 2 个用例——相邻单元格 fixture（`test/fixtures/acu/adjacent/chat.jsonl`，只有 `集市` 与 `时间` 两个单元格）上 `集市时间` 未命中而 `集市` 命中；越界 `askAtNode` 抛错且消息带楼层与题目 id。
- 冒烟：`pnpm --filter @dramaticer/st-compat report` 重跑成功，检索命中仍是 141/156/163，ACU 覆盖仍是 91/386（状态题 88/236、事件题 3/150，按答案长度 27/33、39/61、25/69、0/223）。真实数据里没有答案依赖相邻单元格拼接，数字不变。
- 报告：`docs/dev/reports/M0-health.md` 与私有版 `eval-private/reports/health.md` 已重新生成，只改了 ACU 段落措辞与生成时间。

## 当前状态
- 门禁：`pnpm check` 通过（190 个测试）。
- ACU 对照组：快照是单元格值列表，逐值规范化后判断包含；提问楼层不在对话里直接抛错。
- 检索：写入与查询共用 `normalizeRetrievalText`；检索评测按 `nodeId` 去重；`askAtNode` 越界抛错。
- 存储：`StoryStore.runInTransaction<T>(fn)` 是唯一的显式事务入口；`appendStateDiffs` 内部用 `db.transaction`，嵌套时走 savepoint。
- 聊天解析：`parseChatJsonl` 只剥离首行的 BOM；`parseChatJsonlFile` 的错误包装为“解析聊天文件失败：<path>”。
- 角色卡：`isPngData` 是模块内函数；PNG 文本块先做 base64 规范化回环校验，再做 JSON 解析。
- LLM 客户端：`LlmRequest.signal` 贯穿请求、退避与限速等待；`sleep` 选项的签名是 `(ms, signal) => Promise<void>`；`LlmClient` 接口未变。
- TASKS：M0-FIX-1 到 M0-FIX-5 已标记 `[x]`；M0-FIX-6 到 M0-FIX-11 待做；M0-T99 依赖全部 M0 任务。
- 门禁脚本（受保护，未改）：HUMAN-06 记录 I1 关键词缺 `marker`、I10 不扫描 test 目录里的 fixture 与辅助模块。

## 下一步
- 执行 M0-FIX-6（存储层校验与测试资源清理）：`getStateDiffs` 对不存在的楼层抛错；`applyMigrations` 入口校验 `MIGRATIONS[i].version === i + 1`；`rowToStateDiff` 校验 `path` 是非空字符串数组；删除 `getLatestSchemaVersion`；`store.test.ts` 的版本测试注册临时目录清理，并清理仓库里已积累的 `packages/core/test/.tmp-store-*` 目录（当前 43 个，被 git 忽略）。补“存在性抛错、乱序迁移列表抛错、非法 path 抛错”用例后跑 `pnpm check`。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期（7 个测试实际 8 个、47.8% 实际 20.8%、9 个实际 8 个），M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 10 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。单独重跑只改生成时间时不要把时间差异带进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
