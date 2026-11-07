# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：97
- 任务：R1-T04.a 批量抽取管线与断点续跑
- 结果：完成（`DONE`），门禁通过（794 个测试通过，3 个 live 跳过，共 797 个）。
  - 新增 `packages/st-compat/src/evalset/events-backfill.ts`（`runEventsBackfill`）：读 manifest 里的 legacy 对话，导入持久数据库（`store.getStory` 已存在时跳过导入），导入卡牌实体、角色书与世界书 lore，补齐缺失的块向量，然后用 `createEventExtractionHandler` 逐窗口抽取事件。导入失败或写库失败直接抛错。
  - 新增 `packages/st-compat/src/evalset/events-cli.ts`，入口 `pnpm --filter @dramaticer/st-compat events-backfill`；参数 `--story <id>`、`--limit <n>`（跨故事累计窗口数）、`--resume`、`--db <path>`、`--help`。默认数据库 `eval-private/memory-cache/eval.db`、事件缓存 `eval-private/memory-cache/events/`、向量缓存 `eval-private/memory-cache/embeddings/`。
  - `--resume` 保留已有数据库并跳过已导入的故事与已抽取的窗口；不带 `--resume` 时先删除数据库文件（含 `-wal`、`-shm`）再从头导入。缓存目录始终保留，因此删除数据库后的重复运行由缓存提供相同回复。
  - 窗口循环：每一轮先算当前路径上未抽取的已确认助手楼层，取第一个作为任务楼层；调用后对比 `listExtractedEventNodeIds` 的增量，增量必须非空，否则立即抛错，避免无限循环。单窗口连续失败 3 次才终止整批（与后台任务框架的重试次数一致）。
  - 请求计数用包装客户端累计：`result.cached` 为 true 记缓存命中，否则记一次模型请求。每个窗口打印故事、全局窗口序号、本窗口楼层数、累计楼层、累计事件、累计请求与缓存命中。
  - `memory-eval.ts` 的 `importStoryEntities`、`countStoryChunks`、`countStoryVectors`、`countStoryEvents` 改为导出，供回填复用；`buildStoryEvents` 仍是 memory-eval 自己的整轮循环。
  - 新增 4 个测试：3 个窗口各 8 楼、每窗口一次请求且事件归属到正确助手楼层；续跑只处理剩余窗口且重复运行不新增事件与抽取记录；未知故事直接失败；CLI 把两个缓存目录交给注入的客户端工厂，并按 `--resume` 决定是否重建数据库。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0-T01 至 R0-T05、R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、R1-T02.1、R1-T02.2、R1-T02.3、R1-T02.4、R1-T02.a、R1-T02.b、R1-T03、R1-T04.a。完成记录与验收标准见 `docs/dev/TASKS-archive.md`，未完成任务见 `docs/dev/TASKS.md`。
