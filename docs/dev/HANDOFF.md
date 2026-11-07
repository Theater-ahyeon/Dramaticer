# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：21
- 任务：M0-FIX-6 存储层校验与测试资源清理
- 结果：完成。
  - `packages/core/src/store/story-store.ts`：`getStateDiffs` 先查节点，不存在抛 `楼层节点不存在：<id>`；新增 `assertStateDiffPath`，`rowToStateDiff` 与 `#normaliseStateDiff` 共用它校验 `path` 是非空字符串组成的非空数组（读取时错误信息带 diff id）；删除零调用的 `getLatestSchemaVersion` 与对应的 `LATEST_SCHEMA_VERSION` import。
  - `packages/core/src/store/migrations.ts`：`applyMigrations(db, migrations = MIGRATIONS)` 入口先执行 `assertMigrationSequence`，要求第 i 项版本号恰好是 i + 1，否则抛出“迁移列表第 N 项的版本号必须是 X，实际为 Y”；版本上限由传入列表的最后一项决定。
  - `packages/core/test/store.test.ts`：版本过高用例注册 `onTestFinished` 清理临时目录；新增“版本号不连续抛错”“读取不存在楼层的 diff 抛错”“存储里的 path 非法抛错（空数组与非字符串元素各一次，直接走原生连接写入）”三个用例；仓库里 43 个 `.tmp-store-*` 已删除。
- 验证：`pnpm check` 通过（193 个测试）；重跑测试后 `packages/core/test/` 下没有新增 `.tmp-store-*`。

## 当前状态
- 门禁：`pnpm check` 通过（193 个测试）。
- 存储：schema 迁移列表版本号必须从 1 连续递增；`getStateDiffs` 与 `getStateDiffsAlongPath` 对不存在的楼层都抛错；diff 的 `path` 在写入与读取两侧都校验。
- ACU 对照组：快照是单元格值列表，逐值规范化后判断包含；提问楼层不在对话里直接抛错。
- 检索：写入与查询共用 `normalizeRetrievalText`；检索评测按 `nodeId` 去重；`askAtNode` 越界抛错。
- 聊天解析：`parseChatJsonl` 只剥离首行的 BOM；`parseChatJsonlFile` 的错误包装为“解析聊天文件失败：<path>”。
- 角色卡：PNG 文本块先做 base64 规范化回环校验，再做 JSON 解析。
- LLM 客户端：`LlmRequest.signal` 贯穿请求、退避与限速等待。
- TASKS：M0-FIX-1 到 M0-FIX-6 已标记 `[x]`；M0-FIX-7 到 M0-FIX-11 待做；M0-T99 依赖全部 M0 任务。
- 工作区有一处**人类未提交的改动**：`scripts/check-invariants.mjs` 已按 HUMAN-06 修改（I1 关键词增加 `marker` 与 `worldInfo\w*`，I10 扫描 `test` 目录下全部文件），本次没有纳入提交，也没有修改该文件；HUMAN-06 的状态行仍由人类更新。

## 下一步
- 执行 M0-FIX-7（体检报告口径与 CLI 入口）：`HealthTotals` 增加 `headerBytes` 并在统计版表中单列；字段字节统计保留全量、截断只放渲染层；`extraSwipeCount` 按每条消息累加 `max(0, swipes.length - 1)`（或删除字段）；`ratio` 对 `0/0` 返回 `null` 并显示 `—`；删除 `totals.rawBytes` 或纳入报告；合并 `health/report.ts` 对 `health/manifest.ts` 的再导出；把 `health/cli.ts` 抽成可注入路径的 `runHealthCli` 并测试，覆盖 `renderAcuSection` 与 `collectHealthReport` 的两条抛错分支。完成后重新生成两份报告并跑 `pnpm check`。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期，M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 10 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。单独重跑只改生成时间时不要把时间差异带进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
