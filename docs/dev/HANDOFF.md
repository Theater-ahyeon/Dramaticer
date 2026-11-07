# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：93
- 任务：R1-T02.4 块格式说明段
- 结果：完成（`DONE`），门禁通过（769 个测试，3 个 live 跳过）。
  - `packages/core/src/chat/template.ts`：
    - `DefaultContextTemplateOptions` 新增 `blockFormat?: boolean`，默认关闭。
    - 关闭时 `segments` 与改动前逐字段一致（测试用 `toEqual` 对比未传与传 `false` 两种调用，并断言没有 `block_format` 段）。
    - 开启时在 `director` 之后、`protocol` 之前插入静态段 `{ id: "block_format", kind: "static", priority: 95 }`；文本按 `structuredOutput` 二选一：`text-tags` 给 `<state_update>` 与 `<plot_note>` 的标签写法，`function-call` 给两个工具的参数写法。两段都只写 `path`、`op`、`value`、`reason`、`text` 的格式，并以“要不要写、写几条，按剧情需要决定”收尾（I13）。
  - 新增 3 个测试（`packages/core/test/chat-providers.test.ts`）：关闭时与默认模板一致；开启后段位置在 `protocol` 前并含两种写入格式且不含“必须/务必/一律/一定要”；函数调用模式不提标签写法。
  - 用 `.devloop/scratch/` 的临时脚本跑过一次 `assembleContext`：两种模式下 `block_format` 状态均为 `included`，顺序在 `protocol` 之前，估算 token 分别为 108 与 110；脚本已删除。
  - 这个选项目前只由模板工厂接受；故事设置里的 `block_format` 开关属于 R5-T05，届时把设置传给 `createDefaultContextTemplate`。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0-T01 至 R0-T05、R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、R1-T02.1、R1-T02.2、R1-T02.3、R1-T02.4。完成记录与验收标准见 `docs/dev/TASKS-archive.md`，未完成任务见 `docs/dev/TASKS.md`。
- **R1-T02 已拆成 R1-T02.1–R1-T02.4**（父任务是文字说明，不是可勾选任务）：四个子任务全部完成，R1-T02 的总验收由 R1-T99 逐条核对；下一步是 **R1-T02.a 现场分析**（迁移 v21、后台 `scene` 任务、`scene` 槽位）。
- v3 阶段顺序：R1 最小集 → R3 快回合 → O 开局与方向 → R2 评测底座 → E → R4 → R5（最小界面先做）→ M6 生图第一批 → R1 续 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045。
- HUMAN-09 仍待处理（不阻塞）：ADR-0042 声明的 `bg-fallback`、`main-fallback`、`codex` 别名在 `data/channels.yaml` 里已经出现，`channels.example.yaml` 是否需要补上请人类确认；没有改这两个文件。
- HUMAN-10 待处理（不阻塞）：插件不变量是否加进 AGENTS.md。
- 数据库 schema 版本 20（v19 结算记录、v20 实体候选与置信度）；后续编号：v21 现场分析、v22 变更卡、v23 开盘包、v24 开场候选、v25 偏好记录、v26 父子分块、v27 章节压缩、v28 世界书预筛、v29 上下文包；插入新迁移时后续编号一起顺延。R1-T02.4 没有新增迁移。
- 结算只有 `dramaticer work` 调度：server 的回合路径不补建也不执行后台任务，所以回合内后台客户端零调用是结构保证；要真正结算故事，跑 `pnpm work --db <path> --kind settle`。`generateAssistantTurn` 仍然只写模型自己的结构化 diff（`source` 为 `model`，`confidence` 为空）。
- 结算窗口以 head 为终点（ADR-0046），冲突检查窗口同样取 head 路径最后 `conflictWindowFloors` 楼。窗口内没有未结算楼层时不调用模型。
- 冲突检测依赖模型在同一个结算请求里返回 `conflicts`；程序不自行判断语义矛盾，只做事实级拒绝与记录。R1-T07.a 从 `repairs` 里筛 `action` 为 `conflict` 的记录生成待审变更卡。
- 实体解析只处理 `character.<名称>`、`relation.<from>.<to>` 两端、`item.<名称>`、`scene.places.<地点>`；`clue`、`knowledge` 的知情者、`userWill` 不做实体映射。规范名称采用实体的 `name` 而不是 id，目的是让正文模型写的名称路径与结算器写的路径共用同一套键。
- 已注册的槽位是九个（`packages/core/src/context/template.ts` 的 `CONTEXT_SLOT_NAMES`：lore、character、persona、summary、state、memory、history、director、protocol）；DESIGN §9 里的 `ledger` 对应实现的 `state`，`beat` 尚未注册。R1-T02.a 新增 `scene` 槽位。`block_format` 是模板里的可选静态段，不是槽位。
- `packages/server` 已提供故事、导入、设置、模板、SSE 回合与后台运行时缓存；`packages/protocol` 已提供 HTTP 与 SSE 类型；`packages/web` 尚未创建。
- 故事设置缺省值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 4096（server 对没有保存过设置的故事改用 `min(4096, writer 模型声明)`）、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；R1-T03 改为批量窗口后由 R1-T04.a/.b 回填。
- F0 的私有产物：`eval-private/f0/pairs.jsonl`（290 对）、`attribution.jsonl`、`judge.jsonl`（793 行）、`fulltext/work.db`、`fulltext-probe.json`、`fulltext-branches.json`、`fulltext-generations.jsonl`、`fulltext-judgements.jsonl`、`fulltext-summary.json`、`llm-cache/`。`eval-private/reports/f0-corpus-map.json` 是对话编号到文件路径的映射。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。
- 插件系统在 DESIGN §19 是唯一权威；P 阶段任务在 TASKS 的「P：插件内核」小节，C 线兼容插件任务已存在且依赖 P2。

