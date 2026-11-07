# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：85
- 任务：F0-T100 写 v3 并改写路线
- 结果：完成（`MILESTONE_DONE`），门禁通过（712 个测试，3 个 live 跳过）。
  - 新增 `docs/proposals/v3.md`：数据结论、主菜排序（开局与方向 → 输出形态 → 记忆与台账最小集 → 生图）、开局机制、输出形态、记忆最小集、偏好信号、评测与自动试玩、插件与 ST 兼容、阶段表、范围核对。
  - ADR-0044 记录采纳与阶段顺序。`docs/DESIGN.md` 升为 v0.3：§1 主菜排序、§2.1 F0 取证数字、§3 原则 10–12、§4 插件层与偏好信号、§6 prompt 视图与块显示、§7.3 记忆增强次序与 `gap_pass`、§8.4 开局导演、§9 块格式说明与兼容插件、§10.1 分两段交付、§10.2 生成长度与裁判模型家族、§12 生图位置、§14.5 偏好信号与自动试玩、§15 路线表重写、§16 去掉两处已被取代的条目、§17 新增四项待验证、§19 插件系统、附录 Q39–Q43。
  - `docs/dev/TASKS.md` 重写 F 之后的全部阶段：R1 最小集（含新增 R1-T02.b 块的 prompt 视图）、R3 快回合（细化到 5 个任务）、O 开局与方向（4 个任务）、R2 评测底座（新增 R2-T07/T07.a 偏好信号、R2-T08 公开合成基准、R2-T09 长对话遗忘评测）、E、R4、R5（最小界面先做，任务编号不变）、M6 生图第一批、R1 续（父子分块、重排序、事件表回填、八段式压缩、世界书预筛、上下文包，含 R1-T99.a）、R3b 深回合、P1–P5 位置、C 兼容插件、H、X、R6、M5、M7；R7 占位阶段取消（其四项内容已成独立阶段）。
  - 数据库迁移编号按新顺序重排：v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 变更卡、v23 开局包、v24 开场候选、v25 偏好记录、v26 父子分块、v27 章节压缩、v28 世界书预筛、v29 上下文包。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T06、R0-T01 至 R0-T03、R1-T01、R1-T01.a、F0-T01 至 F0-T04、F0-T99、F0-T100 完成。
- 下一步按文件顺序是 **R0-T04 合并 v3 插件系统提案**（`docs/proposals/plugins.md`，建立 P1–P5，位置按 ADR-0044），然后 **R0-T05 归档已完成任务**，然后进入 **R1 最小集**（第一个未完成任务是 R1-T01.b 渠道按岗位配置）。
- v3 阶段顺序：R1 最小集 → R3 快回合 → O 开局与方向 → R2 评测底座 → E → R4 → R5（最小界面先做）→ M6 生图第一批 → R1 续 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038（四个 ST 兼容插件取代兼容线 C-T00）、ADR-0039（F0-T100 直接写 v3，人类试玩改为自动试玩加评测）、ADR-0040（共存规则写入 C 线验收）、ADR-0041（方案评审提案 A1–A11）、ADR-0042（模型渠道回退顺序）、ADR-0043（F0 结论）、ADR-0044（v3 路线）。
- HUMAN-09 仍待处理（不阻塞）：ADR-0042 声明的 `bg-fallback`、`main-fallback`、`codex` 别名在 `data/channels.yaml` 里已经出现（F0 实际用了 `main-fallback` 与 `bg-fallback`），`channels.example.yaml` 是否需要补上请人类确认；没有改这两个文件。
- 数据库 schema 版本 18；后续迁移编号见上面一节，插入新迁移时后续编号一起顺延。
- 台账只有结构与读取，**没有写入校验的强制点**：`appendStateDiffs` 不调用 `validateLedgerDiff`；R1-T02 的结算器负责在写入前校验（I12）。
- `readLedgerFacts` 不读取快照缓存，按 `getStateDiffsAlongPath` 回放，返回顺序是路径上首次出现的顺序。
- 已注册的槽位是九个（`packages/core/src/context/template.ts` 的 `CONTEXT_SLOT_NAMES`：lore、character、persona、summary、state、memory、history、director、protocol）；DESIGN §9 里的 `ledger` 对应实现的 `state`，`beat` 尚未注册。R1-T02.a 新增 `scene` 槽位。R1-T02 的 `block_format` 是模板里的可选静态段，不是槽位。R3-T03 的写作契约使用已注册的 `protocol` 槽位。
- `packages/server` 已提供故事、导入、设置、模板、SSE 回合与后台运行时缓存；`packages/protocol` 已提供 HTTP 与 SSE 类型；`packages/web` 尚未创建。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024（R1-T01.c 改为 4096 与渠道声明取小）、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；R1-T03 改为批量窗口后由 R1-T04.a/.b 回填。
- F0 的私有产物：`eval-private/f0/pairs.jsonl`（290 对）、`attribution.jsonl`、`judge.jsonl`（793 行）、`fulltext/work.db`、`fulltext-probe.json`、`fulltext-branches.json`、`fulltext-generations.jsonl`、`fulltext-judgements.jsonl`、`fulltext-summary.json`、`llm-cache/`。`eval-private/reports/f0-corpus-map.json` 是对话编号到文件路径的映射。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。

