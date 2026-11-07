# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：78
- 任务：F0-T01 全量对话统计
- 结果：完成（`DONE`），门禁通过（633 个测试，3 个 live 跳过）。
  - 新增 `scripts/f0-corpus.mjs`（根脚本 `pnpm f0:corpus`）：只读遍历 `DRAMATICER_ST_ROOTS` 里每个目录的 `chats/`，流式逐行解析 jsonl，按文件名去重，只输出统计数字；三个 ST 目录的绝对路径通过环境变量传入，仓库里不写私有路径。token 估算直接复用 `packages/core/dist/tokens.js` 的 `createTokenEstimator`（运行前需要 core 已构建）。
  - 生成 `docs/dev/reports/F0-corpus.md`：扫描 406 个 jsonl，同名副本 87 组，去重后 265 个对话、5,633 楼层（用户 2,338、助手 2,875、system 420）、当前正文合计 7,967,163 token。
  - 楼层数 P50 3、P75 15、P90 47、P95 95、最大 579；180 个对话不超过 10 层，25 个 ≥ 50 层，13 个 ≥ 100 层，6 个 ≥ 200 层。
  - 整段当前正文放得下的比例：128K 252/265（95.1%）、200K 257/265（97.0%）、1M 265/265；但楼层 ≥ 100 的 13 个对话里只有 1 个放得进 128K，5 个放得进 200K。
  - 重 roll：助手楼层里 384/2,875 重 roll 过（13.4%），175/265 个对话有重 roll；助手楼层 swipe 合计 4,046；73 个助手楼层没有 `swipes` 字段（按 1 条计）。助手楼层 ≥ 5 的 91 个对话重 roll 率为 10.3%。
  - 数据形状：`is_system` 有 24 个楼层是空串（按非 system 处理），2 个楼层缺 `mes`，`mes` 与 `swipes[swipe_id]` 存在文本差异（正文一律取 `mes`）。
  - 对话编号到文件路径的映射写到 `eval-private/reports/f0-corpus-map.json`（已被 git 忽略），F0-T02 抽样可以直接用它，不必重新推导「对话 N」。
  - 文件修改时间不可靠：4 个文件是 1970 年的时间戳，多数重复副本的修改时间等于 TauriTavern 的同步时间（2026-08-16），「较旧一半与较新一半」只是按修改时间的中位数切分，只能近似反映写作时间。
  - 会话期间人类更新了 `AGENTS.md`（新增 I15：core 不依赖任何其他工作区包，ST 语义只在兼容插件里实现）与 `scripts/check-invariants.mjs`，并往 INBOX 追加两条需求；本会话已分拣：
    - ADR-0039：TASKS 新增 F0-T100「写 v3 并改写路线」（依赖 F0-T99），按人类确认直接写 `docs/proposals/v3.md` 与 ADR、合并 DESIGN、重写 F 之后的阶段；人类试玩环节改为自动试玩加评测；F0-T99 不再在 HUMAN.md 请示人类。
    - ADR-0038：采纳 ST 生态兼容插件套件，四个插件取代兼容线 C-T00，落为 C-T01（沙箱与一致性测试台）与 C-T02–C-T05（`st-content`、`st-mvu`、`st-ejs`、`st-helper-host`），顺序 P-A → P-C → P-B → P-D，依赖插件内核 P2；P-E `st-classic-ui` 取消；授权把 `D:\SillyTavern\` 的程序与数据复制到 `eval-private/st-sandbox/` 做零模型录制比对，原目录只读。
    - INBOX 已清空；`R0-T04` 增加一条说明：兼容插件任务已存在，只负责插件内核。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T06、R0-T01 至 R0-T03、R1-T01、R1-T01.a、F0-T01 完成。
- 人类在会话 78 期间确认两条路线变更：ADR-0039（新增 F0-T100，F0-T99 不再请人类决定，人类试玩改为自动试玩加评测）与 ADR-0038（四个 ST 兼容插件取代兼容线 C-T00，落为 C-T01–C-T05，授权 `eval-private/st-sandbox/` 零模型录制比对）；AGENTS.md 新增 I15。
- TASKS 顶部的「F：取证」排在 R1 之前，F0 完成前不选 R1 及之后的任务；ADR-0037 记录插队、独立产品形态与固定模型。F0 全部模型调用用 magpie 网关（`http://127.0.0.1:3425/v1`）的 DeepSeek V4.1 Flash；三个 ST 数据目录的只读扫描已获授权。
- 数据库 schema 版本 18。R1 的迁移编号已按执行顺序排好：v19 结算记录（R1-T02）、v20 现场分析（R1-T02.a）、v21 父子分块（R1-T03.a）、v22 章节压缩（R1-T05）、v23 世界书预筛（R1-T06）、v24 变更卡（R1-T07.a）、v25 上下文包（R1-T08）。在已排定的任务之间插入新迁移时，后续编号要一起顺延。
- 台账只有结构与读取，**没有写入校验的强制点**：`appendStateDiffs` 不调用 `validateLedgerDiff`；R1-T02 的结算器负责在写入前校验（I12）。现有结构化输出 `state_update` 仍可写任意路径，来源记为 `model`。
- `readLedgerFacts` 不读取快照缓存，按 `getStateDiffsAlongPath` 回放，返回顺序是路径上首次出现的顺序。
- `packages/core` 的现有模块（楼层树、快照、后台任务、事件、摘要、笔记、检索、Director v1、上下文组装、执行器）全部保留；v2 的结算器、八段式压缩、世界书预筛与用户意志在 R1 新增或替换，届时删除被取代的实现与测试。
- 已注册的槽位是九个（`packages/core/src/context/template.ts` 的 `CONTEXT_SLOT_NAMES`：lore、character、persona、summary、state、memory、history、director、protocol）；DESIGN §9 里的 `ledger` 对应实现的 `state`，`beat` 尚未注册。R1-T02.a 要新增 `scene` 槽位，R2-T01 的朴素模式要排除它。
- `packages/server` 已提供故事、导入、设置、模板、SSE 回合与后台运行时缓存；R5 再补后台调度、分支与面板接口。
- `packages/protocol` 已提供 HTTP 与 SSE 类型；`packages/web` 尚未创建。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；R1-T03 改为批量窗口后由 R1-T04.a/.b 回填。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。

