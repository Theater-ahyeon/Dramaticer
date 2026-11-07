# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：22
- 任务：M0-FIX-7 体检报告口径与 CLI 入口
- 结果：完成。
  - `packages/st-compat/src/health/report.ts`：`HealthTotals` 用 `headerBytes` 取代未渲染的 `rawBytes`，`sumChats` 累加头部字节；统计版对话表增加“头部字节”列，合计行同步；`ratio` 对 `0/0` 返回 `null`，`formatPercent` 打印 `—`；删除对 `health/manifest.js` 的再导出。
  - `packages/st-compat/src/health/chat-health.ts`：`fieldBytes` 不再按对话截断前 10（截断只在 `aggregateFields` 渲染时做）；删除零消费者的 `extraSwipeCount`。
  - `packages/st-compat/src/health/cli.ts`：抽出 `runHealthCli`，接收 `rawRoot`、`evalsetRoot`、两份报告路径、`generatedAt` 与 `log`；只有 `node dist/health/cli.js` 直接运行时才执行 `main`。
  - `packages/st-compat/src/evalset/cli.ts`、`event-cli.ts`：manifest 改从 `../health/manifest.js` 导入。
  - 测试：`report.test.ts` 补合计差额小于 1%、第 11 名字段 fixture（`test/fixtures/health-fields/`）、ACU 段渲染与 `—`、私有标识整表反向断言、`collectHealthReport` 两条抛错分支；新增 `test/health-cli.test.ts`；`chat-health.test.ts` 删除 `extraSwipeCount` 断言。7 个新用例。
- 验证：`pnpm check` 通过（200 个测试）；`pnpm --filter @dramaticer/st-compat report` 重新生成两份报告，统计版合计 66,397,069 字节，与头部/正文/变量/其他之和的差额是 1,222 个行分隔符。

## 当前状态
- 门禁：`pnpm check` 通过（200 个测试）。
- 体检报告：统计版单列头部字节；每对话字段统计是全量，合计表取前 10；比率为 0/0 时显示 `—`；`runHealthCli` 可注入路径与时间，CLI 导入不产生副作用。
- 存储：schema 迁移列表版本号必须从 1 连续递增；`getStateDiffs` 与 `getStateDiffsAlongPath` 对不存在的楼层都抛错；diff 的 `path` 在写入与读取两侧都校验。
- ACU 对照组：快照是单元格值列表，逐值规范化后判断包含；提问楼层不在对话里直接抛错。
- 检索：写入与查询共用 `normalizeRetrievalText`；检索评测按 `nodeId` 去重；`askAtNode` 越界抛错。
- 聊天解析：`parseChatJsonl` 只剥离首行的 BOM；`parseChatJsonlFile` 的错误包装为“解析聊天文件失败：<path>”。
- 角色卡：PNG 文本块先做 base64 规范化回环校验，再做 JSON 解析。
- LLM 客户端：`LlmRequest.signal` 贯穿请求、退避与限速等待。
- TASKS：M0-FIX-1 到 M0-FIX-7 已标记 `[x]`；M0-FIX-8 到 M0-FIX-11 待做；M0-T99 依赖全部 M0 任务。

## 下一步
- 执行 M0-FIX-8（正则分类器与统计参数）：`hasRenderSibling` 跳过 `disabled` 的兄弟脚本；删除 `classifyCore` 里不可达的最后一个分支；`analyzeDuplication` 入口统一校验 `ngramSize`、`windowSize`、`step`、`riseWindows` 为正整数；`token-estimate` 补谚文区间；`countMacros` 取消导出（测试改用 `scanMacros`），`REGEX_CATEGORY_ORDER` 取消导出。完成后重新生成两份报告并跑 `pnpm check`。
- 之后依次是 M0-FIX-9（评测集 CLI 与题目文件）、M0-FIX-10（manifest 的 `size`/`sha256` 校验）、M0-FIX-11（依赖声明与文档同步）、M0-T99（M0 验收）。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期，M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 10 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。单独重跑只改生成时间时不要把时间差异带进提交。
- `health/cli.ts` 的入口判断是 `import.meta.url === pathToFileURL(process.argv[1]).href`；测试导入它不会执行 `main`。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
