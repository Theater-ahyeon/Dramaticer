# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：23
- 任务：M0-FIX-8 正则分类器与统计参数
- 结果：完成。
  - `packages/st-compat/src/regex-classifier.ts`：`hasRenderSibling` 跳过 `disabled` 的兄弟脚本；`classifyCore` 末尾不可达的 `unclassified` 分支删除，剩余情况统一归为 `text_replace`。
  - `packages/st-compat/src/health/duplication.ts`：`assertPositiveInteger` 在入口校验 `ngramSize`、`windowSize`、`step`、`riseWindows`，错误信息带参数名与非法值；删除原来只检查 `windowSize`/`step` 的部分。
  - `packages/st-compat/src/health/token-estimate.ts`：`isCjkCodePoint` 补 Hangul Jamo（1100–11FF）、兼容 Jamo（3130–318F）、Jamo 扩展 A（A960–A97F）、音节（AC00–D7A3）与扩展 B（D7B0–D7FF）。
  - `packages/st-compat/src/health/preset-health.ts`：删除零调用的 `countMacros`。`regex-health.ts`：`REGEX_CATEGORY_ORDER` 改为模块内常量。
  - 测试：`regex-classifier.test.ts` 补“启用流式 + 停用渲染 → 不可升级”；`duplication.test.ts` 的非法参数用例改为逐个参数按消息断言；`token-estimate.test.ts` 补谚文；`preset-health.test.ts` 的宏统计改用 `scanMacros`。4 个新用例。
- 验证：`pnpm check` 通过（202 个测试）；`pnpm --filter @dramaticer/st-compat report` 重新生成两份报告，可升级仍为 300/637（47.1%），token 估算因谚文略增（合计正文 1,943,423、其他 7,312,927、提示词正文 2,275,663）。

## 当前状态
- 门禁：`pnpm check` 通过（202 个测试）。
- 体检报告：统计版单列头部字节；每对话字段统计是全量，合计表取前 10；比率为 0/0 时显示 `—`；`runHealthCli` 可注入路径与时间；token 估算把谚文计入 CJK。
- 正则分类：升级判断只把启用的兄弟脚本视为渲染器；分类结果没有 `unclassified` 的兜底分支，空正则之外的剩余情况都是 `text_replace`。
- 存储：schema 迁移列表版本号必须从 1 连续递增；`getStateDiffs` 与 `getStateDiffsAlongPath` 对不存在的楼层都抛错；diff 的 `path` 在写入与读取两侧都校验。
- ACU 对照组：快照是单元格值列表，逐值规范化后判断包含；提问楼层不在对话里直接抛错。
- 检索：写入与查询共用 `normalizeRetrievalText`；检索评测按 `nodeId` 去重；`askAtNode` 越界抛错。
- 聊天解析：`parseChatJsonl` 只剥离首行的 BOM；`parseChatJsonlFile` 的错误包装为“解析聊天文件失败：<path>”。
- 角色卡：PNG 文本块先做 base64 规范化回环校验，再做 JSON 解析。
- LLM 客户端：`LlmRequest.signal` 贯穿请求、退避与限速等待。
- TASKS：M0-FIX-1 到 M0-FIX-8 已标记 `[x]`；M0-FIX-9 到 M0-FIX-11 待做；M0-T99 依赖全部 M0 任务。

## 下一步
- 执行 M0-FIX-9（评测集 CLI 与题目文件）：`readQuestionFile` 拒绝重复 `id` 并给出文件与行号；事件题解析阶段的结构校验失败计入失败记录；抽查与状态题抽样改成确定性；`event-cli` 的 `--story` 按故事分别写文件并合并已有条目；删除 `EventQuestionStats` 里没有读取方的三个字段；给 `*FromFile` 包装、`sanitizeFileName`、`storyIdOf`、`evalset/cli.ts` 的题量区间与 `summary.json`、`event-cli` 的 `.env` 缺失错误补测试；合并 evalset 内重复的计分与 `requireNonEmpty` 辅助。不调用 LLM，用注入的假客户端。
- 之后依次是 M0-FIX-10（manifest 的 `size`/`sha256` 校验）、M0-FIX-11（依赖声明与文档同步）、M0-T99（M0 验收）。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- `docs/dev/TASKS.md:55`、`:60`、`:71` 与 `LOG.md:12`、`:13`、`:15` 的数字已经过期，M0-FIX-11 统一修正，不要提前在别处重复改。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 10 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。单独重跑只改生成时间时不要把时间差异带进提交。
- `health/cli.ts` 的入口判断是 `import.meta.url === pathToFileURL(process.argv[1]).href`；测试导入它不会执行 `main`。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
