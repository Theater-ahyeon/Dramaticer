# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：56
- 任务：D-T04 小说参照基线与 Director 阈值
- 结果：完成（`DONE`）。
  - 对 `eval-private/reference/` 的 5 部作品运行参照统计：1,619,615 个内容字符、30,212 个文本块。相邻块 4-gram Jaccard 均值 0.0018–0.0030、P99 0.0387–0.0476；句长均值 22.72–29.68 字；对话占比 27.0%–37.2%；二元组 TTR 0.2246–0.4791。
  - 新增统计：相邻相似度分位（P50/P90/P95/P99）、连续含对白块与连续无对白块的长度分布。汇总 P90 分别为 7 与 6。
  - 新增 bge-m3 相邻块余弦校准：每个作品固定取样 100 对，共 500 对、991 段文本，均值 0.5256，P95 0.6760，P99 0.7324；结果缓存 `eval-private/reports/reference-cosine.json`，`pnpm --filter @dramaticer/st-compat reference:cosine` 生成。
  - 评测对话同口径对照：3 个对话、582 条助手回复、579 对相邻回复，Jaccard 均值 0.1176（约为小说的 40 倍），P95 0.2150；对话占比 13.6%–20.5%。两份报告新增「评测对话对照」与「参照 embedding 余弦」两节；统计版只出现“作品 1..N”与“对话 1..N”。
  - ADR-0025 给出 M3 阈值：相邻节拍余弦阈值 0.73、窗口 20 对、步长 10、`riseWindows` 5、`riseDelta` 0.02、`riseMinimum` 0.03；`climaxFloors = 7`、`breatheFloors = 6`、`sceneRepeatThreshold = 7`。张力阈值 0.33/0.67 明确不来自小说文本，由 T08 回放检验。
  - 新增 8 个测试（余弦校准 6、统计 2），门禁 `pnpm check` 通过（61 个测试文件、486 个测试）。

## 当前状态
- M0、M1、M2 完成；D-T01、D-T02、D-T03、D-T04 完成。
- M3 已细化：M3-T01 至 M3-T08 与 M3-T99；D-T04 完成后 T06、T07、T08 不再被阻塞，按任务顺序执行。
- 门禁：`pnpm check` 通过（486 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 12；M3 计划使用 v13（`director_decisions`）与 v14（`event_pool`、`npc_agendas`）。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。

## 下一步
- **M3-T01**（下一个会话）：迁移 v13 新增 `director_decisions`，core 新增 `director/` 决策框架与线索追踪机制；只统计当前分支上的未兑现笔记，输出最多一行指令，不调用 LLM。
- 然后按顺序执行 M3-T02（导演槽位与 `--director` 开关）→ M3-T03（卡扩展与事件池存储）→ M3-T04（事件池选择与停滞检测）→ M3-T05（NPC 议程后台任务）→ M3-T06（重复检测，阈值见 ADR-0025）→ M3-T07（节奏状态机）→ M3-T08（开关对比评测）。
- 参照基线数字已经就位，M3-T06/T07 直接读 ADR-0025，不要重新从对话语料推导阈值。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- 状态题 JSONL 必须带 `path`（非空字符串数组）；事件题不要带这个字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。
- 参照报告默认读取 `eval-private/reports/reference-cosine.json` 里的余弦校准；更换 embedding 模型或维度后要重新运行 `reference:cosine`。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
