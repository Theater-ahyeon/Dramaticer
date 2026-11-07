# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：52
- 任务：D-T02 新语料三项统计分栏
- 结果：完成（`DONE`）。
  - `health/manifest.ts` 新增 `StoryCorpus`、`STORY_CORPORA` 与 `storyCorpus(file)`：旧 manifest 没有 `corpus` 时按 `legacy`，对话条目标成 `shared` 或非对话条目调用直接抛错。
  - 体检报告的对话体量、状态存储、重复度三节按语料分组：旧语料行号仍是“对话 1..3”，新增语料用“新增对话 1..4”，每组各有一行合计；私有版增加“语料”列与每个对话的语料行。实体、预设、正则三节仍是全量统计。
  - `collectRetrievalBaseline` 与 `collectAcuBaseline` 读取全部对话；旧语料缺状态题仍然直接抛错，新增语料缺状态题记为未评测并说明原因。返回结构新增 `corpora`（每组 `chatCount`、`skippedStoryCount`、按题型与总计）与 `skippedStories`。检索分组还包含 `eventQuestionRequestEstimate`。
  - `event-questions.ts` 新增 `planEventQuestions` / `planEventQuestionsFromFile`：复用窗口切分，只返回楼层数、可用窗口数、实际窗口数与请求数，不调用模型。报告用它在新增语料上给出事件题请求估算。
  - `state-questions.ts` 新增 `allowEmpty`：没有候选题时返回 0 题。`state-cli` 按语料选参数：legacy 保持 50–100、间隔 30；latest 间隔 3、上限 50、每条路径最多 3 题、允许空结果。`summary.json` 每条新增 `corpus`、`skipped`，`file` 可为 `null`。
  - 实测：新增语料 4 个对话（17/17/12/1 楼），生成 1 + 50 + 50 = 101 道状态题，单楼对话因为没有候选被跳过。旧语料仍是 71/65/100 = 236 道。BM25：旧语料 141/156/163，新增语料 5/5/5（101 题）。ACU：旧语料 91/386，新增语料 0/0（三个对话都没有表格数据，一个未评测）。事件题请求估算：新增语料 3 次，旧语料 0。
  - 两份报告已重新生成：`eval-private/reports/health.md` 与 `docs/dev/reports/M0-health.md`。连续运行两次，除生成时间外两份报告逐字节一致；统计版里没有出现 7 个角色名。
  - 测试：新增 7 个（语料解析、体检分栏、检索跳过与请求估算、ACU 跳过、allowEmpty、两种窗口估算），门禁 `pnpm check` 通过（470 个测试，3 个 live 跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T15 完成；M2-T99 被 HUMAN-08 阻塞。D-T01、D-T02 完成，D-T03 可做，D-T04 被 HUMAN-07 阻塞。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 12。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/evalset/summary.json` 现在包含 7 个对话的生成记录（337 道题，其中 1 个对话跳过）。
- HUMAN-08 待人类确认：状态题是继续要求文本召回 45%，还是改用状态层答案正确率。确认前不要执行 M2-T99。
- HUMAN-07 仍阻塞 D-T04；D-T03 可做。

## 下一步
- D-T03：参照小说统计脚本与 ADR。需要：
  - 写 ADR 区分记忆类评测（继续用对话）与文笔、结构类度量（改用小说参照基线）；
  - 复用 `packages/st-compat/src/health/duplication.ts` 写统计脚本，输出相邻文本块重复度曲线、句长分布、对话占比、词汇丰富度；
  - 输入为公有领域 fixture 与 `eval-private/reference/`（HUMAN-07 提供），私有报告 `eval-private/reports/reference.md`，统计版 `docs/dev/reports/reference-baseline.md`；
  - 需要人类提供的电子书写进 HUMAN.md。
- D-T03 之后、HUMAN-07 解除后再做 D-T04。
- HUMAN-08 解除后执行 M2-T99（口径见 ADR-0023）。
- 事件题在新增语料上尚未生成；报告给出的是窗口请求估算，实际出题需要调用后台渠道，不要在一个会话里等待跑完。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- 统计版报告不能出现私有故事名、原文或题目文本；新增渲染内容时先检查。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对，或直接用脚本里的同一套引用匹配规则。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/` 加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
