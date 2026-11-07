# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：24
- 任务：M0-FIX-9 评测集 CLI 与题目文件
- 结果：完成。
  - `packages/st-compat/src/evalset/question-files.ts`：`readQuestionFile` 用 `Map` 记录首次出现的行号，重复 `id` 抛错并同时给出两处 `文件:行号`；新增 `sampleDeterministic`，按题目 `id` 的 FNV-1a 哈希排序后取前 N 个（返回时保持输入顺序）。
  - `event-questions.ts`：`parseModelQuestions` 返回 `{ items, rejected }`，非对象、缺字段或类型不符的条目逐条写入 `failures`；模型返回空数组时每个窗口记“模型输出里没有题目”。`EventQuestionStats` 删除 `messageCount`、`floorCount`、`questionCount`。
  - `evalset/cli.ts`：拆成瘦入口；新增 `state-cli.ts`，导出 `assertStateQuestionCount`、`writeStateSummary` 与可注入 `rawRoot`/`outputRoot`/`generatedAt` 的 `runStateQuestionsCli`，状态题核对抽样改用 `sampleDeterministic`。
  - `evalset/event-cli.ts`：新增 `env.ts` 的 `loadDotEnv`（`.env` 缺失直接抛错并带路径）；抽查改用 `sampleDeterministic`；输出路径由 `event-output.ts` 的 `eventSpotcheckPath`/`eventSummaryPath` 决定，`--story` 只写 `spotcheck-<故事>.md` 与 `event-summary-<故事>.json`，全量运行才写 `spotcheck.md` 与 `event-summary.json`；`renderSpotcheck` 接收注入的生成时间。
  - `evalset/shared.ts`：`requireNonEmpty`（统一按 `trim()` 判空）与 `emptyCounts`/`addCounts`，acu、retrieval、event-questions、state-questions 的重复实现已删除。
  - 测试：新增 `question-files.test.ts`、`state-cli.test.ts`、`event-cli.test.ts`；`event-questions.test.ts` 补解析失败、空数组与 `*FromFile`；`state-questions.test.ts` 补 `*FromFile`。共 19 个新用例。
- 验证：`pnpm check` 通过（221 个测试）。用临时脚本核对 `eval-private/evalset/*.jsonl`，现有题目没有重复 `id`，脚本已删除。

## 当前状态
- 门禁：`pnpm check` 通过（221 个测试）。
- 题目文件：`readQuestionFile` 拒绝重复 `id`；`sampleDeterministic` 的结果只由题目 `id` 集合决定，与运行次数无关。
- 事件题：解析阶段的坏条目会进入 `failures`；`EventQuestionStats` 只保留 CLI 读取的字段。
- 评测 CLI：`state-cli.ts` 承载状态题生成与 `summary.json` 写出；`event-cli.ts` 的 `--story` 不再覆盖全局抽查与汇总。
- 环境加载：`evalset/env.ts` 的 `loadDotEnv` 要求 `.env` 存在，错误信息包含绝对路径。
- 体检报告：统计版单列头部字节；每对话字段统计是全量，合计表取前 10；比率为 0/0 时显示 `—`；`runHealthCli` 可注入路径与时间；token 估算把谚文计入 CJK。
- 正则分类：升级判断只把启用的兄弟脚本视为渲染器；分类结果没有 `unclassified` 的兜底分支，空正则之外的剩余情况都是 `text_replace`。
- 存储：schema 迁移列表版本号必须从 1 连续递增；`getStateDiffs` 与 `getStateDiffsAlongPath` 对不存在的楼层都抛错；diff 的 `path` 在写入与读取两侧都校验。
- ACU 对照组：快照是单元格值列表，逐值规范化后判断包含；提问楼层不在对话里直接抛错。
- 检索：写入与查询共用 `normalizeRetrievalText`；检索评测按 `nodeId` 去重；`askAtNode` 越界抛错。
- 聊天解析：`parseChatJsonl` 只剥离首行的 BOM；`parseChatJsonlFile` 的错误包装为“解析聊天文件失败：<path>”。
- 角色卡：PNG 文本块先做 base64 规范化回环校验，再做 JSON 解析。
- LLM 客户端：`LlmRequest.signal` 贯穿请求、退避与限速等待。
- TASKS：M0-FIX-1 到 M0-FIX-9 已标记 `[x]`；M0-FIX-10、M0-FIX-11 待做；M0-T99 依赖全部 M0 任务。

## 下一步
- 执行 M0-FIX-10（manifest 完整性校验）：`health/manifest.ts` 保留 `size` 与 `sha256`；读取 raw 前用 `stat` 与流式哈希比对，不一致时指出 `target` 抛错；`collectHealthReport`、`collectRetrievalBaseline`、`collectAcuBaseline`、`evalset/cli.ts`（现为 `state-cli.ts`）、`evalset/event-cli.ts` 统一走同一入口。补“篡改 raw 文件后 report 抛错并指出 target”的测试（临时目录构造）。
- 之后是 M0-FIX-11（依赖声明与文档同步）和 M0-T99（M0 验收）。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期，M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 10 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。单独重跑只改生成时间时不要把时间差异带进提交。
- `health/cli.ts` 的入口判断是 `import.meta.url === pathToFileURL(process.argv[1]).href`；测试导入它不会执行 `main`。`evalset/event-cli.ts` 仍在导入时执行，只测试它拆出的 `env.ts` 与 `event-output.ts`。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