## 下一步
- **F0-T02 拒绝与接受回复对的归因**（后台渠道，约 200 次调用）：从有重 roll 的助手楼层里抽回复对（`swipe_id` 指向的算接受，其余算拒绝），按对话分层抽样约 200 对，复制到 `eval-private/f0/`；让后台模型从固定类别里选一个主因加最多两个次因，记录置信度。可用的抽样范围：175 个对话有重 roll，384 个重 roll 过的助手楼层，`eval-private/reports/f0-corpus-map.json` 提供「对话 N」到路径的映射。偏差处理：玩家可能切回早先的 swipe，重 roll 也可能只是想看别的写法。
- 之后按 F0 顺序：F0-T03 裁判校准（约 400 次）、F0-T04 全文基线与渠道上限探测（最多 30 次）、F0-T99 报告与路线建议、F0-T100 写 v3 并改写路线（ADR-0039，不再请人类决定）。全部模型调用固定用 magpie 网关的 DeepSeek V4.1 Flash；不调用本地 ST（I14）。
- F0-T100 合并 v3 之后，先做 **R0-T04 合并 v3 插件系统提案**（`docs/proposals/plugins.md`，人类已确认，写入 DESIGN 插件章节、新增 P1–P5、在 HUMAN.md 请人类确认 AGENTS.md 的新不变量），再按新路线继续；**兼容插件线 C-T01–C-T05 排在插件内核改造 P2 之后**（ADR-0038：沙箱与一致性测试台，然后 `st-content` → `st-mvu` → `st-ejs` → `st-helper-host`）。
- 新路线确认之前仍按 TASKS 的 R1 顺序执行：
- **R1-T01.b 渠道按岗位配置**：`data/channels.yaml` 增加 `roles`（`writer`、`settler`、`planner`、`judge`）；缺省 `writer` 回落 `main`、其余回落 `background`；创建路由时校验 `judge` 与 `writer` 不是同一个 `baseUrl`；Trace 记录角色与渠道。
- **R1-T02 台账结算器**：迁移 v19 新增 `ledger_settlements`；后台 `settle` 任务按窗口处理已确认、未结算的助手楼层；模型已写路径优先，结算器只补缺失路径；修复动作限定为补值、删除非法条目、改写线索状态；写入在一个事务里，重复结算不新增 diff，swipe 与编辑节点各自结算；回合内不等待。结算器写入前调用 `validateLedgerDiff`，来源用 `settler`。
- **R1-T02.a 现场分析**：迁移 v20 新增 `scene_analyses`；后台 `scene` 任务读台账与最近 6 楼原文，输出一小段；新增 `scene` 槽位，取当前路径最近一条；回合内零调用。
- **R1-T03 批量事件抽取**：一次请求处理最多 8 个连续、未抽取的已确认助手楼层；返回 `{nodeId, events}`，未知或重复楼层整窗拒绝；重跑无重复；与结算窗口互不阻塞。
- **R1-T03.a 父子分块**：迁移 v21 给 `chunks` 加父段字段；检索匹配小块、命中返回整段或整楼；回填时删除旧块与旧向量，再由 `embeddings` 补齐。
- **R1-T03.b 重排序**：新增 `RerankClient` 与 `channels.yaml` 的 `reranker` 段；融合后取前 20 重排，开关默认关闭，R1-T04.b 评测确认有提升才打开。
- 之后按 TASKS 顺序：R1-T04.a/.b 回填与记忆评测、R1-T05 八段式压缩（v22）、R1-T06 世界书预筛（v23）、R1-T07 用户意志、R1-T07.a 自然语言修订记忆（v24）、R1-T08 上下文包复用（v25）、R1-T99；再到 R2、E-T01、X1/X2、R3、R4、R5、H-T00、R6、R7。
- E-T01（`dramaticer explain`）排在 R2-T99 之后；H-T00（应用内助手）排在 R5-T99 之后并取代原 R7 的侧边 agent。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包、ST 语义只在兼容插件里实现、经典界面不为兼容改 core。
- `pnpm f0:corpus` 需要先设置 `DRAMATICER_ST_ROOTS`（Windows 上用分号分隔三个 ST 数据目录），并保证 `packages/core/dist` 已构建；脚本会覆盖 `docs/dev/reports/F0-corpus.md` 与 `eval-private/reports/f0-corpus-map.json`。
- 统计对话时按文件名去重，同名副本保留目录顺序靠前的那份（TauriTavern → data → luker）；报告只允许出现「对话 N」与数字，写完后用映射文件反向核对是否泄漏目录名。
- 服务端启动时提供 `channels` 就会加载渠道配置；配置缺失或环境变量没设置会让启动失败，这是有意的快速失败。测试里通过 `channels.load` 与 `createClient` 注入假客户端。
- SSE 测试的临时目录用 `packages/server/test/.tmp-server-*`，已忽略；假渠道的 baseUrl 用 `127.0.0.1`，I10 允许。
- 中止保存的部分正文会写 Trace，`stopReason` 为 `aborted`，`usage` 全为 `null`；不要把它当成正常完成。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟。R1-T03 的批量窗口应显著减少请求数；不要在单个会话里等待整轮回填跑完，用 `--resume` 与缓存续跑。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- `director-eval` 的 `workDir` 默认在 `eval-private/memory-cache/tmp/director-eval`，结束时整目录删除；主模型回复缓存关闭，embedding 内容缓存保留。
- 状态题 JSONL 的 `path` 是 MVU 原始快照里的路径（可能以 `stat_data` 开头）；用 store 核对应读 `mvu` 子树（`mvuSnapshotAt`）。事件题不要带 `path` 字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。`director-eval` 的统计版只用“对话 N”，不写实际故事 id。
- 参照报告默认读取 `eval-private/reports/reference-cosine.json` 里的余弦校准；更换 embedding 模型或维度后要重新运行 `reference:cosine`。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、`eval-private/f0/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`；新增工作区包后需要 `--no-frozen-lockfile` 更新锁文件。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。R4 替换 Director v1 时删除被取代的机制与断言，不保留两套。
- 函数调用模式的读取工具列表会随 `READ_TOOLS` 变化；测试不要断言完整列表，只断言写入工具在前、包含用到的读取工具。
- Playwright 浏览器与 `pnpm e2e` 不进入 `pnpm check`；端到端失败产物写 `.devloop/scratch/e2e/`。
- 故事设置的更新时间由存储层用 `new Date().toISOString()` 写入；测试不要断言具体时间值。
- 导入接口的角色卡图片与 JSON 都在请求体内，25 MB 上限覆盖；PNG base64 目前只接受无前缀的 base64，测试里用 `node:zlib` 构造最小 PNG。
- `packages/st-compat` 的测试通过 workspace 依赖解析到 `packages/core/dist`；改了 core 的公开代码后先 `pnpm run typecheck` 或 `pnpm --filter @dramaticer/core build`，再单独跑 st-compat 测试。`pnpm check` 会先构建。
- 任务编号映射：M4-T07→R5-T01、T08→R5-T02、T09→R5-T03、T10→R5-T04、T11→R5-T05、T12→R5-T06、T13→R5-T07、T14→R5-T08、T15→R5-T09、T16→R5-T10、T17→R5-T11、T18→R5-T12、T19→R5-T13、T20→R5-T14、T99→R5-T99。