## 下一步
- **R1-T02.a 现场分析**：迁移 v21 新增 `scene_analyses`；后台任务 `scene` 读结算后的台账快照与最近 6 楼原文，由 `settler` 角色输出在场人物想要什么、知道什么、张力在哪；新增 `scene` 槽位（历史之后、导演之前），没有分析时为空并在 Trace 标注；同一楼层重跑覆盖，结算未完成时任务保持 pending，回合内不调用模型。
- 之后是 R1-T02.b 块的 prompt 视图、R1-T03 批量事件抽取。
- R1 最小集之后是 R3 快回合（R3-T01 至 R3-T99）、O 开局与方向、R2 评测底座。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包、ST 语义只在兼容插件里实现。
- 渠道角色：角色类型叫 `LlmModelRole`（`writer`、`settler`、`planner`、`judge`），与表示消息角色的 `LlmRole`（system、user、assistant）不是一回事。`createLlmClient` 会校验 judge 与 writer 的模型家族，缺省回落也算在内：只要配置里同时有 `main` 与 `background` 且两者同家族，创建任何客户端都会抛错。`data/channels.yaml` 目前用 `judge: codex`（`codex/gpt-6.1-terra`，gpt 家族）与 writer 的 deepseek 区分；改 writer 或 judge 的模型时要保持家族不同。
- `channels.example.yaml` 的 roles 示例里 judge 指向 background 并附了说明；复制示例时如果 background 与 main 是同一家族，启动会失败，需要另配一个家族的模型。
- tests 目录不在 tsc 的 `include` 里（`packages/*/tsconfig.json` 只含 `src`），测试里的 `TurnTrace` 字面量漏字段不会被类型检查发现；新增 Trace 字段时手动检查测试构造点（`core/test/trace-store.test.ts`、`core/test/ledger-settlement.test.ts`、`st-compat/test/director-eval.test.ts` 的 `emptyTrace`）。
- `docs/dev/TASKS.md` 只保留未完成任务与当前阶段；查已完成任务的说明、验收与完成记录读 `docs/dev/TASKS-archive.md`。
- `docs/dev/reports/F0.md` 里只有 F0-T02、F0-T03、F0-T04、F0-T99 四个标记段；重跑脚本只会替换对应标记之间的内容，手写部分不要放进标记之间。F0-T99 节里引用的数字必须与前面各节和 `docs/dev/reports/F0-corpus.md` 一致。
- `pnpm f0:fulltext` 阶段与文件：`DRAMATICER_F0_FULLTEXT_STAGE=probe|generate|judge|report|all`（默认 all），`DRAMATICER_F0_FULLTEXT_RERUN=1` 忽略已有结果重跑。分支集合固定为对话 128、132、10、223；对话 95 因提供方 `content_filter` 被替换。
- `fulltext-probe.json` 的 `previousCalls` 记录被重跑覆盖的探测调用数；重跑探测时这个字段会累加，不要手工清零。
- 请求长度探测的输入是重复的合成中文文本，core 的 token 估算把中文按 1.5 字符/token 算，比渠道实际计数高约 20%；报告同时给估算值与渠道报告的输入合计。「1M 级别」指目标 1,048,576 token 的探测级别，渠道报告的实际输入是 873,850 token。
- `pnpm f0:corpus` 需要 `DRAMATICER_ST_ROOTS`（Windows 上用分号分隔三个 ST 数据目录），并保证 `packages/core/dist` 已构建；脚本会覆盖 `docs/dev/reports/F0-corpus.md` 与 `eval-private/reports/f0-corpus-map.json`。
- F0-corpus 的标签块占比是保守口径：只用闭合的无属性标签块，带属性的 HTML 按正文计，合计 25.2%（中位数 0%）。引用标签块占比时必须同时写明口径。
- `pnpm f0:attribution` 需要先 `pnpm run typecheck` 构建 core 与 st-compat 的 `dist`，并读取 `eval-private/reports/f0-corpus-map.json`。环境变量：`DRAMATICER_F0_PAIRS_PER_BUCKET` 默认 67、`DRAMATICER_F0_CONCURRENCY` 默认 4、`DRAMATICER_F0_MAX_TOKENS` 默认 2500。归因输出必须原样使用固定类别，不放宽校验。
- `pnpm f0:judge`：从已归因配对里按层抽 70/60/70，每对两种顺序，结果写 `eval-private/f0/judge.jsonl`；报告只替换 `<!-- F0-T03:begin -->` 到 `<!-- F0-T03:end -->`，门槛那段是手写的。判决输出必须同时有 `choice` 与 0 到 1 的 `confidence`；失败过的判断用 `cacheDir: null` 重试。`DRAMATICER_F0_JUDGE_MODEL` 只覆盖内存里的模型 id；`DRAMATICER_F0_JUDGE_RERUN=1` 忽略已有结果重判。
- 语料里有文件名不同、内容完全相同的对话副本：F0-T03 的 390 次判断里有 24 次请求内容重复（13 次命中缓存），独立判断 366 次。引用样本量时要说明。
- 统计对话时按文件名去重，同名副本保留目录顺序靠前的那份（TauriTavern → data → luker）；报告只允许出现「对话 N」与数字。
- `parseChatJsonl` 默认在 `swipe_id` 越界或非整数时抛错（导入语义）；只读分析用 `{ strictSwipeId: false }`，不要用在导入路径上。
- 服务端启动时提供 `channels` 就会加载渠道配置；配置缺失或环境变量没设置会让启动失败，这是有意的快速失败。测试里通过 `channels.load` 与 `createClient` 注入假客户端。
- SSE 测试的临时目录用 `packages/server/test/.tmp-server-*`，已忽略；假渠道的 baseUrl 用 `127.0.0.1`，I10 允许。`runtime.test.ts` 用 `.tmp-runtime-*`，临时文件用 `mkdtempSync` 创建，需按同样规则忽略（已被 test 目录通配）。
- 中止保存的部分正文会写 Trace，`stopReason` 为 `aborted`，`usage` 全为 `null`、`truncations` 为空数组；不要把它当成正常完成，结算窗口与入队都会排除它。
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