- **R1-T02 已拆成 R1-T02.1–R1-T02.4**（父任务是文字说明，不是可勾选任务）：四个子任务全部完成，R1-T02 的总验收由 R1-T99 逐条核对。
- v3 阶段顺序：R1 最小集 → R3 快回合 → O 开局与方向 → R2 评测底座 → E → R4 → R5（最小界面先做）→ M6 生图第一批 → R1 续 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045。
- HUMAN-09 仍待处理（不阻塞）：ADR-0042 声明的 `bg-fallback`、`main-fallback`、`codex` 别名在 `data/channels.yaml` 里已经出现，`channels.example.yaml` 是否需要补上请人类确认；没有改这两个文件。
- HUMAN-10 待处理（不阻塞）：插件不变量是否加进 AGENTS.md。
- 数据库 schema 版本 23（v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 历史块策略、v23 事件抽取记录）；后续编号：v24 变更卡、v25 开局包、v26 开场候选、v27 偏好记录、v28 父子分块、v29 章节压缩、v30 世界书预筛、v31 上下文包；插入新迁移时后续编号一起顺延。
- 结算只有 `dramaticer work` 调度：server 的回合路径不补建也不执行后台任务，所以回合内后台客户端零调用是结构保证；要真正结算故事，跑 `pnpm work --db <path> --kind settle`，要生成现场分析跑 `pnpm work --db <path> --kind scene`，要回填事件跑 `pnpm work --db <path> --kind events`（单故事、逐窗口推进，适合小批量），批量回填三个 legacy 对话用 R1-T04.a 的 `events-backfill`。
- 结算窗口以 head 为终点（ADR-0046），冲突检查窗口同样取 head 路径最后 `conflictWindowFloors` 楼。窗口内没有未结算楼层时不调用模型。
- 现场分析以被分析的楼层为锚点：台账快照取该楼层的结算结果，原文窗口是该楼层路径上的最近 6 楼；没有结算记录时任务退回 pending（ADR-0048）。
- 冲突检测依赖模型在同一个结算请求里返回 `conflicts`；程序不自行判断语义矛盾，只做事实级拒绝与记录。R1-T07.a 从 `repairs` 里筛 `action` 为 `conflict` 的记录生成待审变更卡。
- 实体解析只处理 `character.<名称>`、`relation.<from>.<to>` 两端、`item.<名称>`、`scene.places.<地点>`；`clue`、`knowledge` 的知情者、`userWill` 不做实体映射。规范名称采用实体的 `name` 而不是 id。
- 已注册的槽位是十个（`packages/core/src/context/template.ts` 的 `CONTEXT_SLOT_NAMES`：lore、character、persona、summary、state、memory、history、scene、director、protocol）；DESIGN §9 里的 `ledger` 对应实现的 `state`，`beat` 尚未注册。DESIGN §9 把 `scene` 排在 `history` 之后、`director` 之前，而默认模板里 `history` 是最后一段，所以模板段落放在 `memory` 与 `director` 之间（ADR-0048）。`block_format` 是模板里的可选静态段，不是槽位。
- 原生块类型现在是 12 个（`thinking`、`选项`、`状态栏`、`变量更新`、`分析`、`图片`、`页眉`、`悄悄话`、`旁白`、`备忘`、`state_update`、`plot_note`）；其中 `thinking`、`变量更新`、`state_update`、`plot_note` 的上下文策略是删除。
- 历史槽位的默认策略：更早楼层省略五个显示类块，最近 1 楼不套用这层省略；`full` 是改动前的行为，用于对照。设置项 `historyBlockPolicy` 存在 `story_settings.history_block_policy`（JSON）。
- `packages/server` 已提供故事、导入、设置、模板、SSE 回合与后台运行时缓存；`packages/protocol` 已提供 HTTP 与 SSE 类型；`packages/web` 尚未创建。
- 故事设置缺省值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 4096（server 对没有保存过设置的故事改用 `min(4096, writer 模型声明)`）、`reasoning` `low`、`historyBlockPolicy` `{mode:"default",overrides:{}}`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立；批量抽取窗口与抽取记录在 R1-T03 落地；批量回填管线在 R1-T04.a 落地，真实回填由 R1-T04.b 执行。
- F0 的私有产物：`eval-private/f0/pairs.jsonl`（290 对）、`attribution.jsonl`、`judge.jsonl`（793 行）、`fulltext/work.db`、`fulltext-probe.json`、`fulltext-branches.json`、`fulltext-generations.jsonl`、`fulltext-judgements.jsonl`、`fulltext-summary.json`、`llm-cache/`。`eval-private/reports/f0-corpus-map.json` 是对话编号到文件路径的映射。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。
- 插件系统在 DESIGN §19 是唯一权威；P 阶段任务在 TASKS 的「P：插件内核」小节，C 线兼容插件任务已存在且依赖 P2。

