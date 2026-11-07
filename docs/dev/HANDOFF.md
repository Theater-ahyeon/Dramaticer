# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：53
- 任务：D-T03 参照小说统计脚本与 ADR
- 结果：完成（`DONE`）。
  - `docs/dev/DECISIONS.md` 新增 ADR-0024：记忆类评测（状态题、事件题召回）继续使用现有对话；重复度、句长分布、对话占比、词汇丰富度改用小说参照基线；伏笔设置与回收留给 M3 Director 用剧情笔记度量。公有领域作品可以进仓库测试数据；版权作品只能放 `eval-private/reference/`，不进提交、测试数据、文档或日志，agent 不联网下载。`docs/DESIGN.md` §14 增加“文笔与结构基线”一段。
  - 新增 `packages/st-compat/src/reference/text-stats.ts`：每行一个文本块；相邻块用字符 4-gram Jaccard 与 `health/duplication.ts` 的窗口/持续上升判定；句子按 `。！？!?；;…．` 与换行切分，句长只计非空白非标点非符号字符，分档 1–10、11–20、21–40、41–80、81+，报告均值、中位数、P90；对话占比统计 `“”`、`「」`、`『』`、`""` 内的字符占比；词汇丰富度报告字符 TTR 与字符二元组 TTR（不引入分词依赖）。
  - 新增 `reference/collect.ts` 与 `reference/cli.ts`：读取 `packages/st-compat/test/fixtures/reference/public-domain.txt` 与 `eval-private/reference/` 下的 `.txt`/`.md`；目录不存在或为空时私有作品数记 0，仍然生成报告。私有报告 `eval-private/reports/reference.md` 可含文件名；统计版 `docs/dev/reports/reference-baseline.md` 只写“作品 1..N”与数字。
  - 新增 `pnpm --filter @dramaticer/st-compat reference`（`tsc -b && node dist/reference/cli.js`）。公有领域 fixture 为《论语》与唐诗选段：59 块、962 字符、96 句、58 对相邻块；重复度均值 0.0136、峰值 0.1034；句长均值 10.02、中位数 10、P90 18；对话占比 70.1%；字符 TTR 0.3680、二元组 TTR 0.8283。统计版的数字与私有版一致，且没有版权作品名或原文。
  - `docs/dev/HUMAN.md` 的 HUMAN-07 补充输入格式：UTF-8 的 `.txt` 或 `.md`，每行一个段落，文件名作为私有报告里的作品名；仓库已有公有领域 fixture，不需要人类再指定测试样本。
  - 测试：新增 8 个（句长分档、引号占比、重复度、TTR、公有领域 fixture、CLI 两份报告、参照目录缺失），门禁 `pnpm check` 通过（478 个测试，3 个 live 跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T15 完成；M2-T99 被 HUMAN-08 阻塞。D-T01、D-T02、D-T03 完成，D-T04 被 HUMAN-07 阻塞。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 12。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/evalset/summary.json` 包含 7 个对话的生成记录（337 道题，其中 1 个对话跳过）。
- HUMAN-07 待处理：把参照小说按 UTF-8 `.txt`/`.md` 每行一段放进 `eval-private/reference/`；这一步解除后才能执行 D-T04。
- HUMAN-08 待人类确认：状态题是继续要求文本召回 45%，还是改用状态层答案正确率。确认前不要执行 M2-T99。
- 参照脚本已可用；`eval-private/reference/` 目前为空，报告里的私有作品数为 0。

## 下一步
- M3-T00 可做：拆解 M3 时把重复检测与节奏阈值相关任务标成依赖 D-T04；其余条目按 DESIGN §8 细化。
- D-T04 在 HUMAN-07 解除后执行：对 `eval-private/reference/` 运行 `pnpm --filter @dramaticer/st-compat reference`，用分布给出 Director 阈值并写 ADR。
- HUMAN-08 解除后执行 M2-T99（口径见 ADR-0023）。
- 事件题在新增语料上尚未生成；体检报告给出的是窗口请求估算，实际出题需要调用后台渠道，不要在一个会话里等待跑完。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
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
