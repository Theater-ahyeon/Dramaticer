# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：75
- 任务：R0-T02 合并 v2.1 补充提案
- 结果：完成（`DONE`），门禁通过（629 个测试）。
  - `docs/dev/DECISIONS.md`：新增 ADR-0035，记录三分法：A1–A9 直接采纳、改变架构的只用评测决定、第三节暂缓项进 DESIGN §18 不建任务。
  - `docs/DESIGN.md`：§7.1 增加台账事实的 `storyTime` 与 `source` 元数据及变更卡；§7.3 增加现场分析行、父子分块、重排序、上下文包复用；§9 槽位表加 `scene` 与包复用；§10.1 加深回合“工具少而通用”和“运行中追加要求”；§10.2 增加按岗位配置；§14 增加编造回忆率、叙事质量、五类记忆题与裁判/写作不同渠道，新增 §14.4 实验表；§15 更新 R1/R2 并加 X 行；§17 增加两项待验证；新增 §18 后续方向；附录 A 加 Q37。
  - `docs/dev/TASKS.md`：新增 R1-T01.b（渠道按岗位配置）、R1-T02.a（现场分析）、R1-T03.a（父子分块）、R1-T03.b（重排序）、R1-T07.a（自然语言修订记忆）、R1-T08（上下文包复用）、R2-T03.a（五类记忆题与编造回忆率）、R2-T04.a（叙事质量评分表）、X1、X2；R1-T02 依赖加 R1-T01.b，R1-T04.b 依赖加 R1-T03.a/.b，R2-T03/R2-T04 依赖加 R1-T01.b，R2-T06 依赖加 R2-T03.a/R2-T04.a；R3-T00 细化说明写入 A7/A8；R1-T05、R1-T06 的迁移编号顺延为 v21、v22。
  - `docs/dev/INBOX.md`：v2.1 条目记为已处理，未处理区为空。会话期间人类追加 `docs/proposals/v2.2.md`，已分拣为 R0-T03。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T06、R0-T01、R0-T02、R1-T01 完成。
- 数据库 schema 版本 17。R1 的迁移编号已按执行顺序排好：v18 结算记录（R1-T02）、v19 现场分析（R1-T02.a）、v20 父子分块（R1-T03.a）、v21 章节压缩（R1-T05）、v22 世界书预筛（R1-T06）、v23 变更卡（R1-T07.a）、v24 上下文包（R1-T08）。在已排定的任务之间插入新迁移时，后续编号要一起顺延。
- 台账只有结构与读取，**没有写入校验的强制点**：`appendStateDiffs` 不调用 `validateLedgerDiff`；R1-T02 的结算器负责在写入前校验（I12）。现有结构化输出 `state_update` 仍可写任意路径。
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
- **R0-T03 合并 v2.2 补充提案**（会话 75 期间人类追加 `docs/proposals/v2.2.md`，已分拣）：ADR-0036；D1–D5 深回合要点写进 DESIGN §10.1 与 R3-T00；D6 的 `SKILL.md` 格式与第三节三项写进 §18；应用内助手写入 DESIGN，排障命令行任务排在 R2 之后，完整助手排在 R5 之后并取代 R7 的侧边 agent。
- **R1-T01.a 台账事实补 storyTime 与 source**：`storyTime` 进入存储（起止都可空），`source` 取值 `model`、`settler`、`player`、`import` 并沿用 `StateDiff.source`；`validateLedgerDiff` 校验类型与取值，读取能读回；R1-T01 的路径表与快照语义不变。
- **R1-T01.b 渠道按岗位配置**：`data/channels.yaml` 增加 `roles`（`writer`、`settler`、`planner`、`judge`）；缺省 `writer` 回落 `main`、其余回落 `background`；创建路由时校验 `judge` 与 `writer` 不是同一个 `baseUrl`；Trace 记录角色与渠道。
- **R1-T02 台账结算器**：迁移 v18 新增 `ledger_settlements`；后台 `settle` 任务按窗口处理已确认、未结算的助手楼层；模型已写路径优先，结算器只补缺失路径；修复动作限定为补值、删除非法条目、改写线索状态；写入在一个事务里，重复结算不新增 diff，swipe 与编辑节点各自结算；回合内不等待。
- **R1-T02.a 现场分析**：迁移 v19 新增 `scene_analyses`；后台 `scene` 任务读台账与最近 6 楼原文，输出一小段；新增 `scene` 槽位，取当前路径最近一条；回合内零调用。
- **R1-T03 批量事件抽取**：一次请求处理最多 8 个连续、未抽取的已确认助手楼层；返回 `{nodeId, events}`，未知或重复楼层整窗拒绝；重跑无重复；与结算窗口互不阻塞。
- **R1-T03.a 父子分块**：迁移 v20 给 `chunks` 加父段字段；检索匹配小块、命中返回整段或整楼；回填时删除旧块与旧向量，再由 `embeddings` 补齐。
- **R1-T03.b 重排序**：新增 `RerankClient` 与 `channels.yaml` 的 `reranker` 段；融合后取前 20 重排，开关默认关闭，R1-T04.b 评测确认有提升才打开。
- 之后按 TASKS 顺序：R1-T04.a/.b 回填与记忆评测、R1-T05 八段式压缩（v21）、R1-T06 世界书预筛（v22）、R1-T07 用户意志、R1-T07.a 自然语言修订记忆（v23）、R1-T08 上下文包复用（v24）、R1-T99；再到 R2 与 X1/X2。

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