## 下一步
- **R1-T07 用户意志捕获**：新增后台任务 `user_will`，读最近若干条玩家消息识别偏好、底线与纠正，写入 `["userWill", <稳定 id>]`，按规范化正文去重、只追加；组装上下文时放在预算取舍第一位；分支切换后只注入当前路径条目。验收见 TASKS。
- 之后是 R1-T07.a 自然语言修订记忆（变更卡迁移从 v24 开始）、R1-T07.b `gap_pass`、R1-T99 R1 最小集验收。
- R1 最小集之后是 R3 快回合（R3-T01 至 R3-T99）、O 开局与方向、R2 评测底座。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包、ST 语义只在兼容插件里实现。
- 渠道角色：角色类型叫 `LlmModelRole`（`writer`、`settler`、`planner`、`judge`），与表示消息角色的 `LlmRole`（system、user、assistant）不是一回事。`createLlmClient` 会校验 judge 与 writer 的模型家族，缺省回落也算在内：只要配置里同时有 `main` 与 `background` 且两者同家族，创建任何客户端都会抛错。`data/channels.yaml` 目前用 `judge: codex`（`codex/gpt-6.1-terra`，gpt 家族）与 writer 的 deepseek 区分；改 writer 或 judge 的模型时要保持家族不同。
- `channels.example.yaml` 的 roles 示例里 judge 指向 background 并附了说明；复制示例时如果 background 与 main 是同一家族，启动会失败，需要另配一个家族的模型。
- tests 目录不在 tsc 的 `include` 里（`packages/*/tsconfig.json` 只含 `src`），测试里的 `TurnTrace` 字面量漏字段不会被类型检查发现；新增 Trace 字段时手动检查测试构造点（`core/test/trace-store.test.ts`、`core/test/ledger-settlement.test.ts`、`st-compat/test/director-eval.test.ts` 的 `emptyTrace`）。
- 新增槽位或模板段落时同步更新既有断言：`core/test/chat-turn.test.ts` 的 Trace 顺序、`core/test/chat-providers.test.ts` 的标准槽位集合、`st-compat/test/chat-cli.test.ts` 的槽位列表。
- 新增或调整原生块类型时同步更新 `core/test/block-parser.test.ts` 的默认块类型列表断言。
- 历史槽位的 `full` 是“改动前的渲染”的对照口径；`default` 的最近一楼仍会省略思考块与写入块，不要再把“最近一楼”理解成返回完整原文。省略统计按整段标签文本计算。
- `default` 下围栏代码块不受块策略影响；围栏未闭合时一直保留到楼层结尾。
- `pnpm r1:history-view` 需要先构建 `packages/core/dist` 与 `packages/st-compat/dist`（`pnpm run typecheck` 即可）；脚本只读 `eval-private/raw/`，不写数据库，输出贴进 `docs/dev/reports/R1.md`。
- 离线统计里“含标签映射”一列用的是 F0 的标签分类，不是 core 的原生块类型；st-compat 的标签映射落地后要复核 `DEFAULT_HISTORY_OMITTED_BLOCK_NAMES` 与原生块类型表。
- 事件抽取窗口只看 head 路径，任务所在楼层不决定窗口；已抽取的助手楼层（有事件或抽取记录）会切断连续段，所以窗口按时间顺序推进。`eventWindowFloors` 在代码里是 `createEventExtractionHandler({ windowFloors })`。
- 批量抽取的回复格式是 `[{nodeId, events: [...]}]`；`nodeId` 必须是本次窗口里 `role` 为 assistant 的楼层，窗口外或重复楼层整批拒绝。窗口正文里的玩家楼层只作上下文。head 上的助手楼层没有子节点时不算“已确认”，窗口不会包含它。
- `event_extractions` 的 `event_count` 是窗口内该楼层抽到的事件数；抽取记录与事件在 `recordEventExtractions` 的同一个事务里提交，任一非法时一起回滚。
- `listExtractedEventNodeIds` 同时看 `memory_events`（来源为事件抽取）与 `event_extractions`；直接调用处理器做回填时也要靠它跳过已处理楼层。
- st-compat 的 `buildStoryEvents` 只针对主路径上已确认的助手楼层；旧行为把事件写在任务所在楼层（可能是 system 或 user 楼层），批量窗口之后事件只写助手楼层。
- `events-backfill` 不带 `--resume` 会删除数据库文件；跑长任务时必须带 `--resume`。`--limit` 是跨故事累计的窗口数，不是每故事一次。故事已导入时跳过导入，所以 manifest 里的对话改动后要删库重跑。
- `events-backfill` 的请求数与缓存命中来自包装客户端检查 `LlmResult.cached`；真实渠道下缓存命中表示这次窗口没有发出网络请求。
- 新迁移编号：v24 变更卡、v25 开局包、v26 开场候选、v27 偏好记录、v28 父子分块、v29 章节压缩、v30 世界书预筛、v31 上下文包。
- 后台任务需要等待其它任务完成时抛 `BackgroundJobDeferredError`（`background/types.ts`），drain 会把任务退回 pending 且不消耗执行次数；不要用抛普通错误的方式等待，那会消耗重试次数。
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
- 事件抽取原来是每轮约 1,219 个请求，后台渠道实测约 2.7 次/分钟；R1-T03 的批量窗口把请求数压到每 8 个助手楼层一次，R1-T04.a 提供缓存的批量回填命令，真实请求数与耗时由 R1-T04.b 统计。长任务用 `--resume` 与缓存续跑，不要在单个会话里等整轮回填。
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