## 下一步
- **R0-T04 合并 v3 插件系统提案**：按 `docs/proposals/plugins.md` 写 ADR 并把插件系统章节写进 DESIGN §19；建立 P1–P5，依赖固定为 P1→R5-T99、P2→P1+R5-T99、P3→P2、P4→P3、P5→P4+M5-T99，C 线依赖 P2；AGENTS.md 是否加入插件不变量在 HUMAN.md 请人类确认。
- **R0-T05 归档已完成任务**：把 M0–M4、D、R0 已完成项与 F0 已完成项移到 `docs/dev/TASKS-archive.md`，TASKS.md 只保留未完成与当前阶段。
- **R1-T01.b 渠道按岗位配置** 起继续 R1 最小集；R1 的顺序是 T01.b、T01.c、T02、T02.a、T02.b、T03、T04.a、T07、T07.a、T07.b、T99。
- R1 最小集之后是 R3 快回合（R3-T01 至 R3-T99）、O 开局与方向、R2 评测底座。
- 记忆增强（R1 续）排在 R5 与 60 轮自动试玩之后；R2-T09 的长对话遗忘报告是先后与默认开关的输入，四项都不删除。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包、ST 语义只在兼容插件里实现。
- `docs/dev/reports/F0.md` 里只有 F0-T02、F0-T03、F0-T04、F0-T99 四个标记段；重跑脚本只会替换对应标记之间的内容，手写部分（F0-T03 的门槛、F0-T99 的汇总结论）不要放进标记之间。F0-T99 节里引用的数字必须与前面各节和 `docs/dev/reports/F0-corpus.md` 一致。
- `pnpm f0:fulltext` 阶段与文件：`DRAMATICER_F0_FULLTEXT_STAGE=probe|generate|judge|report|all`（默认 all），`DRAMATICER_F0_FULLTEXT_RERUN=1` 忽略已有结果重跑。分支集合固定为对话 128、132、10、223；对话 95 因提供方 `content_filter` 被替换。
- `fulltext-probe.json` 的 `previousCalls` 记录被重跑覆盖的探测调用数；重跑探测时这个字段会累加，不要手工清零。
- 请求长度探测的输入是重复的合成中文文本，core 的 token 估算把中文按 1.5 字符/token 算，比渠道实际计数高约 20%；报告同时给估算值与渠道报告的输入合计。「1M 级别」指目标 1,048,576 token 的探测级别，渠道报告的实际输入是 873,850 token。
- `pnpm f0:corpus` 需要 `DRAMATICER_ST_ROOTS`（Windows 上用分号分隔三个 ST 数据目录），并保证 `packages/core/dist` 已构建；脚本会覆盖 `docs/dev/reports/F0-corpus.md` 与 `eval-private/reports/f0-corpus-map.json`。
- F0-corpus 的标签块占比是保守口径：只用闭合的无属性标签块，带属性的 HTML 按正文计，合计 25.2%（中位数 0%）。引用标签占比时必须同时写明口径。
- `pnpm f0:attribution` 需要先 `pnpm run typecheck` 构建 core 与 st-compat 的 `dist`，并读取 `eval-private/reports/f0-corpus-map.json`。环境变量：`DRAMATICER_F0_PAIRS_PER_BUCKET` 默认 67、`DRAMATICER_F0_CONCURRENCY` 默认 4、`DRAMATICER_F0_MAX_TOKENS` 默认 2500。归因输出必须原样使用固定类别，不放宽校验。
- `pnpm f0:judge`：从已归因配对里按层抽 70/60/70，每对两种顺序，结果写 `eval-private/f0/judge.jsonl`；报告只替换 `<!-- F0-T03:begin -->` 到 `<!-- F0-T03:end -->`，门槛那段是手写的。判决输出必须同时有 `choice` 与 0 到 1 的 `confidence`；失败过的判断用 `cacheDir: null` 重试。`DRAMATICER_F0_JUDGE_MODEL` 只覆盖内存里的模型 id；`DRAMATICER_F0_JUDGE_RERUN=1` 忽略已有结果重判。
- 语料里有文件名不同、内容完全相同的对话副本：F0-T03 的 390 次判断里有 24 次请求内容重复（13 次命中缓存），独立判断 366 次。引用样本量时要说明。
- 统计对话时按文件名去重，同名副本保留目录顺序靠前的那份（TauriTavern → data → luker）；报告只允许出现「对话 N」与数字。
- `parseChatJsonl` 默认在 `swipe_id` 越界或非整数时抛错（导入语义）；只读分析用 `{ strictSwipeId: false }`，不要用在导入路径上。
- 服务端启动时提供 `channels` 就会加载渠道配置；配置缺失或环境变量没设置会让启动失败，这是有意的快速失败。测试里通过 `channels.load` 与 `createClient` 注入假客户端。
- SSE 测试的临时目录用 `packages/server/test/.tmp-server-*`，已忽略；假渠道的 baseUrl 用 `127.0.0.1`，I10 允许。
- 中止保存的部分正文会写 Trace，`stopReason` 为 `aborted`，`usage` 全为 `null`；不要把它当成正常完成。
- 事件抽取原来每轮约 1,219 个请求，后台渠道实测约 2.7 次/分钟；R1-T03 的批量窗口应显著减少请求数。长任务用 `--resume` 与缓存续跑，不要在单个会话里等整轮回填。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- `director-eval` 的 `workDir` 默认在 `eval-private/memory-cache/tmp/director-eval`，结束时整目录删除。
- 状态题 JSONL 的 `path` 是 MVU 原始快照里的路径（可能以 `stat_data` 开头）；用 store 核对应读 `mvu` 子树（`mvuSnapshotAt`）。事件题不要带 `path` 字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、`eval-private/f0/`、`eval-private/preferences/`、临时数据库、`eval-private/raw/`、`eval-private/reference/`、`eval-private/st-sandbox/` 加进提交。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`；新增工作区包后需要 `--no-frozen-lockfile` 更新锁文件。
- 渠道行为（ADR-0009、ADR-0011、ADR-0042）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。`opendesign/deepseek-v4.1-flash` 不可用时的回退顺序见 ADR-0042；评测报告必须记录实际使用的路由。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。O-T02 新增开局机制、R4 替换 Director v1 时删除被取代的机制与断言，不保留两套。
- 函数调用模式的读取工具列表会随 `READ_TOOLS` 变化；测试不要断言完整列表，只断言写入工具在前、包含用到的读取工具。
- Playwright 浏览器与 `pnpm e2e` 不进入 `pnpm check`；端到端失败产物写 `.devloop/scratch/e2e/`。
- 故事设置的更新时间由存储层用 `new Date().toISOString()` 写入；测试不要断言具体时间值。
- 导入接口的角色卡图片与 JSON 都在请求体内，25 MB 上限覆盖；PNG base64 目前只接受无前缀的 base64，测试里用 `node:zlib` 构造最小 PNG。
- `packages/st-compat` 的测试通过 workspace 依赖解析到 `packages/core/dist`；改了 core 的公开代码后先 `pnpm run typecheck` 或 `pnpm --filter @dramaticer/core build`，再单独跑 st-compat 测试。`pnpm check` 会先构建。
- 任务编号映射（历史）：M4-T07→R5-T01、T08→R5-T02、T09→R5-T03、T10→R5-T04、T11→R5-T05、T12→R5-T06、T13→R5-T07、T14→R5-T08、T15→R5-T09、T16→R5-T10、T17→R5-T11、T18→R5-T12、T19→R5-T13、T20→R5-T14、T99→R5-T99。
