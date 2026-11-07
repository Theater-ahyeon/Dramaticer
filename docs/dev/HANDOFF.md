# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：77
- 任务：R1-T01.a 台账事实补 storyTime 与 source
- 结果：完成（`DONE`），门禁通过（633 个测试，3 个 live 跳过）。
  - 迁移 v18：`state_diffs` 增加 `story_time_start` 与 `story_time_end`（可空 TEXT）。`StateDiff` 增加 `storyTime: StoryTime | null`，`NewStateDiff` 增加可选的 `storyTime`；存储层把起止都为空的 `storyTime` 归一为 `null`。
  - `packages/core/src/ledger/schema.ts`：新增 `LEDGER_SOURCES`（`model`、`settler`、`player`、`import`）与 `LedgerSource`；`LedgerDiffInput` 增加可选的 `storyTime` 与 `source`；`validateLedgerDiff` 校验来源取值与 `storyTime` 的 `start`/`end` 形状（非空字符串或 null，拒绝未知字段），错误带完整路径。
  - `packages/core/src/ledger/read.ts`：新增 `readLedgerFacts(store, nodeId, prefix?)`，沿路径回放台账 diff，返回仍然成立的事实 `{path, value, storyTime, source}`；删除的路径不出现，同一路径以最后一次写入为准；存储里出现枚举外的来源时抛错并指出路径。`readLedger` 与 `listLedgerEntities` 的快照值视图保持不变。
  - `packages/core/src/chat/turn.ts`：正文模型经结构化输出写入的 diff 来源从 `structured-output:<mode>` 改为 `model`，模式仍记录在 Trace 的 `structured.mode`。
  - 文档：DESIGN §7.1 写明 `storyTime` 的存储形状、`source` 取值与 `readLedgerFacts`；TASKS 的 R1-T01.a 标为完成，后续 R1 迁移编号从 v18–v24 顺延为 v19–v25。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T06、R0-T01 至 R0-T03、R1-T01、R1-T01.a 完成。
- 人类在会话 77 末尾追加了 F0 取证要求：TASKS 顶部新增「F：取证」一节并排在 R1 之前，F0 完成前不选 R1 及之后的任务；ADR-0037 记录插队、独立产品形态与固定模型。F0 全部模型调用用 magpie 网关的 DeepSeek V4.1 Flash，三个 ST 数据目录的只读扫描已获授权。
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
- **F0-T01 全量对话统计**（最高优先级；F0 完成前不选 R1 及之后的任务）：只读扫描 `D:\SillyTavern\TauriTavern\default-user\`、`D:\SillyTavern\data\default-user\`、`D:\SillyTavern\luker\Luker\data\default-user\` 的 `chats/`，按文件名去重（约 230 个对话），流式处理；统计楼层数分布（P50/P75/P90/最大）、当前 swipe 正文 token 估算、能整个放进 128K/200K/1M 的对话占比、重 roll 率、近期与早期对比；只把统计数字写到 `docs/dev/reports/F0-corpus.md`，用「对话 N」代替角色名。
- 之后按 F0 顺序：F0-T02 拒绝与接受回复对的归因（约 200 次调用）、F0-T03 裁判校准（约 400 次）、F0-T04 全文基线与渠道上限探测（最多 30 次）、F0-T99 报告与路线建议。F0 的全部模型调用固定用 magpie 网关（`http://127.0.0.1:3425/v1`）上的 DeepSeek V4.1 Flash；不调用本地 ST（I14）。
- F0-T99 给出建议并经人类确认后，再按 TASKS 的 R1 顺序继续：
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
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请。
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
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
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
