# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：55
- 任务：M2-T99 M2 验收
- 结果：完成（`MILESTONE_DONE`）。
  - 状态层答案正确率做进评测管线：状态题文件新增 `path` 字段（`readQuestionFile` 对状态题强制校验），`collectMemoryEval` 用 `getStateSnapshot(askAtNode)` 按路径取值并按 MVU `[值, 说明]` 规则比较，报告新增「状态层答案正确率」一节。实测对话 1 为 71/71、对话 2 为 65/65、对话 3 为 100/100，合计 236/236，路径缺失 0。
  - 文本召回与事件题成绩按 ADR-0023 原样保留：状态题融合 @20 13.6%、事件题 @5 83.3%（未达 88%）、@20 98.0%（达标）；9 条分对话门槛 7 条通过，对话 1 与对话 3 的事件题 @5 低于各自 BM25 基线减 2 个百分点。
  - 门禁 `pnpm check` 通过（60 个测试文件、478 个测试）；live 门禁 `DRAMATICER_LIVE=1 pnpm vitest run` 通过（63 个测试文件、481 个测试）。
  - I1–I10 逐条核对，重点 I5、I6、I7、I8、I9；结论写入 `docs/dev/reports/M2.md`。
  - M3 任务清单确认不需要修改；HUMAN-07 已完成，D-T04 解除阻塞，按文件顺序排在 M3 之前。

## 当前状态
- M0、M1、M2 完成；D-T01、D-T02、D-T03 完成，D-T04 已解除阻塞（HUMAN-07 完成）。
- M3 已细化：M3-T01 至 M3-T05 可以执行；M3-T06 至 M3-T08 依赖 D-T04；M3-T99 依赖 M3 全部任务。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 12；M3 计划使用 v13（`director_decisions`）与 v14（`event_pool`、`npc_agendas`）。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 已由人类放入 5 部参照小说（约 162 万内容字符、3 万个段落，UTF-8）。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。

## 下一步
- **D-T04**（下一个会话）：对 `eval-private/reference/` 运行 `pnpm --filter @dramaticer/st-compat reference`，得到重复度、句长、对话占比与词汇丰富度分布；写 ADR（阈值来源），统计版报告只含作品 1..N 与数字。
- 然后按顺序执行 M3-T01（决策框架、迁移 v13、线索追踪）→ M3-T02 → M3-T03 → M3-T04 → M3-T05；T06 至 T08 在 D-T04 完成后执行。
- 事件题在新增语料上尚未生成；体检报告给出的是窗口请求估算，不要在一个会话里等待跑完。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。评测现在会计算状态层答案正确率，正常应当是 100%，出现下降说明导入或快照链路出了问题。
- 状态题 JSONL 必须带 `path`（非空字符串数组）；事件题不要带这个字段。新增题目文件由 `state-cli` 生成，会自带。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文，写入前先检查。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对，或直接用脚本里的同一套引用匹配规则。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
