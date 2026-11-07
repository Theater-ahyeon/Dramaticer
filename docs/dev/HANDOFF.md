# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：51
- 任务：D-T01 快照脚本按修改时间取样最新对话
- 结果：完成（`DONE`）。
  - `scripts/snapshot-private-data.mjs` 新增 latest 取样：遍历 `chats/` 下每个对话目录，取修改时间最新的 jsonl；排除 legacy 的三个目录后按修改时间降序取前 N 个。`DRAMATICER_LATEST_CHATS` 默认 4，设为 0 关闭，非负整数以外的值直接抛错。每个新对话按与 legacy 相同的规则找角色卡与世界书。
  - manifest 每条新增 `corpus` 与 `sourceMtime`。`corpus` 取 `legacy`、`latest`；预设不是某个语料的一部分，记 `shared`。`sourceMtime` 是复制前源文件的 ISO 修改时间。`parseSnapshotManifest` 校验并保留这两个字段，未知分组与非法时间直接抛错。
  - 取样计划仍按源路径去重，同一目标被两个源文件占用时抛错。重复运行不会产生重复条目。
  - 实测：94 个文件、209.84 MB；legacy 9 条（3 对话、3 卡、3 世界书）、latest 11 条（4 对话、4 卡、3 世界书，其中两个新对话共用一份世界书，去重后只留一行）、shared 74 条预设。两两串行运行后 manifest 的 `files` 数组完全一致。
  - legacy 的对话、卡、世界书路径与 sha256 与上次快照逐一相同；唯一变化的是预设：源目录新增 16 个预设，另有 1 个预设被人类编辑过，所以预设计数从 58 变为 74。manifest 记录的是当前源文件哈希。
  - 共享世界书按源路径去重时只保留第一次出现的 `character`，另一个共用它的对话在 manifest 里没有对应的世界书行。新语料按卡里记录的世界书引用配对，不要只按 `character` 查。
  - 五个评测入口（`retrieval`、`acu`、`state-cli`、`event-cli`、`memory-eval`）改为只读 `legacy` 语料（`isLegacyCorpus`，旧 manifest 没有 `corpus` 时按 legacy 处理），避免新语料没有题目文件时在导入、生成向量之后才抛错。`health/report.ts` 未改，重新运行体检会把 7 个对话一起统计，D-T02 必须按 `corpus` 分栏。
  - 测试：`report.test.ts` 新增 2 个（保留分组与修改时间、拒绝非法值），门禁 `pnpm check` 通过（58 个测试文件、463 个测试，3 个 live 测试跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T15 完成；M2-T99 被 HUMAN-08 阻塞。D-T01 完成，D-T02、D-T03 可做，D-T04 被 HUMAN-07 阻塞。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 12；记忆评测与报告命令不变，只有语料过滤改走 `corpus`。
- 快照：`eval-private/raw/` 有 94 个文件，manifest 含语料分组与源文件修改时间。`git status` 看不到 eval-private。
- HUMAN-08 待人类确认：状态题是继续要求文本召回 45%，还是改用状态层答案正确率。确认前不要执行 M2-T99。
- HUMAN-07 仍阻塞 D-T04；D-T02、D-T03 可做。

## 下一步
- D-T02：体检、BM25、ACU 三项统计按 `corpus` 分栏（旧 3 个 / 新增集合）。需要：
  - `collectHealthReport` 与 `collectRetrievalBaseline`、`collectAcuBaseline` 按分组输出，统计版只含数字；
  - 为新增集合生成状态题（规则生成，不调用模型），`state-cli` 目前只读 legacy，需要按分组运行或加参数；
  - 新语料不调用 LLM 出事件题，把出题成本写进报告。
- D-T02 之后做 D-T03（参照小说统计脚本与 ADR）；HUMAN-07 解除后再做 D-T04。
- HUMAN-08 解除后执行 M2-T99（口径见 ADR-0023）。

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
