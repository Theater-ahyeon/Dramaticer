# 任务清单

状态标记：`[ ]` 待做 · `[~]` 进行中 · `[x]` 完成 · `[!]` 被阻塞（括号里写阻塞它的 HUMAN 编号）

规则：从上往下选第一个可以做的任务；一个会话只做一个任务；任务太大就拆成子任务（`.a`、`.b`……）。每个里程碑最后都有一个 `T99` 验收任务。后面的里程碑只写了粗粒度条目，**由它的 `T00` 拆解任务细化**。v3 的阶段顺序与主菜排序见 `docs/proposals/v3.md` 与 DESIGN §15（ADR-0044）。

已完成任务与完成记录整段保存在 `docs/dev/TASKS-archive.md`；本文件只保留未完成任务、进行中任务与当前阶段的细节。

## 阶段目录

| 阶段 | 状态 | 位置 |
|---|---|---|
| F 取证 | 完成 | 归档 |
| M0 数据与度量 | 完成 | 归档 |
| M1 模型层与单轮生成 | 完成 | 归档 |
| M2 楼层树与记忆引擎 | 完成 | 归档 |
| D 参照语料与文笔基线 | 完成 | 归档 |
| M3 Director | 完成 | 归档 |
| M4 server 骨架与 SSE 对话（T00–T06） | 完成 | 归档 |
| R0 v2 迁移（T01–T04） | 完成 | 归档 |
| R0-T05 归档已完成任务 | 完成 | 本文件 |
| R1 世界模型最小集 | 完成 | 本文件 |
| R3 快回合 | 完成 | 本文件 |
| O 开局与方向 | 完成 | 本文件 |
| R2 评测底座 | 完成 | 本文件 |
| E 排障命令行 | 完成 | 本文件 |
| R4 Director v2 | 完成 | 本文件 |
| R5 能玩的界面 | 完成 | 本文件 |
| M6 生图第一批 | 当前阶段 | 本文件 |
| R1 续 记忆增强 | 完成 | 本文件 |
| R3b 深回合 | 完成 | 本文件 |
| P 插件内核 | 进行中 | 本文件 |
| 兼容插件线 | 进行中 | 本文件 |
| H 应用内助手 | 完成 | 本文件 |
| X 对比实验 | 待做 | 本文件 |
| R6 效果门槛 | 待做 | 本文件 |
| M6b 生图第二批 | 待做（R6 之后） | 本文件 |
| M5 公开 alpha | 待做 | 本文件 |
| M7 Tauri 打包 | 待做 | 本文件 |

---

## R0：v2 迁移（INBOX 分拣）

- [x] **R0-T05 归档已完成任务** | 依赖：无 | ADR-0041（A11）
  完成：2026-11-07 F0、M0–M4、D、R0-T01 至 R0-T04 共 616 行原文整段移入 `docs/dev/TASKS-archive.md`（8 个章节，状态全部为完成，内容一字未改）；TASKS 顶部新增阶段目录并指向归档，全文从 1227 行缩到 650 行；HANDOFF 里的已完成任务细节引用改指归档；门禁通过（712 个测试）
  做什么：
  - 把 `docs/dev/TASKS.md` 里已完成的里程碑（M0–M4、D、R0 的已完成项与 F0 已完成项）整段移到 `docs/dev/TASKS-archive.md`，HISTORY 内容一字不改；TASKS.md 只保留未完成任务、进行中任务与当前阶段的细节。
  - TASKS.md 顶部保留状态标记说明、选任务规则与阶段目录，并指向归档文件；HANDOFF 与 LOG 里对已完成任务细节的引用改成指向归档。
  验收：TASKS.md 不再逐条包含已完成任务；归档文件保留原文与完成记录；两个文件里的任务编号与状态一致；`pnpm check` 通过。

## R1：世界模型最小集（台账与记忆）

> v3 路线（ADR-0044）：本节只做最小可玩版本需要的部分。父子分块、重排序、八段式压缩、世界书预筛与上下文包复用已移到「R1 续：记忆增强」，由长对话评测证据决定先后。

- [x] **R1-T01 台账结构与 MVU 映射** | 依赖：M2-T02、M2-T04、M4-T02 | DESIGN §5、§7.1
  完成：2026-11-07 `packages/core/src/ledger` 定义九个命名空间与路径表，`validateLedgerDiff` 校验路径、类型、范围与线索状态，`readLedger` 与 `listLedgerEntities` 复用状态快照；st-compat 导入 MVU 时加 `mvu` 前缀；ADR-0034；门禁通过（629 个测试）
  做什么：
  - core 定义台账命名空间与类型：`character`（主演与龙套两级）、`relation`（有方向、类型、阶段、好感内在与外在五档、惯性）、`item`（持有者、位置、来历、变动日志）、`scene`（地点树与当前现场）、`time`（故事内时间锚点）、`clue`（开启、推进、兑现）、`knowledge`（谁知道什么）、`userWill`（偏好、底线、纠正）、`mvu`（MVU 命名空间）。全部用现有 `StateDiff.path` 表达，不新增第二套存储。
  - `validateLedgerDiff` 校验命名空间、路径段非空、值的类型与范围、线索状态（只允许开启、推进、兑现）；非法条目抛错并指出字段路径。
  - `readLedger(store, nodeId, prefix?)` 读节点快照并按前缀取子树；`listLedgerEntities` 返回人物与关系、未兑现线索；读取复用 M2-T02 的快照，不新增表。
  - st-compat 导入 MVU 快照时把路径映射为 `["mvu", ...]`；没有 MVU 的卡不生成 `mvu` 命名空间；评测数据库由 raw 重建，不做旧库迁移。
  验收：九个命名空间各有一条通过校验的 diff；未知命名空间、空路径段、错误值类型、非法线索状态各抛错并指出位置；MVU 快照导入后沿路径回放与原文一致；`readLedger` 前缀读取与分支切换正确；`pnpm check` 通过。

- [x] **R1-T01.a 台账事实补 storyTime 与 source** | 依赖：R1-T01 | DESIGN §7.1、ADR-0035
  完成：2026-11-07 迁移 v18 给 `state_diffs` 增加 `story_time_start`/`story_time_end`；`StateDiff` 增加 `storyTime`，存储层把起止都为空归一为 null；`validateLedgerDiff` 校验 `source` 四值与 `storyTime` 形状；新增 `readLedgerFacts` 读回事实及其元数据，`readLedger`/`listLedgerEntities` 值视图不变；正文模型的结构化写入来源改为 `model`；后续 R1 迁移编号顺延到 v19–v25；门禁通过
  做什么：
  - 按 v2.1 第二节，把 `storyTime`（事实成立的故事时间段，起止都可空）与 `source`（`model`、`settler`、`player`、`import`）作为每条台账事实的元数据；`storyTime` 进入存储，`source` 与现有 `StateDiff.source` 的关系写清楚。
  - `validateLedgerDiff` 校验两个字段的类型与来源取值；导入 MVU 的事实来源为 `import`。
  - `readLedger` 与 `listLedgerEntities` 能读回这两个字段；已有 R1-T01 路径表与快照语义不变。
  验收：九类台账事实都能带两个字段并读回；来源取值非法时抛错并指出位置；旧路径与快照回放结果不变；`pnpm check` 通过。

- [x] **R1-T01.b 渠道按岗位配置** | 依赖：M1-T02 | DESIGN §10.2
  完成：2026-11-07 `LlmChannelsConfig` 新增 `roles`（writer、settler、planner、judge），解析时校验角色名与模型别名；`resolveModelForRole` 按缺省 writer→main、其余→background 解析；`modelFamily` 由模型名映射家族，`createLlmClient` 对 judge 与 writer 同家族直接抛错；server 与 CLI 按 writer、settler 取模型，Trace 的 `llm.role` 记为 writer；`data/channels.yaml` 与示例补 roles；门禁通过（723 个测试）
  做什么：
  - `data/channels.yaml` 增加 `roles` 段：`writer`（正文）、`settler`（结算与抽取）、`planner`（导演与条件判断）、`judge`（评测裁判），每个角色指向一个已有模型别名；`channels.example.yaml` 补示例。
  - core 提供按角色解析的入口：`runChatTurn` 用 `writer`，结算与抽取用 `settler`，导演与条件判断用 `planner`，评测裁判用 `judge`；缺省时 `writer` 回落到 `main`，其余回落到 `background`。Trace 记录角色与实际渠道。
  - 创建路由时校验 `judge` 与 `writer` 的模型家族不同：由模型名映射家族（映射不到的按完整模型名比较），不比较 `baseUrl`（所有模型都经过同一个本地网关）；相同则直接失败并指出两个角色，不自动替换。
  验收：四个角色各自解析到配置的模型别名；缺省回落正确；`judge` 与 `writer` 同模型家族时创建路由抛错并指出角色；`baseUrl` 相同但模型不同不报错；Trace 里有角色与渠道；`pnpm check` 通过。

- [x] **R1-T01.c 生成长度默认值与截断统计** | 依赖：M4-T02、R1-T01.b | DESIGN §10.2 | ADR-0041（A6）
  完成：2026-11-07 故事设置 `maxTokens` 缺省值改为 4,096 与 writer 模型声明上限取小（`resolveDefaultMaxTokens`，server 运行时只在故事没有保存过设置时使用，`StoryStore.hasStorySettings` 区分）；路由器续写轮次只拿剩余输出额度；`TurnTrace.llm.truncation` 换成 `truncations` 数组，`detectTruncations` 同时检出 length、未闭合标签与突然中断；门禁通过（733 个测试）
  做什么：
  - 故事设置 `maxTokens` 的默认值改为 4096 与 writer 模型在 `data/channels.yaml` 里声明的 `maxTokens` 中较小的一个；已保存的故事设置不改。
  - 截断检测结果（以 length 结束、标签未闭合、正文突然中断）写进 Trace；不自动续写到设置上限之外。
  - R2-T02 的试玩记录与 R2-T06 的记分牌新增截断率。
  验收：默认值按渠道声明计算并有测试（渠道声明大于、小于 4096 两种）；三种截断都能在 Trace 里读到；`pnpm check` 通过。

**R1-T02 台账结算器**（已拆成 R1-T02.1 至 R1-T02.4） | 依赖：R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、M2-T03、M4-T03 | DESIGN §7.2 | I12 | ADR-0041（A2、A4、A5）

  总验收（四个子任务全部完成后由 R1-T99 逐条核对）：模型写入的路径不被覆盖，缺失路径被补齐；非法条目被拒绝并记录原因；不认识的名称两次出现后建档、只出现一次不建档；`knowledge` 按 `factId` 去重；与原文冲突的事实不覆盖并记入 `repairs`；重复执行不产生重复行；分支切换后另一分支的结算不参与；`block_format` 关闭时模板与现在逐字节一致；回合内后台客户端零调用。

- [x] **R1-T02.1 结算存储与任务条件** | 依赖：R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、M2-T03、M4-T03
  完成：2026-11-07 迁移 v19 `ledger_settlements` 与 v20 `entity_candidates`、`state_diffs.confidence`；`StateDiff`/`NewStateDiff` 与 `validateLedgerDiff` 增加置信度校验；存储层新增结算记录、实体候选与结算窗口读取；后台任务注册表按类型声明 `confirmed`/`settled` 入队条件；门禁通过（749 个测试）
  做什么：
  - 迁移 v19 新增 `ledger_settlements(node_id PRIMARY KEY, story_id, source, added_count, repairs, created_at)`；`repairs` 存 JSON 数组 `{path, action, reason}`，`action` 取 `fill`、`delete`、`rewrite_status`；同故事触发器与 M2-T02 的一致。
  - 迁移 v20 新增 `entity_candidates(story_id, normalized_name, kind, hits, first_node_id, created_at)` 并把 `state_diffs` 增加 `confidence` 列（0 到 1，空表示未结算）。
  - `StateDiff` 与 `NewStateDiff` 增加 `confidence`；存储层校验 0 到 1；`validateLedgerDiff` 校验置信度范围。
  - 存储层提供结算记录读写、实体候选写入与读取、以及“沿当前路径取最多 N 个已落定且尚未结算的助手楼层”。已落定指助手楼层已生成完成（中止保存的部分正文不算），不要求已确认。
  - 后台任务注册表按类型声明入队条件：`confirmed`（有子节点，现状）与 `settled`（已落定的助手楼层）；`settle` 使用 `settled`。
  验收：迁移后新表存在且跨故事的结算记录与候选被触发器拒绝；置信度越界抛错并指出位置；同一实体候选重复写入只累加 `hits`；窗口只取当前路径上已落定、未结算的助手楼层且排除中止楼层；`settled` 条件为尚未确认的助手楼层建任务、`confirmed` 条件不建；`pnpm check` 通过。

- [x] **R1-T02.2 结算任务与修复** | 依赖：R1-T02.1
  完成：2026-11-07 新增 `ledger/settle.ts`（`createSettleHandler`、`SETTLE_JOB_KIND`）：按 head 路径一次请求结算最多 4 个已落定未结算楼层，已有台账写入优先且先校验、不合格条目删除并记入 `repairs`，模型输出按楼层整体拒绝、整次请求失败交给任务框架重试；`StoryStore.deleteStateDiffs` 支持删除并失效快照；修复原因存 `ledger_settlements.repairs`（ADR-0046）；`dramaticer work` 注册 `settle` 任务（条件 `settled`）；新增 10 个测试；门禁通过（759 个测试）
  做什么：
  - 后台任务 `settle`：沿当前路径取最多 `settleWindowFloors`（默认 4）个已落定、尚未结算的助手楼层；一次请求返回 `{nodeId, diffs}` 数组。窗口内有解析失败或校验失败的条目时，该楼层整条拒绝并记入 `repairs`，其余楼层照常写入；整次请求失败按 M2-T03 的规则重试。
  - 落定即结算：回复落定后对 head 结算；被放弃的节点保留结算结果但不参与当前路径。
  - 输入顺序：本楼层已有的结构化写入（`state_update`、原生块）→ 校验与修复 → 只对缺失的路径调用模型。该楼层已有的写入优先，结算器跳过相同路径。修复动作限定为补值、删除非法条目、改写线索状态三种，修复原因进入 `repairs` 与 Trace。
  - 写入在一个事务里完成；同一楼层重复结算不新增 diff；结算结果与楼层绑定，swipe 与编辑的新节点各自结算。
  - 结算在间隙执行，`generateAssistantTurn` 不等待它；没有后台客户端时任务保持 pending。
  验收：模型写入的路径不被覆盖，缺失路径被补齐；非法条目被拒绝并记录原因；重复执行不产生重复行；分支切换后另一分支的结算不参与；回合内后台客户端零调用；没有后台客户端时任务保持 pending；`pnpm check` 通过。

- [x] **R1-T02.3 实体解析、knowledge 去重与冲突拒绝** | 依赖：R1-T02.2
  完成：2026-11-07 结算前把 `character`、`relation` 两端、`item`、`scene.places` 的名称按实体别名表换成规范名称；未建档名称在同一窗口出现两次以上或被正文模型直接写入时立即建实体，只出现一次时记入 `entity_candidates`；`knowledge` 值改为 `{factId, text}` 并按知情者与 `factId` 去重；请求携带 head 路径最近 6 楼原文，模型报告的冲突事实不写入、已有值保持不变，并以新增的 `conflict` 修复动作记入 `repairs`（ADR-0047）；新增 7 个测试；门禁通过（766 个测试）
  做什么：
  - 写入前把人物、地点、物品的名称对照实体与别名表规范化；不认识的名称进 `entity_candidates`，同一窗口出现两次以上或被模型直接写入时才建档。
  - `knowledge` 的值为 `{factId, text}`，`factId` 指向事件或线索，同一 `factId` 不重复写入。
  - 与最近 `conflictWindowFloors`（默认 6）楼原文矛盾的结算事实不覆盖已有值，拒绝写入并记入 `repairs`；R1-T07.a 把这些记录转成待审变更卡。
  验收：不认识的名称两次出现后建档、只出现一次不建档；`knowledge` 按 `factId` 去重；与原文冲突的事实不覆盖并记入 `repairs`；`pnpm check` 通过。

- [x] **R1-T02.4 块格式说明段** | 依赖：M1-T04
  完成：2026-11-07 `createDefaultContextTemplate` 新增 `blockFormat` 选项（默认关闭），开启后在协议段之前插入静态段 `block_format`，按 `structuredOutput` 分别给出 `state_update` 与 `plot_note` 的标签形式或工具参数形式；关闭时模板与改动前逐字段一致；新增 3 个测试；门禁通过（769 个测试）
  做什么：
  - 原生模板新增可选的 `block_format` 段，说明 `state_update` 与 `plot_note` 的格式，默认关闭；开启后只说明格式，不要求模型输出（I13）。
  验收：`block_format` 关闭时模板与现在逐字节一致；开启后模板包含两种写入的格式说明且不出现强制输出要求；`pnpm check` 通过。

- [x] **R1-T02.a 现场分析** | 依赖：R1-T02 | DESIGN §7.3、§9 | ADR-0041（A2）
  完成：2026-11-07 迁移 v21 新增 `scene_analyses`（楼层主键、同故事触发器、归属不可改）；后台任务 `scene` 读该楼层的结算快照与路径上最近 6 楼原文，由后台客户端（settler 角色）输出一段分析并以 token 估算器记录长度，同一楼层重跑覆盖同一行；结算记录缺失时抛 `BackgroundJobDeferredError`，`drain` 接住后退回 pending 并撤销执行计数（ADR-0048）；新增 `scene` 槽位与 `createSceneSlotProvider`，取当前路径上最近一条分析，没有时记为 `missing-slot`；默认模板把该段放在记忆之后、导演之前；新增 5 个测试与一次临时脚本冒烟（同一轮 drain 先结算再分析、槽位 `included`）；门禁通过（774 个测试）
  做什么：
  - 迁移 v21 新增 `scene_analyses(node_id PRIMARY KEY, story_id, text, token_count, created_at)`，同故事触发器与 M2-T02 一致。
  - 后台任务 `scene`：读投机结算后的台账快照与最近 `sceneWindowFloors`（默认 6）楼原文，由 `settler` 角色输出一小段，写明在场人物各自想要什么、知道什么、张力在哪里；长度按 token 估算器控制；同一楼层重复执行覆盖同一行。现场分析不落后一楼：读的是本楼层的结算结果，结算尚未完成时任务保持 pending。
  - 新增 `scene` 槽位提供者，取当前路径上最近一条分析；没有时槽位为空并在 Trace 里标注缺失；注入位置在历史之后、导演之前。
  - 分析在间隙执行，回合内不调用模型；结果不写台账，也不修改楼层原文。
  验收：假客户端执行一次任务后分析入库；同一楼层重跑不新增行；结算未完成时任务保持 pending；槽位取最近一条且分支切换后不跨分支；回合内后台客户端零调用；空窗口不调用模型；`pnpm check` 通过。

- [x] **R1-T02.b 块的 prompt 视图** | 依赖：M1-T05、M2-T12、M4-T02 | DESIGN §6、§9 | ADR-0044
  完成：2026-11-07 新增 `blocks/history.ts`（`HistoryBlockPolicy`、`DEFAULT_RECENT_RAW_FLOORS`、`renderHistoryView`）：`full` 与改动前的 `renderContextView` 逐字节一致；`default` 在更早楼层省略显示类块（选项、状态栏、变量更新、分析、图片），最近 1 楼不套用这层省略但仍按块类型策略渲染，未知块、未闭合块与围栏代码块按原文保留；`DEFAULT_BLOCK_TYPES` 补四个原生显示类块；历史槽位改用新函数并把 `policy`、`recentRawFloors`、按块类型的省略字符与估算 token 写进 `ContextTraceEntry.history`；故事设置新增 `historyBlockPolicy`（迁移 v22，后续迁移编号顺延），server、`dramaticer chat` 与回放生成器从故事设置读取；新增 9 个测试；离线统计脚本 `pnpm r1:history-view` 给出 3 个 legacy 对话各 20 楼窗口 100,776 → 78,910 token（21.7%），写入 `docs/dev/reports/R1.md`；门禁通过（783 个测试）
  做什么：
  - core 新增历史渲染函数：用 `BlockParser` 取出每楼正文里的块，按块类型的上下文策略（保留 / 删除 / 保留到深度 N / 压缩）生成 prompt 视图。默认策略：状态栏、变量更新、分析、选项、图片这类显示类块在历史里省略；最近 `recentRawFloors`（默认 1）楼保留完整原文；页眉、旁白、备忘等语义块保留正文；未知块、未闭合块与代码块按原文保留。
  - `history` 槽位提供者改用这个函数；原文不动（I8），不写回数据库。策略按故事设置可配（`historyBlockPolicy`：`default`、`full`、按块类型覆盖），`full` 与现有实现逐字节一致。
  - Trace 记录每种块被省略的字符数、估算 token 数与生效的策略；没有省略时不写空记录。
  - 在 3 个 legacy 对话的固定分支点上离线统计省略前后的 token（不调用模型），数字写进 `docs/dev/reports/R1.md`。
  验收：同一楼层在 `full` 下与现有渲染逐字节一致；显示类块在更早楼层被省略、最近一楼保留；未知块与未闭合块不被删除；Trace 的省略量与块类型可读；原文与 `getStateDiffs` 结果不变；离线统计给出省略前后 token；`pnpm check` 通过。

- [x] **R1-T03 批量事件抽取** | 依赖：R1-T02、M2-T05 | DESIGN §7.3
  完成：2026-11-07 事件任务改为批量窗口：每次沿当前路径取最早一段连续未抽取的已确认助手楼层（默认 8），输入带窗口前后各一楼作为边界，模型返回 `{nodeId, events}` 数组；窗口外或重复楼层整窗拒绝，任一楼层非法时整窗不写入并交给任务框架重试；迁移 v23 新增 `event_extractions`，窗口内没有事件的楼层也记为已抽取，重跑不再调用模型；`StoryStore` 新增 `listExtractedEventNodeIds` 与 `recordEventExtractions`（事件与抽取记录同一事务）；memory-eval 的事件回填改为按已确认助手楼层驱动；新增 7 个测试；门禁通过（790 个测试）。后续迁移编号顺延到 v24–v31
  做什么：
  - 把 `events` 任务从逐楼抽取改为批量窗口：一次请求处理最多 `eventWindowFloors`（默认 8）个沿当前路径连续、尚未抽取的已确认助手楼层；输入包含窗口内原文与前后各一楼作为边界上下文。
  - 模型返回 `{nodeId, events}` 数组，每条事件沿用 M2-T05 的字段与校验；`nodeId` 必须在窗口内，未知楼层或重复楼层整窗拒绝并记录原因。
  - 事件仍按 `source_node_id` 写入只追加表；窗口内任一楼层非法时整窗不写入并按任务框架重试；重跑不产生重复行。
  - 事件窗口与结算窗口互不阻塞，两者都使用后台客户端与独立限速。
  验收：8 个楼层只发一次请求；事件归属到正确的楼层；未知或重复 `nodeId` 整窗拒绝；重跑无重复；窗口跨越分支时只取当前路径；单元测试用假客户端且零网络；`pnpm check` 通过。

- [x] **R1-T04.a 批量抽取管线与断点续跑** | 依赖：R1-T03
  完成：2026-11-07 新增 `evalset/events-backfill.ts` 与 `evalset/events-cli.ts`（`pnpm --filter @dramaticer/st-compat events-backfill`）：把 manifest 里全部 legacy 对话导入持久数据库 `eval-private/memory-cache/eval.db`（已有故事跳过），导入卡牌实体与 lore、块向量，再用生产的批量窗口处理器逐窗口抽取事件；`--story`、`--limit`（跨故事累计窗口数）、`--resume`（保留数据库；不带时先删库重新导入）、`--db`；模型响应缓存目录固定为 `eval-private/memory-cache/events/`，向量缓存 `eval-private/memory-cache/embeddings/`；每个窗口打印进度、累计楼层、累计事件与累计请求数（缓存命中单列）；窗口连续失败 3 次才终止，窗口未写入抽取记录时立即抛错；导出 `selectTargets`、`importStoryEntities` 与三个故事计数函数；新增 4 个测试（3 窗口各 8 楼一次请求、续跑跳过已抽取窗口且事件不变、未知故事失败、CLI 缓存目录与 `--resume` 重建数据库）；门禁通过（794 个测试）
  做什么：
  - 新增 `pnpm --filter @dramaticer/st-compat events-backfill`：把 legacy 评测对话导入 `eval-private/memory-cache/eval.db`，建实体、lore、块与向量，然后按路径窗口批量抽取事件。
  - 支持 `--story <id>`、`--limit <windows>`、`--resume`、`--db <path>`；每处理一个窗口打印进度与累计请求数；模型响应按输入 hash 缓存到 `eval-private/memory-cache/events/`，中断后从缓存继续。
  - 只写私有目录与临时数据库；统计输出不带原文。
  验收：假客户端下 3 个窗口跑通并写出事件；中断后 `--resume` 从缓存继续且不重复调用；同一窗口重复运行结果一致；`pnpm check` 通过。

- [x] **R1-T07 用户意志捕获** | 依赖：R1-T01、R1-T02 | DESIGN §7.1、§9
  完成：2026-11-07 新增后台任务 `user_will`（`ledger/user-will.ts`）：沿当前路径取最近 6 条玩家消息，模型返回 `{kind, text, sourceQuote}`，引文必须逐字出现在窗口内的玩家楼层里，否则整次拒绝并指出条目；正文规范化后取 SHA-256 前 16 位作为稳定 id（`will-…`），同一 id 在同一回复或当前路径上已存在时跳过，只追加；台账事实写在任务所在助手楼层、来源 `settler`；新增 `user_will` 槽位（默认模板放在导演之后、协议之前，优先级 110，高于历史段）与 `createUserWillSlotProvider`；`dramaticer work` 注册该任务；ADR-0051；新增 12 个测试；门禁通过（806 个测试）
  做什么：
  - 后台任务 `user_will`：在间隙读取最近若干条玩家消息，识别明确表达的偏好、底线与纠正；返回 `{kind, text, sourceQuote}` 数组，`kind` 取 `preference`、`boundary`、`correction`。
  - 写入台账路径 `["userWill", <稳定 id>]`，值包含正文、来源楼层与创建时间；同一正文按规范化去重；只追加，不自动删除。
  - 组装上下文时把用户意志放在预算取舍的第一位；分支切换后只注入当前路径上的条目。
  - 模糊的陈述、疑问与角色台词不捕获；单元测试用固定文本 fixture 验证正负例。
  验收：明确的偏好、底线与纠正各被捕获；模糊陈述与角色台词不产生条目；重复表达合并；注入优先级最高；分支隔离；非法输出整条拒绝并记录原因；`pnpm check` 通过。

- [x] **R1-T07.a 自然语言修订记忆** | 依赖：R1-T07、R1-T01.a | DESIGN §7.1
  完成：2026-11-07 迁移 v24 新增 `ledger_change_cards`（任务给出的九个字段之外增加 `source` 与 `rejection_reason`，ADR-0052）；新增 `ledger/cards.ts`（修改校验、稳定 id、批准、拒绝、回滚）与 `ledger/revision.ts`（`memory_revision` 任务按引文定位玩家的明确修改要求，一条非法修改整卡拒绝并记录原因，重复执行不新增卡片）；结算器在同一个事务里把冲突提案转成来源为 `settler` 的待定卡；批准把修改写成 `source` 为 `player` 的事实、玩家卡片同时记入 `userWill`，回滚按原值追加反向 diff；新增 `dramaticer ledger cards/--approve/--reject/--rollback`；ADR-0052；新增 10 个测试；门禁通过（816 个测试）。后续迁移编号顺延从 v25 起
  做什么：
  - 迁移 v24 新增 `ledger_change_cards(id, story_id, source_node_id, text, diffs, before, status, created_at, decided_at)`，`status` 取 `pending`、`approved`、`rejected`、`rolled_back`；`diffs` 与 `before` 存 JSON，写入前用 `validateLedgerDiff` 校验。
  - 后台任务 `memory_revision`：读取最近的玩家消息，识别明确的修改要求，生成变更卡草案；模糊陈述、疑问与角色台词不生成。
  - 批准时把 `diffs` 写成 `source` 为 `player` 的事实，同时把同一段话写进 `userWill`；拒绝只改状态；已批准的回滚写反向 diff 恢复 `before` 里的原值，保留原事实的变更历史。
  - 结算器记下的冲突（R1-T02 的 `repairs`）转成待审变更卡，卡片来源标为 `settler`；批准后才覆盖台账。
  - CLI：`dramaticer ledger cards <story>` 列出待定卡片，`--approve <id>`、`--reject <id>`、`--rollback <id>` 执行对应动作；R5 面板复用同一接口。
  验收：明确的修改要求生成一张待定卡；结算冲突生成一张待定卡且批准前台账不变；批准后事实来源为 `player` 且进入用户意志；拒绝不写台账；回滚后快照回到批准前的值；非法 diff 整卡拒绝并记录原因；重复批准不重复写入；`pnpm check` 通过。

**R1-T07.b 间隙合并调用 `gap_pass`**（已分成 R1-T07.b.a 至 R1-T07.b.d） | 依赖：R1-T02.a、R1-T03、R1-T07、R1-T07.a | DESIGN §7.3、§9 | ADR-0041（A3）

  总验收（四个子任务全部完成后由 R1-T99 逐条核对）：一次调用产出多段并各自校验入库；单段非法只拒绝该段；过期任务被丢弃并计数；延后档只在长间隙或会话结束后运行；间隙未完成率可读；对比结果写进 ADR；`pnpm check` 通过。

- [x] **R1-T07.b.a 合并调用的共享准备与写入** | 依赖：R1-T02.a、R1-T03、R1-T07、R1-T07.a
  完成：2026-11-07 从四个后台任务里提取可复用的准备与写入函数：`prepareSettlement`、`buildSettlementMessages`、`applySettlementProposals`（结算窗口与冲突窗口的读取、实体解析、diff 与变更卡写入同一事务）、`saveSceneAnalysisText`、`readExistingWills`、`applyCapturedUserWills`、`applyRevisionDrafts`；四个任务的处理器改为调用这些函数，输出与校验规则不变；`FloorProposals`、`WindowFloor`、`SettlementWindow` 等类型一并导出；门禁通过（816 个测试）。
  做什么：
  - 把结算、现场分析、用户意志与修订草案的准备与写入从各自的后台任务里提取成可复用函数：`prepareSettlement`、`buildSettlementMessages`、`applySettlementProposals`、`saveSceneAnalysisText`、`readExistingWills`、`applyCapturedUserWills`、`applyRevisionDrafts`。
  - 四个独立后台任务改为调用这些函数，行为与校验规则不变；这一子任务不生成合并调用。
  验收：现有四个任务的测试全部保持通过；新函数从 `@dramaticer/core` 导出；同一输入下独立任务的写入结果与改动前一致；`pnpm check` 通过。

- [x] **R1-T07.b.b `gap_pass` 处理器** | 依赖：R1-T07.b.a
  完成：2026-11-07 新增后台任务 `gap_pass`（`ledger/gap-pass.ts`，入队条件 `settled`）：一次调用输出 `{settlement, scene, userWill, revision, events}`，各段用 `JSON.stringify` 还原后交给既有解析器与 R1-T07.b.a 的写入函数；段落缺失按空处理，单段解析或校验失败只拒绝该段、原因写进迁移 v25 的 `gap_pass_runs`；任务楼层的结算既没有记录也不在待结算窗口时抛 `BackgroundJobDeferredError`，不发出请求；故事设置新增 `gapPassEnabled`（默认关闭），`dramaticer work` 按故事开关过滤 `gap_pass`；`extract.ts` 导出 `selectEventWindow`、`formatEventWindow` 与 `recordExtractedEvents`，结算提示词的命名空间说明提成 `LEDGER_PATH_GUIDE`；新增 6 个测试；门禁通过（822 个测试）。后续迁移编号顺延到 v26–v32
  做什么：
  - 新增后台任务 `gap_pass`（入队条件 `settled`）：一次请求同时产出结算数组、现场分析、用户意志与修订候选，事件作为可选段；各段用 `JSON.stringify` 还原后交给对应解析器，写入走 R1-T07.b.a 的函数。
  - 段落缺失按空处理；单段解析或校验失败只拒绝该段并记录原因，其余段落照常入库；结算段先写入，现场分析段随后读得到结算记录。
  - 在 `dramaticer work` 注册；故事设置增加开关，默认关闭，等 R1-T07.b.d 的对比结论再决定默认值。
  验收：一次调用产出四段并各自校验入库；单段非法只拒绝该段；开关关闭时不建任务；回合内后台客户端零调用；`pnpm check` 通过。

- [x] **R1-T07.b.c 两档队列、过期丢弃与间隙未完成率** | 依赖：R1-T07.b.b
  完成：2026-11-07 后台任务类型声明档位 `gap`（默认）与 `deferred`，注册表把事件抽取、摘要、NPC 议程标为 `deferred`；`drainBackgroundJobs` 新增 `gapSeconds` 与 `sessionEnded`，只在会话结束或间隙达到故事设置 `gapPlanSeconds`（迁移 v26，默认 212，非负整数）时执行延后档；执行前比对当前 head 路径，`background_jobs.status` 增加 `discarded`（迁移 v26 重建表并保留行），过期任务标为丢弃并计数，切回旧分支时补建会把丢弃行翻回 `pending`；存储层新增 `countBackgroundJobs` 与 `discardBackgroundJob`，`readGapWorkBacklog` 读出关键间隙工作的未完成比例；`dramaticer work` 新增 `--gap-seconds`，结束时打印积压与未完成率；ADR-0054；新增 8 个测试；门禁通过
  做什么：
  - 后台任务类型声明档位：`gap`（下一轮要用）与 `deferred`（可延后）；`gap` 包含 `gap_pass`、结算、现场分析、用户意志、修订草案与向量；`deferred` 包含事件抽取、摘要、NPC 议程与后续的世界书预筛。
  - `drainBackgroundJobs` 只在长间隙或会话结束后执行 `deferred` 档；长间隙阈值来自故事设置 `gapPlanSeconds`（默认 212），由调用方传入本轮间隙秒数。
  - 执行前检查任务所在楼层是否还在当前 head 路径上，已经不在的直接丢弃并计数；计数与“下一轮开始时关键间隙工作未完成”的比例通过存储层查询读出。
  验收：延后档在短间隙不执行、在长间隙与会话结束后执行；过期任务被丢弃且计数增加；间隙未完成率可读；`pnpm check` 通过。

- [x] **R1-T07.b.d 合并与分开的结算准确率对比** | 依赖：R1-T07.b.c、R1-T04.a
  完成：2026-11-07 新增 `evalset/gap-pass-compare.ts` 与 `gap-pass-compare` CLI：同一段对话导入两个数据库，独立任务档按结算、现场分析、用户意志、修订草案逐楼层执行，合并档每楼层执行一次 `gap_pass`；两边共用渠道配置、模型与结算窗口，逐楼层对比结算写入，每档完成写入 sidecar 以支持中断续跑；20 楼样本上独立任务 234 条 diff、非法 0、冲突 1，合并调用 101 条 diff、非法 3、冲突 2、结算段整段拒绝 12 次，路径一致率 13.9%、事实一致率 4.0%；`gapPassEnabled` 保持默认关闭，改进任务见 R1-T07.b.d.a 与 R1-T07.b.d.b（ADR-0055）；门禁通过
  做什么：
  - 用评测对话的至少 20 个楼层，分别跑 `gap_pass` 与四个独立任务，用同一批模型输出或同一批次请求，对比结算 diff 的数量、路径一致率、非法条目比例与冲突数量。
  - 结论写 ADR；准确率明显下降时把 `gap_pass` 保持默认关闭，并在 TASKS 记下后续改进任务。
  验收：样本不少于 20 个楼层；对比口径与数字写进 ADR；结论决定开关默认值；`pnpm check` 通过。

- [x] **R1-T07.b.d.a 合并调用的分段边界与拒绝粒度** | 依赖：R1-T07.b.d
  完成：2026-11-07 `gap_pass` 的系统提示词按本楼层实际可写的段落拼接（没有结算窗口不提 `settlement`，没有事件窗口不提 `events`，没有玩家消息不提 `userWill` 与 `revision`），模型仍输出未描述的段落时按空处理；楼层 id 只出现在可写入的位置（结算窗口、事件窗口的助手楼层），冲突窗口、现场分析上下文与玩家消息不再带 id；`settlement` 与 `events` 段的窗口外与重复条目逐条丢弃并记原因，其余条目照常写入，全部被丢弃时不写结算记录；迁移 v27 给 `gap_pass_runs` 增加 `dropped_entries`，对比工具统计丢弃数；ADR-0056；20 楼样本重跑后合并调用结算段整段拒绝 0 次、丢弃 0 条、diff 116 条（原 101），路径一致率 9.7%（原 13.9%）、事实一致率 3.6%（原 4.0%）；门禁通过（838 个测试）
  做什么：
  - 每个段落的输入只包含该段落可以写入的楼层；没有待结算楼层时不再要求模型输出结算段，模型仍然输出时按空处理，不计入拒绝。
  - 结算与事件段里窗口外的楼层 id 逐条丢弃并计数，不整段拒绝；其余合法条目照常写入。
  - 用 R1-T07.b.d 的 20 楼样本重跑对比，结算 diff 数量与路径一致率作为验收数字。
  验收：20 楼样本上结算段整段拒绝次数为 0；窗口外条目按条丢弃并记录原因；其余条目写入不受影响；`pnpm check` 通过。

- [x] **R1-T07.b.d.b 后台结构化输出的 token 预算** | 依赖：R1-T07.b.d
  完成：2026-11-07 后台 `background` 模型的输出上限改为 32,768（`channels.example.yaml` 与 `data/channels.yaml`），结构化请求继续使用模型声明上限；`reasoning:"off"` 在该网关仍产生思考并占用输出 token（复测 26 个思考 token），因此不采用；20 楼样本按 settler → background 复跑，20 个响应全部以 `stop` 结束、无 `length` 截断，完成 token 最大 24,065（思考 16,587），结算段整段拒绝 0 次、执行记录的 `rejected_segments` 全为空、窗口外条目丢弃 4 条，结算 diff 175 条、失败 1 次（内容政策拒答文本）；ADR-0057；门禁通过（838 个测试）
  做什么：
  - 生产默认 `maxTokens` 8192 在带思考的后台模型上会把 4 个楼层的结算 JSON 截断（评测里观察到思考约占 7 千 token）；决定是提高后台模型的输出上限，还是让结构化抽取请求关闭或限制思考。
  - 配置改变要写进 `channels.example.yaml` 说明与 ADR，并按 R1-T07.b.d 的样本复跑一次确认结算不再整段解析失败。
  验收：默认配置下 4 个楼层的结算请求不再因 `length` 截断；复跑样本的结算段拒绝原因里不再出现 JSON 解析失败；`pnpm check` 通过。

- [x] **R1-T99 R1 最小集验收** | 依赖：R1-T01 至 R1-T04.a（不含记忆增强）
  完成：2026-11-07 门禁通过（93 个测试文件、838 个测试，3 个 live 跳过）；live 测试 embeddings 通过，渠道体检与三轮对话因正文路由 `opendesign/deepseek-v4.1-flash` 的 membership entitlement 错误失败，改用 `main-fallback` 手工跑 3 轮正文通过（0 截断）；108 个 R1 目标测试单独重跑通过；`docs/dev/reports/R1.md` 记录结算与 `gap_pass` 数字（独立 234 条 diff / 63 次请求，合并 175 条 / 20 次请求，路径一致率 13.3%）、prompt 视图 100,776 → 78,910 token、事件抽取 584 楼 → 75 次请求、间隙未完成率 78.3%（一轮 20 条上限后 72 条待办）、截断 0/20 与 0/3；I8、I11、I12、I13、I15 复核通过；R3 任务确认不需改写；HUMAN-11 记录正文路由待人类换用回退路由
  做什么：同 M0-T99；重跑门禁与 live 测试；逐条核对 R1-T01 至 R1-T04.a 与 R1-T02.b；复核 I11（后台工作不进入回合）、I12（所有写入经过校验）、I13（不强制模型输出结构）、I8（prompt 视图不修改原文）；在 `docs/dev/reports/R1.md` 总结结算器与 `gap_pass` 的实测数字、块的 prompt 视图省略的 token、事件抽取的请求数、间隙未完成率与截断率；确认 R3 任务。记忆增强的验收见 R1-T99.a。
  结果写 `MILESTONE_DONE`。

## R3：快回合（细化）

> v3 顺序（ADR-0044）：R1 最小集之后先做快回合，深回合在最小界面之后（R3b）。

- [x] **R3-T01 快回合循环与模式开关** | 依赖：R1-T99、M2-T14 | DESIGN §10.1 | I6
  完成：2026-11-07 新增 `core/src/chat/mode.ts`（`TurnMode`、`DEFAULT_MAX_READ_ROUNDS = 3`、`isTurnMode`、`assertMaxReadRounds`、`assertTurnModeSupported`）；故事设置新增 `turnMode` 与 `maxReadRounds`（迁移 v28，后续计划编号顺延到 v29–v35），单轮参数优先；解析唯一入口 `resolveTurnMode` 在 `runChatTurn` 追加用户楼层之前与 `generateAssistantTurn` 里校验，请求 deep 直接抛错并指出 R3b；执行器软上限改为可配（默认 3），返回 `capped`；Trace 增加 `turnMode` 与 `tools.maxRounds`、`tools.capped`；`dramaticer chat --mode fast|deep`；新增 9 个模式测试与 3 个 CLI 测试；门禁通过（852 个测试）
  做什么：
  - core 定义 `TurnMode = "fast" | "deep"`；故事设置 `turnMode` 与单轮参数都可以指定模式；快回合是一次主调用加按需的读取工具，读取工具软上限 `maxReadRounds`（默认 3，可配），达到上限后正常收束并记录 Trace。
  - 程序不自动切换：没有任何代码路径根据轮数、工具调用数、错误或预算改变模式。请求深回合而 R3b 尚未实现时直接抛错并指出阶段。
  - Trace 记录模式、工具轮数、软上限与是否因上限收束；`dramaticer chat --mode fast|deep` 与故事级锁定都走同一处校验。
  验收：快回合只发一次主调用加不超过软上限的读取工具轮；设置变化、工具失败与重试都不改变模式（逐个用例）；请求 deep 时抛错并指出 R3b；Trace 字段可读；`pnpm check` 通过。

- [x] **R3-T02 文本协议工具传输** | 依赖：R3-T01、M1-T03 | DESIGN §10.2
  完成：2026-11-07 模型配置新增 `tools.transport`（`native` 或 `text`），`resolveToolTransport` 在没有显式配置时按 `probe.functionCalling` 决定（不支持就 `text`，其余 `native`）；`chat/tool-protocol.ts` 解析 `<tool name="…">{json}</tool>`、生成发给模型的工具说明、流式输出里隐藏调用片段；执行器两种传输共用参数校验、执行器、软上限与写入收集，文本协议的非法 JSON、未知工具与写入工具都作为工具结果返回；Trace 的 `tools` 增加 `transport`、`calls` 改为 `{name, ok, error}` 并新增 `rejected`；server 运行时与 `dramaticer chat` 按模型配置传入传输方式；新增 6 个传输测试与 4 个配置测试；门禁通过（859 个测试）
  做什么：
  - 按渠道体检结果选择工具传输方式：`tools.transport` 取 `native` 或 `text`（写在 `data/channels.yaml`，体检可以建议默认值）；文本协议解析 `<tool name="…">{json}</tool>`，与函数调用共用同一套 JSON Schema 校验与执行器。
  - 文本协议下的非法 JSON、未知工具、只写工具与超参数上限都作为工具结果返回给模型并记录 Trace，不中断正文；达到软上限时停止执行工具。
  - 读取工具软上限对两种传输相同；写入工具仍然只收集不执行（I12）。
  验收：同一工具在两种传输下产生相同执行结果与 Trace；非法参数返回错误结果且正文继续；未知工具被拒绝并记录；达到软上限后不再执行；假客户端测试零网络；`pnpm check` 通过。

- [x] **R3-T03 写作契约与默认模板** | 依赖：M1-T04、R1-T02.b | DESIGN §9
  完成：2026-11-07 默认模板把 `protocol` 段移到最后一个段落（`history` 之后），契约文本加入四条原则（玩家输入是本轮演出指引、玩家不是上帝、每轮有剧情推进、遵守用户意志），两种结构化输出模式共用；`block_format` 开启时插在 `history` 与 `protocol` 之间，关闭时除 `protocol` 外与改动前逐字段一致；`WRITING_CONTRACT_SEGMENT_ID` 新增，`assertContextTemplate` 在该片段出现时要求它最后，错误写出模板 id、位次与后续片段数，保存路径复用同一校验；Trace 的静态段条目给出 `template:dramaticer-default/protocol` 来源与 token；ADR-0058；新增 6 个测试并同步消息顺序与 Trace 顺序断言；门禁通过（96 个测试文件、865 个测试）
  做什么：
  - 默认原生模板末尾（最靠近生成的位置）增加 `protocol` 写作契约段：玩家输入是本轮演出指引、不是已经发生的剧情；玩家不是上帝，角色可以按人设拒绝、反对、打断；每轮有剧情意义，不重复之前的正文；遵守台账里的用户意志。
  - 契约段是静态段，可以被故事模板覆盖；模板校验保证 `protocol` 始终是最后一个段落。`block_format` 保持可选、默认关闭（I13）。
  验收：默认模板最后一个段落是 `protocol`；编辑模板后仍保证契约在最后，违反时保存被拒绝并指出字段；Trace 里契约段来源与 token 可读；关闭 `block_format` 时模板与现状的差异只有契约段；`pnpm check` 通过。

- [x] **R3-T04 快回合真实渠道验收** | 依赖：R3-T01、R3-T02、R3-T03 | 使用 `.env` 里的真实渠道
  完成：2026-11-08 用 `main-fallback`（`auto/deepseek-v4.1-flash`，Trace 为 `group/auto-deepseek-v4-1-flash`）与固定合成卡连续跑 20 轮快回合：20/20 成功，首字 P50 1,448 毫秒、P90 3,435 毫秒，生成 P50 2,666 毫秒、P90 4,988 毫秒；工具轮 0 轮 17 次、1 轮 3 次，最大 1 未达软上限 3，读取调用 5 次；模型请求 23 次，截断 0/20；私有报告 `eval-private/reports/R3-fast.md`，统计版 `docs/dev/reports/R3-fast.md`，原始数据 `eval-private/reports/R3-fast.json`；门禁通过（96 个测试文件、865 个测试）
  做什么：
  - 用真实渠道连续跑 20 轮快回合（固定卡与故事），记录首字延迟、生成耗时、工具轮数分布、截断率与请求数，与 F0 的 ST 基线（首字 P50 4.5 秒、生成 P50 50 秒）并列。
  - 私有报告写 `eval-private/reports/R3-fast.md`，统计版写 `docs/dev/reports/R3-fast.md`，只含数字与模型别名。
  验收：20 轮完成且失败有原因；首字与生成耗时有分布；工具轮数不超过软上限；统计版无私有信息；`pnpm check` 通过。

- [x] **R3-T99 R3 验收** | 依赖：R3 全部任务
  完成：2026-11-07 门禁通过（96 个测试文件、865 个测试，3 个 live 跳过）；41 个 R3 相关测试单独重跑通过（`turn-mode` 8、`chat-tool-loop` 6、`tool-transport` 6、`writing-contract` 6、`chat-cli` 15）；`docs/dev/reports/R3.md` 逐条核对 R3-T01 至 R3-T04 的验收标准，复核 I6（模式只由 `resolveTurnMode` 解析、写入只有玩家设置、server 无引用）与 I13（工具与结构化输出都不强制，`block_format` 默认关闭）；确认真实渠道数字来自 R3-T04，确认 O 与 R2 的依赖全部完成、迁移编号 v29–v31 与 schema v28 不冲突
  做什么：逐条核对快回合、模式开关、文本协议与写作契约；复核 I6（程序不自动切换）、I13；写 `docs/dev/reports/R3.md`；确认 O 与 R2 任务。
  结果写 `MILESTONE_DONE`。

## O：开局与方向（细化）

> v3 主菜第一（ADR-0044）。依据：1–10 楼重 roll 率 24.9%，「不推进剧情」与「没听用户的指示」在 1–10 楼各占 25.0%。

- [x] **O-T01 开局包** | 依赖：R1-T02、R1-T07、M4-T03 | DESIGN §8.4
  完成：2026-11-08 迁移 v29 新增 `opening_packs` 并把 `background_jobs.node_id` 改为可空；入队条件新增 `story`（必须提供 `needsRun`），drain 只在摘要变化时补建一条无楼层任务，`BackgroundJob.nodeId` 改为 `string | null`，楼层处理器经 `requireJobNodeId` 读取；新增 `core/src/opening`：`collectOpeningInput` 汇总角色卡提示词、常驻世界书、模板内容与首条玩家消息并生成摘要，`createOpeningHandler` 严格校验 JSON（字段、空字符串、未知人物）后按故事覆盖同一行，`openingPackNeedsRun` 输入不变时不重跑；`dramaticer work` 注册 `opening`；ADR-0059；新增 9 个测试与一次 `runWorkCli` 冒烟（故事级任务、1 次模型调用、开局包入库）；门禁通过（97 个测试文件、874 个测试，3 个 live 跳过）
  做什么：
  - 迁移 v29 新增 `opening_packs(story_id PRIMARY KEY, payload, source_node_id, created_at)`；`payload` 含开场地点与时间、在场人物与各自当下想要什么、第一个可行动冲突、三条可选开场方向。
  - 故事创建或导入后入队后台任务 `opening`：输入是角色卡、世界书常驻条目与玩家开场白（没有开场白时只用卡）。模型输出严格 JSON，缺字段、空字符串、未知人物整包拒绝并按任务框架重试；同一故事重复执行覆盖同一行，卡或模板变化后重新生成。
  - 玩家开场白在首次输入之后才存在时，以首条玩家消息为输入在间隙生成，下一轮开始前完成；首次输入之前只生成不含开场白的版本。
  - 开局包只作导演输入，不写台账事实（I12），回合内不调用模型（I11）。
  验收：故事导入后生成一包并入库；缺字段整包拒绝并保留原因；重复执行只覆盖不新增；开局包不进台账；回合内后台客户端零调用；`pnpm check` 通过。

- [x] **O-T02 开场导演与前 10 楼强度** | 依赖：O-T01、M3-T02 | DESIGN §8.4 | I9
  完成：2026-11-08 `DirectorConfig` 增加 `openingFloors`（默认 10）与 `openingIntensity`（`setup`、`natural`、`detonate`，默认 `natural`）并校验；新增导演机制 `opening`（优先级 35，注册在线索之后），楼层深度取当前路径助手楼层数，深度够时按开局包拼出本楼目标、人物行动（`natural` 起）与三条方向（`detonate`），`signals.opening` 写楼层深度、强度档位与使用的字段；`readOpeningPack` 复用 `validateOpeningPackPayload` 校验存下来的包；故事设置的导演配置读取时与默认值合并；新增 7 个测试与旧配置兼容测试，同步 4 处机制列表断言；ADR-0060；门禁通过（98 个测试文件、882 个测试，3 个 live 跳过）
  做什么：
  - `DirectorConfig` 增加 `openingFloors`（默认 10）与 `openingIntensity`；当前路径助手楼层数小于 `openingFloors` 时，新增的开局机制以开局包为输入产生一条具体建议（本楼目标、在场人物各自的行动、可行动冲突），优先级高于线索年龄与节奏机制。
  - 机制是同步纯函数、不调用模型；建议只作为建议注入玩家消息末尾；没有开局包时退回现有机制；开关关闭时不产生建议。
  - 决策记录的 `signals` 写出发强度档位、使用的开局包字段与楼层深度。
  验收：前 10 楼使用开局建议，第 11 楼恢复常规机制；无开局包时行为与现状一致；实时选择零模型调用；关闭导演时不写决策记录；`pnpm check` 通过。

- [x] **O-T03 首楼多候选** | 依赖：O-T01、M2-T01、M4-T03 | DESIGN §8.4
  完成：2026-11-08 迁移 v30 新增 `opening_candidates`（故事内递增 `ordinal`，状态 `pending`、`chosen`、`discarded`）；`StoryStore` 新增 `appendOpeningCandidates`、`listOpeningCandidates`、`getOpeningCandidate`、`chooseOpeningCandidate`（选中时在同一事务里把正文原样追加为根部首个助手楼层，其余待选改为丢弃，已有楼层或非待选状态直接失败）；后台任务 `opening_candidates` 入队条件 `story`，有素材、无楼层、无待选候选时才生成，模型输出 `{"candidates":[...]}` 严格校验 2–3 条，非法整批拒绝；`dramaticer open --story <id> --db <path> [--generate <n>] [--list] [--pick <id>]`；新增 14 个测试；ADR-0061；门禁通过
  做什么：
  - 迁移 v30 新增 `opening_candidates(id, story_id, ordinal, raw, status, created_at)`，`status` 取 `pending`、`chosen`、`discarded`。
  - 后台任务 `opening_candidates`：一次调用生成 2–3 个开场候选（默认 3），每个是完整正文（可以含原生块）。玩家选中一个时在当前路径根部追加为首个助手楼层，状态改为 `chosen`，其余改为 `discarded`；重新生成追加新一批。
  - 候选不在回合内生成，未选中的候选不进入上下文；候选正文不改写，选中之后按普通楼层解析与结算。
  - CLI：`dramaticer open --story <id> [--generate <n>] [--list] [--pick <id>]`；R5 界面复用同一接口。
  验收：一次生成 3 个候选且不产生楼层；选中后成为首个楼层、其余保留为 discarded；重新生成追加新批且旧批状态不变；未选候选不进上下文；非法输出整批拒绝并保留原因；`pnpm check` 通过。

- [x] **O-T99 开局验收** | 依赖：O-T01、O-T02、O-T03、R2-T02、R2-T03
  完成：2026-11-08 新增每轮玩家侧裁判（`evalset/turn-judge.ts`，严格 JSON `{reroll, followed, reason}`，非法重试 3 次、失败不中断试玩）与 `playtest --judge-turns`、`--opening on|off`、`--no-background`；新增 `pnpm --filter @dramaticer/st-compat opening-eval`（`evalset/opening-eval.ts`、`opening-eval-cli.ts`）：每张卡建开启与关闭两个故事，开启侧先生成开局包，另建候选故事生成 3 条候选并让模拟用户选择，逐卡跑固定种子 10 轮，`--report-only` 从 manifest 与 JSONL 重算报告且逐字节相同；3 张合成卡、种子 1、助手 `main-fallback`、模拟用户 `background`、裁判 `rp`：开局开启 1/30 重 roll（3.3%）、关闭 3/30（10.0%），前 5 轮 0/15 与 2/15（13.3%），指令遵循各 29/30（96.7%），候选采用 3/3（100%，没有区分度），首字 P50/P90 开启 3,455/7,161 毫秒、关闭 3,359/7,513 毫秒，截断 0、运行失败 0、裁判失败 0；1–10 轮重 roll 率低于 F0 的 24.9%；私有报告 `eval-private/reports/O-opening.md`，统计版 `docs/dev/reports/O-opening.md`；真实卡因开局包在场人物只认角色卡名与已导入实体而整包拒绝，记入 O-T01.a 与报告限制；ADR-0065；新增 6 个测试；门禁通过（103 个测试文件、930 个测试，3 个 live 跳过）
  做什么：用 R2 的 CLI 试玩在同一批卡与固定种子上对比开启与关闭开局机制，统计 1–10 楼重 roll 率（对照 F0 的 24.9%）、指令遵循率与候选采用率，并记录首字延迟；私有报告与统计版各一份；未达标时写 ADR 并生成改进任务，最多三轮。
  验收：重复运行口径一致；报告含三个指标与样本数；统计版不含私有信息；`pnpm check` 通过。
  结果写 `MILESTONE_DONE`。

- [x] **O-T01.a 开局包的在场人物覆盖角色卡里的其他人物** | 依赖：O-T01
  完成：2026-11-08 开局包在场人物的校验依据改为 `OpeningKnownNames`（角色卡名、角色实体名称与别名，加上角色卡与常驻世界书正文），规范化后不少于两个字符的名字在正文里出现即通过，其余仍然整包拒绝并指出 `participants[i].name`；`collectOpeningInput` 与 `readOpeningPack` 共用同一份依据，开局包字段、存储与输入摘要不变；生成提示词同步说明可以用角色卡描述里提到的其他人物；两张真实卡各跑一次 `opening` 任务验证通过（在场人物 1 人与 3 人，全部没有对应实体）；ADR-0066；新增 4 个测试；门禁通过（934 个测试）
  做什么：开局包的在场人物校验目前只认角色卡名与已导入的 `character` 实体，角色卡描述里写到的其他人物（例如主角之外的主要角色）会被整包拒绝，真实卡因此无法生成开局包。让导入流程或校验入口认识角色卡里出现的人物名，未知名字仍然拒绝；不改变开局包的字段与存储。
  验收：角色卡描述里出现的其他人物可以通过校验；卡里没有的名字仍然整包拒绝并指出字段；开局包重复生成只覆盖不新增；`pnpm check` 通过。

- [x] **O-T99.a 用正确的写作模型与独立裁判重跑开局验收** | 依赖：O-T99、O-T01.a
  完成：2026-11-08 按 `--model rp --judge-model judge` 重跑同一批 3 张合成卡与种子 1，每卡每配置 10 轮：开局开启与关闭均为 0/30 重 roll（0.0%），前 5 轮均为 0/15，指令遵循各 30/30（100.0%），候选生成 2/3（一张卡首批输出不是合法 JSON）、采用 2/2，首字 P50/P90 开启 7,501/10,432 毫秒、关闭 7,423/11,581 毫秒，截断与运行失败均为 0；报告里并列保留 O-T99 首次运行的数字（开启 1/30、关闭 3/30、指令遵循各 29/30、候选 3/3），报告头写明写作 `rp`、模拟用户 `background`、裁判 `judge` 与差异，超过 5 个百分点的变化写明可能原因；`opening-eval` 新增 `--note` 与 manifest 的 `previousRuns`，`--report-only` 两次生成逐字节相同；ADR-0065 更新为两次运行并列；门禁通过（103 个测试文件、936 个测试，3 个 live 跳过）
  做什么：O-T99 的实跑把助手模型设成 `main-fallback`（DeepSeek）、裁判设成 `rp`（Gemini）。两臂共用同一裁判，方向性结论成立，但配对不是目标配置：人类 2026-11-08 指定 Gemini 3.8 Flash 是写作模型（`rp`），裁判必须换不同模型家族，配置已改为 `judge`（`auto/glm-5.3`）。用 `--model rp --judge-model judge` 重跑同一批卡与种子，报告里并列保留两次运行的数字（不删除 O-T99 的结果），并写明两次的模型配置与差异；数字变化超过 5 个百分点时说明可能原因。
  验收：报告头的模型与 `data/channels.yaml` 的 roles 一致；同一输入重跑数字可复现；`pnpm check` 通过。

## R2：评测底座

- [x] **R2-T01 B0 朴素模式** | 依赖：M4-T02、R1-T01 | DESIGN §14.1
  完成：2026-11-08 core 新增 `chat/profile.ts`（`ChatProfile` 取 `native`、`naive`，默认 `native`，`assertChatProfile`），`runChatTurn` 的 `profile` 是单轮参数并写进 `TurnTrace.profile`（中止楼层同样记录）；`createNaiveContextTemplate` 只有 `character`、`persona`、`history`、`protocol` 四段，`protocol` 文本只有写作契约；`createNaiveChatProviders` 提供角色卡、故事设置 `persona` 与最近 20 楼原文（`createRawHistorySlotProvider` 不做块视图），naive 回合不提供读写工具、不收集结构化输出、不写 `state_diffs` 与 `plot_notes`；`enqueueMissingBackgroundJobs` 的 `confirmed` 与 `settled` 条件和 `listUnsettledSettledAssistantNodes` 的结算窗口都跳过 naive 助手楼层（没有 Trace 时按 native）；`dramaticer chat --profile <native|naive>` 与 `--persona <text>`，naive 搭配显式 `--director on` 直接失败；ADR-0062；新增 7 个 core 测试与 3 个 CLI 测试；门禁通过（103 个测试文件、906 个测试，3 个 live 跳过）
  做什么：
  - core 增加 `ChatProfile`（`native`、`naive`）；`naive` 只提供角色、persona、写作契约与最近 N 楼原文，不提供台账、记忆、lore、摘要、现场分析与导演槽位；`dramaticer chat --profile naive` 可运行。
  - 朴素模式关闭后台任务与台账写入，Trace 里不出现 `memory:`、`summary:`、`ledger:`、`director:` 来源。
  - 与 `native` 共用同一条生成与楼层写入路径，只替换槽位提供者集合。
  验收：朴素模式 Trace 只有角色、persona、历史与写作契约；后台客户端零调用；两种模式写出的楼层结构一致；`pnpm check` 通过。

- [x] **R2-T02 回放驱动与长程自动试玩命令行** | 依赖：R2-T01、R1-T02
  完成：2026-11-08 新增 `pnpm --filter @dramaticer/st-compat playtest`（`--db`、`--story`、`--rounds` 默认 20、`--profile`、`--user-model` 默认 `background`、`--model` 默认 `rp`、`--seed`、`--out`、`--resume`、`--swipe-at`、`--edit-at`、`--branch-at`）；模拟用户严格解析唯一键 `message` 的 JSON，连续 3 次非法时终止；每轮记录序号、用户与助手楼层 id、用户输入与正文、首字与总耗时、用量、台账事实条数、新建与兑现线索、导演决策、Trace 摘要、截断与间隙积压；native 档每轮跑一轮 `gapSeconds` 为 0 的后台任务，naive 档不建也不跑；`--resume` 从最后记录的轮次加一继续；`createDefaultBackgroundJobRegistry` 与 `resolveStoryBackgroundKinds` 由 `dramaticer work` 与试玩共用；ADR-0063；新增 7 个测试；门禁通过（104 个测试文件、913 个测试，3 个 live 跳过）
  做什么：
  - 新增 `pnpm --filter @dramaticer/st-compat playtest`：参数 `--db`、`--story`、`--rounds`（默认 20）、`--profile`、`--user-model`、`--model`、`--seed`、`--out`、`--resume`。
  - 模拟用户由 `background` 模型生成，严格 JSON `{message}`；解析失败重试 3 次后终止并记录原因；支持按轮次配置 swipe、编辑与分支切换。
  - 助手模型由 `--model <alias>` 指定，自动试玩默认用 `rp`（catie 渠道的 Gemini 3.8 Flash，人类指定）；`--user-model` 只影响模拟用户。
  - 每轮记录序号、节点 id、用户输入与助手正文、首字毫秒、用量、台账 diff 数、新建与兑现线索、导演决策、Trace 摘要、是否截断、下一轮开始时关键间隙工作的完成情况（用于计算间隙未完成率）；写私有 JSONL 到 `eval-private/reports/`。
  - 断点续跑从最后一个完成轮次继续；单轮失败不中断整批，记入失败列表。
  验收：假客户端下 5 轮跑通且零网络；模拟用户输出非法 JSON 时重试 3 次后终止；`--resume` 不重复轮次；记录字段齐全；`pnpm check` 通过。

- [x] **R2-T03 一致性探针** | 依赖：R2-T02、R1-T01、R1-T01.b
  完成：2026-11-08 新增 `evalset/probe.ts`：从 `readLedgerFacts` 取至少 20 楼之前（`--probe-min-age`，默认 20）的字符串台账事实出回忆题，排除 `userWill` 与 `mvu`；`LedgerFact` 增加写入楼层 `nodeId`；探针在每轮间隙任务之后按 `--probe-every`（默认 10）执行，用与回合相同的模板、槽位和预算在 head 上组装上下文，只读、不写楼层、不改 head；回答交给 `roles.judge` 的裁判，严格 JSON `{consistent: boolean|"unknown", reason}`，非法重试 3 次，失败记进探针记录且试玩继续；`probe-report` 命令按故事与轮次输出矛盾率（分母为一致加矛盾）、`unknown` 与失败数，私有版含题目与回答，统计版只有数字；ADR-0064；新增 9 个测试；门禁通过（105 个测试文件、922 个测试，3 个 live 跳过）
  做什么：
  - 在试玩中每 `probeEvery`（默认 10）轮插入一次回忆型探针：从台账里取至少 20 楼之前的事实，生成问题；探针调用不写入楼层树，也不改变当前 head。
  - 回答与当前台账快照交给 `judge` 角色的模型裁判，严格 JSON `{consistent: boolean, reason}`；无法判断记为 `unknown`，不并入矛盾率。
  - 报告按对话与轮次给出矛盾率、`unknown` 数与样例编号（私有报告可含原文，统计版只含数字）。
  验收：探针不产生新楼层；裁判输出非法 JSON 时重试；矛盾率计算正确；`unknown` 单列；`pnpm check` 通过。

- [x] **R2-T03.a 五类记忆题与编造回忆率** | 依赖：R2-T03、M2-T15
  完成：2026-11-08 新增 `evalset/memory-questions.ts`（`memory-<故事>.jsonl` 严格格式：五类 `category`、非空 `evidenceNodes`、`fabricated` 标注，未知字段、非法类别、重复 id 与空文件直接失败）；新增 `evalset/memory-judged.ts`，在每道题的提问楼层用标准槽位组装上下文生成回答，再交给与一致性探针同一套的 `judgeAnswerConsistency`（同一 `JUDGE_SYSTEM_PROMPT`、`parseProbeJudgeOutput`、3 次重试与失败语义）判分；编造题在裁判提示里明确“明确否认或拒答算一致，肯定描述不存在的人、事、物算不一致”，判为矛盾时记一次编造；`memory-eval` 新增 `--judged`，按 `writer` 回答、`judge` 判分读取 `eval-private/evalset/memory-<故事>.jsonl`，缺文件时只记录跳过；报告新增「五类记忆题与编造回忆率」段，按类别给出命中、矛盾、`unknown`、失败、命中率、编造题数与编造率，命中率分母是一致加矛盾，编造率分母是编造题里裁判可判定的数量，私有版附逐题明细；探针改为调用同一判分函数；ADR-0067；新增 6 个测试；门禁通过（105 个测试文件、942 个测试，3 个 live 跳过）
  做什么：
  - 记忆题按 LongMemEval 五类扩充：信息抽取、跨段推理、时间推理、知识更新、拒答；每道题标注类别与证据楼层。
  - 新增编造回忆题：用从未发生的人、事、物生成提问，正确答案是明确否认或拒答；模型给出肯定描述即计为编造。
  - 一致性探针与记忆评测共用同一套判分；报告按类别给出命中与编造率，`unknown` 单列。
  验收：五类各有题目且判分正确；编造回忆题在肯定描述时判为编造、明确否认时判为通过；报告按类别分列；统计版不含题目与原文；`pnpm check` 通过。

- [x] **R2-T03.b 裁判校准（judge，GLM）** | 依赖：R2-T03、F0-T03
  完成：2026-11-08 新增 `scripts/r2-judge.mjs` 与 `scripts/r2-judge-lib.mjs`（`pnpm r2:judge`）：第一部分复用 F0-T03 的同一分层抽样（种子 `f0-t03-v1`，195 对）、同一提示词与严格 `{choice, confidence}` 解析，对 `judge`（`auto/glm-5.3`）按两种顺序各判一次；第二部分用 `naive` 档、写作 `rp`、模拟用户 `background`、种子 1 跑满 100 轮自动试玩（0 失败、2 轮截断），把 `judgePlaytestTurn` 的同一输入同时交给 `judge` 与模拟用户模型；结果：194 对里 386 次成功判断（4 次三次重试后仍无非 JSON 输出，未计入分母），合并一致率 71.5%（95% 置信区间 66.8%–75.8%）、位置偏差 0.8 个百分点、换序一致率 81.3%，两项门槛都达到；1–10 楼子集一致率 55.0%、切回较早 swipe 子集 47.9% 低于门槛，按预注册规则只用玩家数据；试玩对照 99 对，两侧重 roll 率都是 1.0%（各 1 条），重 roll 与跟随指令判定各一致 97/99（98.0%），没有宽松证据；报告 `docs/dev/reports/R2-judge.md`，结论写入 ADR-0068；门禁通过
  做什么：
  - 沿用 F0-T03 的协议校准 `judge`（`auto/glm-5.3`）：从 `eval-private/f0/pairs.jsonl` 取同一批回复对，隐去标签，以 A、B 与 B、A 两种顺序各判一次，统计与玩家真实选择的一致率、交换顺序后的一致率、位置偏差与置信区间。
  - 另取一轮自动试玩的 100 条助手回复，让裁判判“会不会重 roll、是否遵循指令”，与模拟用户的偏好信号对照，检查判定尺度是否过于宽松。
  - 门槛沿用 F0-T03 的预注册值：交换顺序后一致率 ≥ 65%、位置偏差 ≤ 10 个百分点。达不到时 `judge` 不用于重 roll 判定，R2-T04 的盲测改用确定性指标加配对统计并在报告里注明。
  - 执行方式：分批同步跑，每批最多 100 对，跑完立刻写中间结果；会话结束前必须确认没有仍在等待的后台任务，不能留下“已启动、未收尾”的校准或试玩进程（会话 123、124 因此没有产出）。
  验收：报告写 `docs/dev/reports/R2-judge.md`；一致率、位置偏差与置信区间齐全；门槛判定明确；判定不可用时明确写出替代口径；`pnpm check` 通过。

- [x] **R2-T04 盲测两两对比** | 依赖：R2-T02、R2-T07.a、R1-T01.b
  完成：2026-11-08 新增 `evalset/pairwise.ts` 与 `pairwise` 命令行：同一样本按接受侧在甲、在乙各判一次，严格 JSON `{winner:"A"|"B"|"tie", reason}`，非法输出重试 3 次后记为失败；两份文本完全相同时不调用模型直接判平局；统计分组为总体（不含切回较早 swipe）、重 roll 全部/最新/切回较早、选项选择，给出接受胜率、平局率、位置偏差（换序不一致占比）与偏好一致率；样本 id 用放弃侧短哈希区分同一选项事件拆出的多个回复对；真实 `judge` 对 3 组合成样本冒烟 6 次判定 0 失败，私有库无任何偏好记录，报告写明合成样本限制；ADR-0074；新增 14 个测试；门禁通过（115 个测试文件、1009 个测试，3 个 live 跳过）
  做什么：
  - 新增两两对比：同一分支点的两份续写分别以 A、B 与 B、A 两种顺序交给 `judge` 角色的裁判，严格 JSON `{winner:"A"|"B"|"tie", reason}`。
  - 偏好子集：用 R2-T07.a 导出的接受与放弃回复对，让同一写作模型重新生成两份续写，比较裁判选择与玩家实际选择的一致率；切回较早 swipe 的子集单列，不并入总体一致率。
  - 汇总胜率、平局率与位置偏差（两种顺序结论不一致的比例）；裁判失败重试 3 次后记入失败列表。
  - 统计版只含胜率、平局率、位置偏差、偏好一致率、样本数与模型别名，不含原文。
  验收：两份完全相同的续写在两种顺序下都判平局；顺序交换后结论统计正确；偏好子集的一致率与切回较早 swipe 的子集分开列出；失败重试与记录可用；`pnpm check` 通过。

- [x] **R2-T04.a 叙事质量评分表** | 依赖：R2-T04、R1-T01.b
  完成：2026-11-08 新增 `evalset/quality.ts`（四项 1–5 分、严格五键 JSON、失败重试 3 次）与 `pairwise` 的评分出口 `--quality-out`：同一批样本的接受侧与放弃侧各评一次，逐条写 `eval-private/reports/R2-pairwise/quality.jsonl`；私有报告按故事与侧给出均值与 1–5 分布，统计版只给接受/放弃两侧汇总，不出现故事 id、理由与原文；评分与判定共用 `roles.judge` 客户端；真实裁判冒烟 4 次评分 0 失败；ADR-0075；新增 7 个测试；门禁通过
  做什么：
  - 参考 TTCW 的评分表，裁判严格输出 `{originality, character, pacing, dialogue, reason}`，四项各 1 到 5 分；非法 JSON 重试 3 次后记入失败列表。
  - 同一批盲测样本同时给出两两胜负与四项分数；报告按对话给出均值与分布，统计版只含分数与样本数。
  - 评分与裁判都使用 `judge` 角色；`judge` 与 `writer` 由路由创建时校验为不同模型家族（ADR-0041）。
  验收：评分字段齐全且范围校验；非法输出重试与失败记录可用；与盲测胜率一起出现在报告里；统计版不含原文；`pnpm check` 通过。

- [x] **R2-T05 B1 历史回放基线** | 依赖：R2-T02、R2-T04、R1-T99
  完成：2026-11-08 新增 `evalset/historical-replay.ts` 与 `replay-eval` 命令行：按 ADR-0027 的 `selectBranchPoints` 取点，用后续真实玩家消息回放 native 与 naive 两档，把第一段续写与历史回复按两种顺序盲测，并复用 `runQualitySample`；`PairwiseTask` 增加 `historical`，裁判输出上限 2048；样本元数据、判定与评分分别写 `samples.jsonl`、`records.jsonl`、`quality.jsonl`，私有与统计两份报告；3 个 legacy 对话共 6 个样本，12 次判定与 12 次评分 0 失败，同模型子集为空，B1 只作参考；ADR-0076；新增 9 个测试；门禁通过（116 个测试文件、1025 个测试）
  做什么：
  - 从 legacy 评测对话按 ADR-0027 的分支点选择规则取点；用后续真实用户消息回放，只用固定轮数生成续写。
  - 把第一段续写与当时 ST 的真实回复配对，走 R2-T04 的盲测对比；报告按对话给出胜率、平局率、样本数与位置偏差。
  - 报告同时列出上下文差异（前缀楼层数、模型别名、采样参数、是否有记忆与导演），并标出历史回复所用的模型；不调用本地 ST。
  - 主对照是同一写作模型下的 B0 与 native。能找到同模型样本时用同模型子集比较；找不到时 B1 只作为“相对现状”的参考，不作门槛。
  验收：3 个对话都有样本；对比不访问本地 ST；报告给出上下文差异与历史回复模型；同模型子集与参考口径分开列出；统计版不含私有名称与原文；`pnpm check` 通过。

- [x] **R2-T06 记分牌与报告口径** | 依赖：R2-T03、R2-T03.a、R2-T04、R2-T04.a、R2-T05
  完成：2026-11-08 新增 `evalset/scoreboard.ts`（`buildScoreboard`、`renderScoreboard`、`summarizePlaytests`）与 `scoreboard` 命令行（`pnpm --filter @dramaticer/st-compat scoreboard`）：试玩按档位汇总完成轮次、失败轮次、相邻回复 4-gram Jaccard 重复度、首字 P50/P95、截断率、间隙未完成率与输入/输出/合计 token 每轮，写作模型同时给出别名与 Trace 模型；偏好一致率直接调用 `summarizePreferenceComparisons`，切回较早 swipe 子集单列；遗忘直接调用 `summarizeForgettingRuns`，按语料、深度层与档位给出矛盾率、编造回忆率与间隙探针矛盾率；叙事质量复用 `summarizeQuality`，偏好盲测与 B1 分开；B1 直接调用 `summarizeHistoricalReplay`，同模型子集为空时写明只作参考。日期取输入里最晚时间戳，输入顺序不影响输出；只含聚合数字，不含故事 id、样本 id、正文与理由；门槛规则（未赢过基线最多重评三轮后写 HUMAN.md）写进生成文档。真实数据生成 `docs/dev/SCOREBOARD.md`：600 轮试玩、30 次遗忘运行、6 个 B1 回放，6 个故事 id 反向扫描 0 命中；新增 6 个测试；门禁通过（117 个测试文件、1031 个测试，3 个 live 跳过）
  做什么：
  - 新增 `docs/dev/SCOREBOARD.md`，由 CLI `pnpm --filter @dramaticer/st-compat scoreboard` 从私有 JSONL 生成：日期、阶段、profile、模型别名、样本数、对比胜率、矛盾率、编造回忆率、偏好一致率（接受与放弃的回复对，单列切回较早 swipe 的子集）、叙事质量四项分数、重复度、首字延迟 P50/P95、截断率、间隙未完成率、每轮成本、结论与下一步。
  - 记分牌只含聚合数字；同一批输入重复生成逐字节相同。
  - 写清门槛规则：没赢过基线就自动生成改进任务并重评，最多三轮，之后写入 HUMAN.md。
  验收：记分牌可由报告重复生成；字段齐全；私有标识反向扫描通过；门槛规则写进文档；`pnpm check` 通过。

- [x] **R2-T07 偏好信号记录** | 依赖：M2-T01、R1-T07.a、M4-T03 | DESIGN §14.5 | ADR-0044
  完成：2026-11-08 迁移 v31 新增只追加的 `preference_events`（`kind` 取 `swipe`、`choice`、`card_decision`、`edit`，`story_id` 必须与所在楼层一致，触发器拒绝 UPDATE 与 DELETE）；core 新增 `preferences/events.ts`（种类、四种载荷的字段校验与未知字段拒绝）与 `StoryStore.recordPreference`、`listPreferenceEvents`；`swipeNode`、`editNode` 与变更卡的 `updateLedgerChangeCardStatus`（仅批准与拒绝）在各自事务里直接记录，选项选择由调用方用 `recordPreference` 写入；锚点语义与选择载荷写进 ADR-0069；新增 6 个测试（四种信号、重复写入、触发器、事务回滚、上下文与检索不含载荷、载荷校验）；门禁通过（107 个测试文件、956 个测试，3 个 live 跳过）
  做什么：
  - 迁移 v31 新增只追加的 `preference_events(id, story_id, node_id, kind, payload, created_at)`；`kind` 取 `swipe`、`choice`、`card_decision`、`edit`；数据库触发器拒绝 UPDATE 与 DELETE。`payload` 存 JSON：swipe 记被放弃与被接受的节点 id，choice 记选项正文与所在楼层，card_decision 记卡片 id 与决定，edit 记改前改后的节点 id。
  - core 提供 `recordPreference(event)` 与按故事、按种类的读取接口；写入与对应操作在同一个事务里，失败则整个操作回滚。
  - 不进入剧情上下文，不参与预算、检索与导演；只用于评测与校准。
  验收：四种信号各写入一行且内容完整；重复操作产生新的行；UPDATE 与 DELETE 被触发器拒绝；事务失败时操作与记录一起回滚；偏好记录不出现在上下文组装结果里；`pnpm check` 通过。

- [x] **R2-T07.a 偏好信号接线与导出** | 依赖：R2-T07、R5-T02 | DESIGN §14.5
  完成：2026-11-08 server 新增 `POST /api/nodes/:id/choice`（请求体 `{text}`，故事与楼层从节点推出，响应 `{event}`，协议类型 `NodeChoiceRequest`、`NodeChoiceResult`）；swipe、edit 与变更卡决定继续由核心操作在各自事务里记录，接口不重复写；新增 `packages/st-compat/src/preferences/export.ts` 与 `pnpm --filter @dramaticer/st-compat preferences export --db <path> [--out <dir>] [--story <id>]`，按故事写 `<故事>.events.jsonl`、`<故事>.pairs.jsonl` 与 `index.json`，选项选择按所选正文与同一选项块里未选中的行配对，重 roll 按被放弃与被接受楼层配对，未配对的选择计数；文件名替换 Windows 不允许的字符，撞名直接报错；同一数据库重复导出逐字节相同；ADR-0073；新增 6 个测试（导出 4、命令行 1、服务端选择 1）；门禁通过
  做什么：
  - 选项块的选择由界面发送一个只含选择内容的接口调用，接口用 `recordPreference` 记录。swipe、edit 与变更卡决定由核心操作在各自事务里写入（ADR-0069），这三个接口不再重复记录。CLI 的 swipe、edit 与变更卡命令走同一处。
  - 新增 `pnpm --filter @dramaticer/st-compat preferences export`：按故事导出 JSONL 到 `eval-private/preferences/`，并生成接受与放弃的回复对清单（重 roll 与选择两类），供 R2-T04 的偏好子集使用。
  - 导出内容属于私有数据，只写 `eval-private/`；报告只出聚合数字。
  验收：四个入口各产生一条记录且节点 id 正确；导出文件按故事分组；回复对清单不含原文进统计版；重复导出结果一致；`pnpm check` 通过。

- [x] **R2-T08 公开合成基准** | 依赖：R2-T02、R2-T03 | DESIGN §14.3
  完成：2026-11-08 新增 `benchmarks/`（3 张 SFW 合成卡与内嵌世界书、每故事一份原生模板、3 段各 480 条消息的长线对话、33 道记忆题、14 道探针题、9 个分支点与 `manifest.json`）；`packages/st-compat/src/evalset/benchmark.ts` 从公开数据表确定性渲染，固定种子只影响填充文本，重复生成逐字节相同；`benchmark --generate/--validate/--import --db` 依次比对生成结果、校验卡与世界书、发言者顺序、模板收尾、五类记忆题与编造题、题目去重、证据楼层与提问顺序、分支点深度（每故事至少 100 楼与 200 楼各一个），并在临时库中导入确认可用；公开安全扫描拒绝私有目录标记、本地 ST 目录名、绝对路径与 NSFW 词；`benchmarks/` 加入 biome 忽略；新增 11 个测试（确定性、证据楼层、重复 id、提问顺序、分支点重复楼层、私有标记、导入后两轮试玩、命令行生成校验）；ADR-0070；门禁通过（108 个测试文件、967 个测试，3 个 live 跳过）
  做什么：
  - 在仓库内新增 `benchmarks/`：3 张 SFW 合成卡（含世界书与原生模板）、对应的长线对话与题目集（记忆题、探针题与预注册的分支点），全部可公开，不含任何私有数据与版权文本。
  - 提供 `pnpm --filter @dramaticer/st-compat benchmark` 生成或校验基准（固定种子），校验脚本检查题目结构、证据楼层与去重。
  - 基准用于门槛判断与回归；私有 3 个对话继续作为对照，报告分开列出。
  验收：基准可独立导入并跑通试玩；题目结构与证据楼层校验通过；仓库内不出现私有数据与版权文本（反向扫描）；重复生成结果一致；`pnpm check` 通过。

**R2-T09 长对话遗忘评测**（已拆成 R2-T09.a 至 R2-T09.c） | 依赖：R2-T02、R2-T03.a、R1-T99 | DESIGN §14.3、§7.3

  总验收（三个子任务全部完成后由 R2-T99 核对）：两个深度层各有样本；分层数字齐全；结论写 ADR；统计版不含私有信息。

- [x] **R2-T09.a 遗忘评测运行器与分层报告** | 依赖：R2-T02、R2-T03.a、R2-T08
  完成：2026-11-07 `playtest` 新增 `--head`（从指定助手楼层继续，不能与 `--resume` 同用）与跑后批测 `--memory-questions`、`--probe-questions`、`--questions-out`；`memory-judged` 支持 `askAtNode` 覆盖并导出通用问答函数；新增 `evalset/forgetting.ts`（路径外证据跳过、编造按矛盾判定、100–199/200–299/300+ 分层、同题对照趋势）与 `forgetting-report` 命令（私有版含故事与逐题，统计版只有数字与模型别名）；新增 4 个测试；门禁通过（109 个测试文件、971 个测试，3 个 live 跳过）
  做什么：
  - `playtest` 增加 `--head <nodeId>`，从指定分支点开始生成；增加 `--memory-questions`、`--probe-questions` 与 `--questions-out`，跑完后在最终 head 上提问，把逐题判定与深度写入一份 JSON。
  - 新增 `pnpm --filter @dramaticer/st-compat forgetting-report`：读取上述 JSON，按楼层深度分层（100–199、200–299、300 以上）与档位聚合矛盾率、命中率、编造回忆率，并给出同题对照的遗忘趋势；私有版含故事与题目，统计版只有数字与模型别名。
  - 证据楼层不在当前路径上的题目记为跳过，不进入分母；编造题只在判为矛盾时计入编造。
  验收：指定 head 后生成路径从该楼层继续；跑后提问不改 head；跳过、编造与无法判断口径正确；分层表与同题趋势可重复生成；统计版不含故事 id 与题目文本；`pnpm check` 通过。

- [x] **R2-T09.b 公开基准实跑与 ADR 结论** | 依赖：R2-T09.a
  完成：2026-11-08 在 3 个基准故事 × 3 个分支点（路径深度 119、299、439）× naive 与 native 上各跑 20 轮并跑后提问，18 次运行、360 轮全部完成、失败 0；282 道题里一致 12、矛盾 51、无法判断 105、跳过 114，可判定 63、矛盾率 81.0%；naive 矛盾率 76.9%（20/26）、native 83.8%（31/37），同题对照三层都未上升（naive 100%/100%/100%，native 100%/100%/75%）；两个档位都关闭后台任务，避免先结算基准自带的 119–439 个未结算楼层；私有版 `eval-private/reports/R2-forgetting.md`、统计版 `docs/dev/reports/R2-forgetting.md`；结论与限制写入 ADR-0071；门禁通过
  做什么：
  - 把公开基准导入私有数据库，取每个故事 119、299、439 楼的三个分支点，分别用 B0（`naive`）与 native 各生成 20 轮，再用记忆题与探针题在最终 head 上提问。
  - 按深度层与档位生成私有报告与统计版 `docs/dev/reports/R2-forgetting.md`，判断遗忘是否随楼层加深而上升；结论写 ADR。
  验收：两个深度层各有样本；分层数字齐全；结论写 ADR；统计版不含私有信息；`pnpm check` 通过。

- [x] **R2-T09.c legacy 对话对照** | 依赖：R2-T09.b
  完成：2026-11-08 导入 3 个 legacy 对话（同时导入角色卡与世界书），在主路径 119/120 与 219/220 楼取分支点，naive 与 native 各跑 20 轮并跑后提问，共 12 次运行、240 轮、失败轮次 0；600 道题里一致 12、矛盾 115、无法判断 30、跳过 314、失败 129，可判定 127、矛盾率 90.6%（naive 95.7%、native 75.8%）；同题对照 naive 未上升（97.5% → 97.4%），native 记为上升（66.7% → 100.0%）但每层只有 7–9 道可判定回答，不作为深度效应证据；报告新增 `corpus` 来源维度，公开基准与 legacy 对话并列，统计版在 `docs/dev/reports/R2-forgetting.md`，私有版在 `eval-private/reports/R2-forgetting.md`；事件题转记忆题的脚本与运行驱动在 `scripts/r2-legacy-questions.mjs`、`scripts/r2-legacy-forgetting.mjs`；`catie` 的 `rp` 路由在最后两次运行期间返回 503，45 道题失败且未能重试（HUMAN-13）；结论与限制写入 ADR-0072；门禁通过（109 个测试文件、972 个测试通过，3 个 live 跳过，共 975 个）
  做什么：
  - 在 legacy 评测对话上取 100 楼以上与 200 楼以上的分支点，重复 R2-T09.b 的生成与提问，与公开基准并列报告；私有数据只写 `eval-private/`。
  验收：legacy 两个深度层各有样本；与基准并列给出数字；统计版不含私有信息；`pnpm check` 通过。

- [x] **R2-T99 R2 验收** | 依赖：R2 全部任务
  完成：2026-11-08 门禁通过（117 个测试文件、1031 个测试，3 个 live 跳过）；13 个 R2 测试文件 102 个测试单独重跑通过；假客户端 5 轮试玩链路通过；真实分支点（第 401 楼、naive、`main-fallback` 写作、`judge` 裁判）1 条续写、2 次判定与 2 次评分 0 失败；`--report-only` 报告除生成时间外逐字节相同，记分牌与偏好导出重复生成逐字节相同；分支点改为从导入历史末端取点，种子库 head 已被续写移动时仍能重复取到同一分支点，新增回归断言；`docs/dev/reports/R2.md` 记录 B0、B1、偏好信号口径、样本数与限制；R4-T00 依赖满足
  结果写 `MILESTONE_DONE`。

## E：排障命令行（排在 R2 之后）

- [x] **E-T01 排障命令行 `dramaticer explain`** | 依赖：R2-T99 | DESIGN §10.3
  完成：2026-11-08 新增 `packages/core/src/explain`（`explainNode` 同步只读、`renderExplainReport` 中文文本、`runExplainCli`）与 `dramaticer explain --node <id> --db <path> [--json]`：按固定顺序输出模型与结果、上下文分段与 token、预算裁剪与缺失槽位、记忆检索每一路名次与 RRF 融合分数、台账快照与本楼写入、导演决策与逐条证据的修正建议；记忆槽位改为把每一路名次、融合结果与实际注入楼层写进 `ContextTraceEntry.retrieval`（`RetrieveMemory` 的 `routes` 一并返回），naive 档不给出补齐后台任务的建议；缺 Trace 时明确写“没有记录”并仍读出台账与导演记录；冒烟脚本在真实 `runChatTurn` 生成的楼层上跑通文本与 JSON 输出，检索分段为 `memory:1`、`bm25` 第 1 名、融合分数 0.0164；新增 7 个测试（覆盖顺序、缺少 Trace、消息楼层、只读性与 CLI 参数）；门禁通过
  做什么：
  - 新增 `dramaticer explain --node <id> [--json]`：读取该楼层的 Trace、上下文分段来源与 token、被裁剪的段落与缺失槽位、检索各路分数与融合排名、台账快照与本楼 diff、导演决策，按固定顺序解释“这一轮为什么这么写、为什么忘了某件事”，并给出可以操作的修正建议（置顶某条记忆、修订台账）。
  - 每个结论都带证据（Trace 分段、检索条目与楼层 id、台账路径、导演方案 id）；证据缺失时明确写“没有记录”，不推断。
  - 只读：不写楼层、不改变 head、不调用模型；默认输出中文文本，`--json` 输出结构化字段。
  验收：对已有楼层输出每个分段、检索条目、台账路径与导演决策；缺 Trace 时给出明确提示；模型调用次数为零；`pnpm check` 通过。

## R4：Director v2

- [x] **R4-T00 细化 R4 任务** | 依赖：R1-T99、R2-T99、R3-T99 | DESIGN §8
  完成：2026-11-08 把 R4 拆成 R4-T01 至 R4-T08 与 R4-T99：计划存储与玩家编辑、后台规划器、短线层节拍选择、并入玩家消息、透明与盲盒模式、落拍检测、候选行动、`extensions.dramaticer` 扩展；M3 已实现的线索、事件池、NPC 议程、重复检测、节奏与 O 的开局导演不重复建任务；迁移 v32 存计划与拍状态、v33 存候选行动，R1 续原计划的 v32–v35 顺延为 v35–v38（v34 留给生图表）；ADR-0077；门禁通过（118 个测试文件、1038 个测试通过，3 个 live 跳过，共 1041 个）
  做什么：把长线层（弧线、序列、后台规划器、玩家编辑）、短线层（当前拍、强度、纠偏信号、程序选择）、落拍检测、候选行动、注入玩家消息末尾、透明与盲盒模式、`extensions.dramaticer` 扩展拆成任务，写清依赖与验收；开局导演（O）已实现的机制不重复建任务。
  验收：任务清单可直接执行；`pnpm check` 通过。

- [x] **R4-T01 导演计划存储与玩家编辑** | 依赖：R1-T99、R2-T99、R3-T99 | DESIGN §8.1 | ADR-0077
  完成：2026-11-08 迁移 v32 新增 `story_arcs`、`story_sequences`、`story_beats` 与 `director_beat_states`（跨故事引用由触发器拒绝，弧线也带 `ordinal` 保留顺序）；新增 `director/plan.ts` 的 `DirectorPlan`、`parseDirectorPlan`、`readDirectorPlan`、`replaceDirectorPlan`、`mergePlannedArcs`、`resolveCurrentBeat`；`StoryStore` 提供计划行读写、合并与拍状态读写；CLI `dramaticer director plan --story <id> --db <path> [--json] [--set <file>]`；server 新增 `GET/PUT /api/stories/:id/director/plan`；新增 14 个 core 测试与 1 个 server 测试；门禁通过（119 个测试文件、1053 个测试通过，3 个 live 跳过，共 1056 个）
  做什么：
  - 迁移 v32 新增 `story_arcs(story_id, arc_id, title, through_line, difficulty, red_lines, source, ordinal, created_at, updated_at, PRIMARY KEY(story_id, arc_id))`、`story_sequences(story_id, sequence_id, arc_id, ordinal, title, source, created_at, updated_at, PRIMARY KEY(story_id, sequence_id))`、`story_beats(story_id, beat_id, sequence_id, ordinal, goal, entry_signs, fit_points, source, created_at, updated_at, PRIMARY KEY(story_id, beat_id))` 与 `director_beat_states(node_id PRIMARY KEY, story_id, beat_id, completed, created_at)`；`source` 取 `player`、`model`、`import`，`difficulty` 是 0 到 1 的数字，`entry_signs` 与 `fit_points` 存 JSON 字符串数组；组合外键与触发器拒绝跨故事引用。
  - 新增 `packages/core/src/director/plan.ts`：`DirectorPlan { arcs }`，弧线含 `id`、`title`、`throughLine`、`difficulty`、`redLines`、`sequences`；序列含 `id`、`title`、`beats`；节拍含 `id`、`goal`、`entrySigns`、`fitPoints`（至少一条）。`parseDirectorPlan` 拒绝未知字段、空字符串、重复 id、越界难度与空的 `entrySigns`/`fitPoints`，并指出 JSON 路径。
  - `readDirectorPlan(store, storyId)` 按弧线、序列、节拍的 `ordinal` 还原成嵌套结构；`replaceDirectorPlan(store, storyId, plan)` 在一个事务里整份替换并把所有行标为 `player`；`mergePlannedArcs(store, storyId, plan, source)` 只按 id 更新或追加，`source` 取 `model` 或 `import`，不删除任何行，也不覆盖 `player` 行。
  - `resolveCurrentBeat(store, storyId, nodeId)` 沿当前路径向前找最近一条 `director_beat_states`：`completed` 为真时前进到下一拍（序列末拍进入下一序列首拍），没有状态时从第一拍开始，计划耗尽返回 null。只读路径上的记录，分支切换后另一分支不参与。
  - `StoryStore` 提供计划的读写方法与拍状态读写；CLI 新增 `dramaticer director plan --story <id> --db <path> [--json] [--set <file>]`（`--set` 用玩家身份整份替换）；server 新增 `GET /api/stories/:id/director/plan` 与 `PUT`（同一套校验与替换语义）。
  验收：合法计划写入后能按原顺序读回；未知字段、重复 id、空字符串、越界难度与空契合点各抛错并指出路径；`--set` 写入的行来源为 `player`；`mergePlannedArcs` 不删除行、不改 `player` 行、同 id 更新；当前拍在无状态时取第一拍，完成后前进，计划耗尽返回 null，另一分支的状态不参与；列表命令只读；`pnpm check` 通过。

- [x] **R4-T02 后台规划器** | 依赖：R4-T01、R1-T02.2 | DESIGN §8.1 | ADR-0077
  完成：2026-11-08 新增 `director/planner.ts`（`DIRECTOR_PLAN_JOB_KIND`、`collectDirectorPlanInput`、`directorPlanNeedsRun`、`buildDirectorPlanUserContent`、`generateDirectorPlan`、`createDirectorPlanHandler`）：输入汇总角色卡、台账人物与关系、未兑现线索、物品、用户意志、最近章节摘要与现有计划（含 `player` 行）；模型输出交给 `parseJsonOutputObject` 与 `parseDirectorPlan` 严格校验后走 `mergePlannedArcs(..., "model")`；无素材时返回 null，不调用模型；计划为空或 head 上当前拍耗尽时补建任务，当前拍仍可解析时不补建。`createDefaultBackgroundJobRegistry` 注册 `director_plan`（入队条件 `story`、档位 `deferred`），新增 `plannerClient` 选项；`dramaticer work` 用 `roles.planner` 创建独立客户端，server 运行时新增 `plannerClient` 并传入调度器。CLI 改为异步，新增 `dramaticer director plan --story <id> --db <path> --generate`，与后台任务共用 `generateDirectorPlan`。新增 `director-planner.test.ts`（12 个测试）；门禁通过（120 个测试文件、1065 个测试通过，3 个 live 跳过，共 1068 个）
  做什么：
  - 新增后台任务 `director_plan`（`director/planner.ts`，入队条件 `story`，档位 `deferred`）：没有计划，或当前拍已耗尽时补建；使用 `roles.planner` 角色与独立客户端，回合内不调用模型。
  - 输入：角色卡提示词、台账里的人物关系、未兑现线索、物品与用户意志、最近章节摘要（存在时）、现有计划（含玩家编辑的行）。模型严格输出 `{arcs:[{id,title,throughLine,difficulty,redLines,sequences:[{id,title,beats:[{id,goal,entrySigns,fitPoints}]}]}]}`，字段、类型、非空、难度范围与 id 唯一性全部复用 `parseDirectorPlan`。
  - 输出非法时整份拒绝，交给任务框架重试；合法时走 `mergePlannedArcs`，来源 `model`；不删除既有行，不覆盖 `player` 行；同一输入重复执行不新增行。玩家的编辑是修订的输入，规划器据此追加后续序列。
  - CLI 新增 `dramaticer director plan --story <id> --db <path> --generate`：同步执行一次规划器，与后台任务共用处理器与校验。
  验收：假客户端一次调用写入计划；相同输入重复执行行数不变；非法字段整份拒绝且不写入；玩家编辑的弧线与序列在规划器运行后保留；没有计划或拍耗尽时入队，当前拍未耗尽时不入队；非长间隙不执行 `deferred`；回合内后台客户端零调用；`pnpm check` 通过。

- [x] **R4-T03 短线层：当前拍、强度与纠偏信号** | 依赖：R4-T01、R4-T02、M3-T01、M3-T06、M3-T07、O-T02 | DESIGN §8.2 | ADR-0077
  完成：2026-11-08 新增 `director/intensity.ts`（`DIRECTOR_INTENSITIES`、`DirectorIntensity`、`isDirectorIntensity`、`assertDirectorIntensity`、`resolveDirectorIntensity`、`renderByIntensity`），开场导演的强度渲染改用同一函数、三种强度的输出逐字节不变；`DirectorConfig` 新增 `intensity`（默认 `natural`），`assertDirectorConfig` 校验、`DIRECTOR_CONFIG_KEYS` 收录，旧记录读取时按默认值补齐；新增 `director/beat.ts`（`BEAT_PRIORITY = 23`，注册在开场之后），用 `resolveCurrentBeat` 取当前拍，`setup` 只给目标与起始迹象、`natural` 加契合点、`detonate` 加可见变化要求与三条方向，`signals.beat` 写弧线、序列、节拍 id、强度、难度、使用的契合点与楼层深度；`ChatTurnOptions.directorIntensity` 在 `runChatTurn` 追加楼层之前解析并重建导演槽位，`DirectorSlotProvider` 带出配置与机制；`dramaticer chat --intensity` 与 `POST /api/stories/:id/turns` 的 `intensity` 走同一套校验，非法值分别抛错与返回 400 且不建楼层；新增 `director-beat.test.ts`（8 个测试），更新三处机制列表断言、故事设置默认值与非法取值、chat CLI 与 server 回合测试；门禁通过（121 个测试文件、1075 个测试通过，3 个 live 跳过，共 1078 个）
  做什么：
  - 把 `director/opening.ts` 的强度渲染提取到 `director/intensity.ts`，类型 `OpeningIntensity` 改名为 `DirectorIntensity`（同步全部引用）；`openingIntensity` 的行为不变。
  - `DirectorConfig` 增加 `intensity`（`setup`、`natural`、`detonate`，默认 `natural`）并由 `assertDirectorConfig` 校验；单轮参数 `directorIntensity` 优先于故事设置；`dramaticer chat --intensity` 与 `POST /api/stories/:id/turns` 的请求体 `intensity` 走同一处解析，非法取值抛错。`intensity` 只作用于序列拍建议，`openingIntensity` 仍只作用于开场导演。
  - 新增 `director/beat.ts` 的 `createBeatMechanism`（`BEAT_PRIORITY = 23`，注册在开场机制之后）：`resolveCurrentBeat` 取当前拍，按强度拼出一条具体指令：`setup` 只给目标与起始迹象；`natural` 再给在场人物与事的契合点；`detonate` 要求本楼出现可见变化并附三条可选方向。契合点与起始迹象逐字来自计划，不泛化。
  - 决策的 `signals.beat` 写弧线、序列、节拍 id、强度、难度、使用到的契合点与当前楼层深度。纠偏信号沿用现有机制的优先级：重复正文 40、开场 35、线索过老 30、场景重复 25 都压过节拍 23；节拍压过线索过多 20、事件池 10 与节奏 5。评估全程只读数据库，不调用模型。
  验收：计划存在时指令包含当前拍的目标、起始迹象与至少一条契合点；三档强度的指令不同，`detonate` 出现可见变化要求；没有计划或拍耗尽时行为与改动前一致；单轮强度覆盖故事设置，非法值抛错；重复正文、线索过老与场景重复压过节拍；节拍压过线索过多与节奏；另一分支的拍状态不参与；导演评估的模型调用次数为零；`pnpm check` 通过。

- [x] **R4-T04 导演建议并入玩家消息末尾** | 依赖：R4-T03、R3-T03、M1-T04 | DESIGN §8.2、§9 | ADR-0077
  做什么：
  - `ContextSlotContent` 增加 `suffix?: string`，`ContextTraceEntry` 增加 `appendedTo?: "last-user"`；组装器在预算裁剪之后把 `suffix` 接在最后一条 `user` 消息的末尾，Trace 记来源、token 与 `appendedTo`；没有 `user` 消息时该槽位记 `missing-slot`，不产生独立消息。
  - `createDirectorSlotProvider` 改为返回 `suffix`：`【导演】<directive>` 加固定尾注 `玩家行动优先，你可以按剧情需要调整。`，不再返回 system 消息；尾注定义成导出的常量，测试直接引用。
  - 预算不足时整个 suffix 随该片段一起被标记 `budget-dropped`；原文不改写，Trace 的 token 计入总量；`dramaticer explain` 在上下文分段里显示 `appendedTo`。
  验收：组装结果里没有以 `【导演】` 开头的独立消息，最后一条 `user` 消息以指令与尾注结束；楼层原文与数据库中的玩家楼层不变；Trace 的来源、token 与 `appendedTo` 可读；导演关闭时没有 suffix；`protocol` 仍是最后一个模板段落；预算不足时 suffix 被裁剪并标记；没有玩家消息时记 `missing-slot`；`pnpm check` 通过。
  完成：2026-11-08 组装器支持 suffix 并在预算裁剪后拼接到最后一条 user 消息，导演槽位改为 suffix 注入，Trace 与 explain 记录 appendedTo

- [x] **R4-T05 透明与盲盒模式** | 依赖：R4-T04、M3-T02、M4-T03 | DESIGN §8.2 | ADR-0077
  做什么：
  - `DirectorConfig.enabled` 改为 `mode`，取值 `off`、`transparent`、`blind`，`assertDirectorConfig` 校验；读取旧故事设置时把 `enabled: true` 映射为 `transparent`、`false` 映射为 `off` 并从对象里去掉 `enabled`，之后写回只保存 `mode`。
  - `off` 不评估、不写决策、不注入；`transparent` 与 `blind` 都评估、写决策、注入 suffix，差别只在面向玩家的展示：`GET /api/nodes/:id/director` 在 `blind` 下返回 `mode` 与机制触发状态，`decision.directive` 为 null 且不返回 `signals`；`transparent` 返回完整决策。`explain` 是排障工具，两种模式都显示全文。
  - CLI 的 `--director` 取值改为 `off|transparent|blind`；故事设置接口接受同一取值，非法值指出字段。
  验收：三种模式各有用例；`off` 没有决策记录与 suffix；`transparent` 与 `blind` 都注入且决策记录逐字段相同；`blind` 的接口响应不含指令与信号；`explain` 在 `blind` 下仍显示全文；旧配置读取后 `mode` 正确且再次保存不出现 `enabled`；非法取值抛错并指出字段；`pnpm check` 通过。
  完成：2026-11-08 `DirectorConfig.enabled` 换成 `mode`（`off`、`transparent`、`blind`），旧配置读取时把 `enabled` 映射成 `mode` 并丢弃；`evaluateDirector` 在 `off` 下直接返回；`GET /api/nodes/:id/director` 增加 `mode`，盲盒下隐去指令与信号只留机制触发状态；CLI 与故事设置接口接受三种取值；新增 5 个测试

- [x] **R4-T06 落拍检测与拍推进** | 依赖：R4-T01、R4-T03、R1-T02.2 | DESIGN §8.3 | ADR-0077
  完成：2026-11-08 `prepareSettlement` 为每个楼层解析父节点处的当前拍（`SettlementWindow.beats`，没有计划或拍耗尽时为 null），结算与 `gap_pass` 的提示词只在存在当前拍时列出“当前拍”并给出可选的 `beatCompleted` 说明；`parseSettleResponse` 接受该字段（缺少按 false，非布尔让该楼层整条拒绝并记入 `repairs`）；`applySettlementProposals` 在同一事务里按路径顺序读取父节点当前拍并写入 `director_beat_states`，模型条目缺失、楼层被拒绝或解析出的拍已前进时跳过；`explain` 新增“当前拍与落拍记录”段（节拍 id、完成楼层、是否已前进），仍然只读；新增 7 个测试
  做什么：
  - 结算提示词在存在当前拍时为每层增加可选字段 `beatCompleted`（布尔），与结算数组一起返回；提示词只说明可以判断，不要求必须输出（I13）。缺少该字段按 false 处理，非法类型让该楼层整条拒绝并记入 `repairs`。
  - 结算写入后按路径顺序处理窗口内楼层：读取该楼层父节点处的当前拍，把 `beat_id` 与该楼层是否完成写入 `director_beat_states`（`completed`）；程序据此推进到下一拍，不额外调用模型、不新增请求。
  - 没有计划或当前拍已耗尽时不输出 `beatCompleted` 说明，也不写拍状态；分支切换后只使用当前路径上的拍状态。
  - `explain` 增加当前拍与完成记录（节拍 id、完成楼层、是否已前进），仍然只读。
  验收：模型输出完成的楼层写入拍状态并在下一轮解析出下一拍；缺省字段不推进；非法类型整楼层拒绝并记录原因；结算请求次数与改动前相同；没有计划时不写状态也不提该字段；另一分支的完成记录不参与；`explain` 能读回拍 id 与完成楼层；`pnpm check` 通过。

- [x] **R4-T07 候选行动** | 依赖：R4-T01、R4-T02、R5-T01、R1-T02.2 | DESIGN §8.3 | ADR-0077
  完成：2026-11-08 迁移 v33 新增 `director_candidate_actions`（按 `ordinal` 排序、同楼层唯一，跨故事写入由触发器拒绝）；新增 `director/candidates.ts`（`CANDIDATE_ACTIONS_JOB_KIND`、`parseCandidateActionsResponse`、`collectCandidateActionsInput`、`buildCandidateActionsUserContent`、`generateCandidateActions`、`createCandidateActionsHandler`）：输入取当前拍与强度、最近 3 楼原文、未兑现线索与人物关系，输出必须正好 4 条行动加 1 条场景变化且五条互不重复，未知字段、数量不符、空字符串与重复正文整批拒绝；`StoryStore.replaceDirectorCandidateActions` 在同一事务里替换该楼层旧候选，`listDirectorCandidateActions` 按楼层读取；默认注册表注册 `candidate_actions`（档位 `gap`、入队条件 `settled`、使用 `plannerClient`）；CLI `dramaticer actions --node <id> --db <path> [--json]`；server `GET /api/nodes/:id/actions`（`NodeActionsView`）；新增 11 个 core 测试与 1 个 server 测试，覆盖上下文隔离与回合内单次调用；门禁通过（123 个测试文件、1104 个测试通过，3 个 live 跳过，共 1107 个）
  做什么：
  - 迁移 v33 新增 `director_candidate_actions(id, story_id, node_id, ordinal, kind, text, created_at)`，`kind` 取 `action`、`scene_change`。
  - 后台任务 `candidate_actions`（档位 `gap`，入队条件 `settled`）：一次调用产出 4 条行动与 1 条场景变化；严格 JSON `{actions:[...],"sceneChange":"..."}`，必须正好 4 条且与场景变化互不重复、全部非空，未知字段与数量不符整批拒绝并重试。输入为当前拍与强度、最近 3 楼原文、未兑现线索与人物关系；使用 `roles.planner`。
  - 写入在同一事务里替换该楼层的旧候选；同一楼层重复执行不新增行。候选不进入上下文、不改变 head、不自动发送，只供读取。
  - CLI 新增 `dramaticer actions --node <id> --db <path> [--json]`；server 新增 `GET /api/nodes/:id/actions`，返回 5 条与各自 `kind`。
  验收：合法输出写入 4 条行动与 1 条场景变化，顺序固定为行动在前；重复执行行数不变；非法数量、空字符串与重复正文整批拒绝且不写入；候选不出现在下一次组装的上下文里；不是 `gap` 档时不执行；读取接口按楼层返回，切换分支后另一楼层的候选不参与；回合内零模型调用；`pnpm check` 通过。

- [x] **R4-T08 卡扩展弧线与序列** | 依赖：R4-T01、M3-T03 | DESIGN §8.3 | ADR-0077
  完成：2026-11-08 `DramaticerCardExtension` 增加 `arcs`（结构与 `DirectorPlan` 相同），`parseDramaticerCardExtension` 把 `arcs ?? []` 交给 `parseDirectorPlan(…, "extensions.dramaticer")`，未知字段、重复 id、空字符串、越界难度与空契合点都指出 `extensions.dramaticer.arcs[...]` 路径；`importDramaticerExtension` 用 `mergePlannedArcs(…, "import")` 写入并返回 `arcs` 计数，同 id 更新、新 id 追加、不删除、不覆盖 `player` 行；新增 2 个 core 测试与 4 个 st-compat 测试；门禁通过（123 个测试文件、1110 个测试，3 个 live 跳过）
  做什么：
  - `DramaticerCardExtension` 增加 `arcs`：每个弧线含 `id`、`title`、`throughLine`、`difficulty`、`redLines`、`sequences`，序列与节拍字段与 `DirectorPlan` 相同；`parseDramaticerCardExtension` 接受 `arcs` 键并复用 `parseDirectorPlan` 的校验，未知字段、重复 id、空字符串与越界难度都抛错并指出 `extensions.dramaticer.arcs[...]` 路径。
  - `importDramaticerExtension` 把弧线与序列用 `mergePlannedArcs` 写入，来源 `import`：同 id 更新，新 id 追加，不删除既有行，不覆盖 `player` 行；重复导入不产生重复行。没有 `arcs` 时行为与现状一致。
  - 事件与 NPC 议程的解析、导入与存储不变；`extensions` 里的其它未知字段仍只由卡解析层处理，不影响 ST 卡导入。
  验收：合法扩展解析出弧线、序列与节拍；未知字段、重复 id、空字符串、越界难度与空契合点各抛错并指出路径；导入后计划可读且来源为 `import`；重复导入行数不变、文本更新；玩家编辑的行保留；没有 `arcs` 时导入计数不变；带 `extensions.dramaticer` 的合成卡可以正常导入；`pnpm check` 通过。

- [x] **R4-T99 R4 验收** | 依赖：R4 全部任务
  完成：2026-11-08 新增 `packages/core/test/director-acceptance.test.ts`（5 个测试）用假客户端跑通计划、拍选择、注入、落拍与候选行动的五轮链路，并覆盖关闭导演、盲盒注入、玩家编辑与零调用评估；逐条核对 R4-T01 至 R4-T08 的验收标准，复核 I9 与 I13，确认 R5-T08 可复用计划、决策、候选与线索接口；报告写入 `docs/dev/reports/R4.md`；门禁通过（124 个测试文件、1115 个测试通过，3 个 live 跳过，共 1118 个）
  做什么：逐条核对短线层零模型调用、建议具体到人和事、玩家可编辑与关闭、落拍检测不额外调用、候选行动不进上下文；复核 I9（实时选择与翻页用程序实现，导演只给建议）与 I13（不强制模型输出结构，`beatCompleted` 可不输出）；用假客户端跑一次包含计划、节拍选择、注入、落拍与候选行动的 5 轮链路；写 `docs/dev/reports/R4.md`；确认 R5 任务（尤其 R5-T08 面板复用计划、动作与决策接口）。
  结果写 `MILESTONE_DONE`。

## R5：能玩的界面

> 执行顺序（ADR-0044）：第一段是最小界面，按 R5-T02.a、R5-T05.a、R5-T02.b、R5-T02.c（服务端与核心接口）→ R5-T04（web 骨架）→ R5-T05.b（聊天对话）→ R5-T05.c（候选与模式锁定）→ R5-T07（台账只读）→ R5-T11（沙箱块渲染）执行；第二段是其余面板与接口（R5-T03、R5-T06、R5-T07.a、R5-T08、R5-T09、R5-T10）；第三段是 R5-T12、R5-T13、R5-T14 与 R5-T99。任务编号保持原样。

- [x] **R5-T00 细化 R5 任务** | 依赖：R4-T99
  完成：2026-11-08 按 ADR-0044 排定最小界面路径（T02.a → T05.a → T02.b → T02.c → T04 → T05 → T07 → T11），新增五个子任务：回合参数（单轮模式与强度）、路径分页、开局任务入队与开场候选重新生成、重新生成记录 `swipe` 偏好、变更卡审批与回滚；T05 补齐选项 `choice` 偏好、候选行动与开场候选、分页与模式开关；T07 改为只读并写入 `{state, facts, diffs}`；T08 按导演决策、候选行动、计划、线索、模式与 Trace 分开接口；T09 覆盖全部设置字段并把 `block_format` 改为模板段落；T03 与 T10 补 `roles`；T11 补显示策略载荷；T12 至 T14 补偏好与变更卡用例；门禁通过（124 个测试文件、1115 个测试，3 个 live 跳过）
  做什么：在并入的 M4 剩余任务基础上按上面的执行顺序排定：最小界面只做聊天、swipe（重 roll 与重新生成）、台账只读面板、图片与选项块、模式开关、候选行动与开场候选的显示；其余面板（分支树、变更卡、导演与 Trace、设置与模板、渠道）在最小界面通过后做；Playwright 与 60 轮自动试玩放在最后。把模式开关、台账读取接口、偏好信号接线、候选行动与开局候选的显示加入任务，删除已被 R1–R4 取代的旧面板描述。
  验收：R5-T01 至 R5-T14 的依赖与验收与 DESIGN §8、§10.1、§13 一致；最小界面的验收不依赖后续面板；`pnpm check` 通过。

- [x] **R5-T01 server 后台任务调度**（原 M4-T07） | 依赖：M4-T06、M2-T03、R1-T02 | DESIGN §4、§7
  完成：2026-11-08 新增 `packages/server/src/background.ts` 的 `BackgroundScheduler`：回合成功并发出 `turn.completed` 后按故事排入队列，服务端同一时刻只跑一个 drain，故事之间先来先做、任务按创建顺序执行；后台使用运行时里的独立 `backgroundClient`（单独创建的客户端，限速互不影响）与 `createDefaultBackgroundJobRegistry`（带 embedding 客户端），`gap_pass` 按故事开关过滤；drain 新增 `signal`，处理器上下文带上中止信号，11 个后台任务处理器把信号传给模型请求，关闭服务时取消本轮并把 running 任务退回 pending、不消耗执行次数；新增 `GET /api/stories/:id/jobs` 返回五个状态计数与最多 5 条最近错误；新增 4 个调度测试、2 个接口测试与 1 个回合先后顺序测试，全部使用假处理器与假客户端；门禁通过（111 个测试文件、980 个测试，3 个 live 跳过）
  做什么：
  - 回合成功后在后台执行 `enqueueMissingJobs` 与 `drainBackgroundJobs`，不阻塞 SSE 结束；服务端同一时间只跑一个后台任务，按创建顺序；使用独立的 `background` 客户端与限速。
  - 失败按任务框架的规则记录，超过重试次数后标为 `failed` 并保留最后错误；服务端关闭时中止正在执行的处理器。
  - 新增 `GET /api/stories/:id/jobs` 返回 pending/running/done/failed 计数与最近错误，供面板显示。
  验收：回合响应先于后台任务完成；结算、事件与压缩在任务完成后写入；失败重试到 `failed`；关闭服务不留下未结束的异步任务；测试用假处理器且零网络；`pnpm check` 通过。

- [x] **R5-T02 server 分支与面板接口**（原 M4-T08） | 依赖：M4-T06、M4-T03、R1-T01
  完成：2026-11-08 新增分支接口 `GET /api/stories/:id/tree`（`StoryStore.listStoryNodes` 按创建顺序读全树，节点只给 80 字预览）、`GET /api/stories/:id/path?nodeId=`、`POST /api/nodes/:id/swipe`、`POST /api/nodes/:id/edit`、`POST /api/stories/:id/head`、`POST /api/nodes/:id/regenerate`（SSE，复用 `regenerateAssistantTurn` 与回合的流式外壳）；面板 `GET /api/nodes/:id/trace|ledger|events|compressions|director`、故事级 `clues`（未兑现）、`POST /api/clues/:id/fulfill`（请求体带 `storyId`，走新增的 `core/ledger/clues.ts`，写入 `status` 与 `updatedAt` 两条 `source` 为 `player` 的 diff）、`entities`、`lore`、`proposals?status=`（默认 `pending`）、`openings?status=` 与 `openings/:id/pick`；`/compressions` 当前返回当前路径上有效的分层摘要（`getValidSummaries`），R1-T05 引入八段式压缩表后替换数据源；`packages/protocol/src/panels.ts` 提供全部响应类型；故事级接口里跨故事的节点与候选一律 404；新增 8 个 server 测试（分支 4、面板 4）与 1 个重新生成测试，零网络；门禁通过（113 个测试文件、989 个测试，3 个 live 跳过）
  做什么：
  - 分支：`GET /api/stories/:id/tree`、`GET /api/stories/:id/path?nodeId=`、`POST /api/nodes/:id/swipe`、`POST /api/nodes/:id/edit`、`POST /api/stories/:id/head`、`POST /api/nodes/:id/regenerate`。
  - 面板：`GET /api/nodes/:id/trace`、`/ledger`、`/events?limit&offset`、`/compressions`、`/director`；`GET /api/stories/:id/clues`、`POST /api/clues/:id/fulfill`；`GET /api/stories/:id/entities`、`/lore`、`/proposals`；开场候选 `GET /api/stories/:id/openings`、`POST /api/stories/:id/openings/:id/pick`。
  - 节点必须属于请求路径里的故事，否则 404；响应使用 protocol 类型；不返回密钥。
  验收：swipe 与 edit 生成兄弟且旧节点不变；head 切换后路径正确；regenerate 走 M4-T03；面板数据与 store 一致；跨故事节点 404；`pnpm check` 通过。

- [x] **R5-T02.a 回合参数：单轮模式与强度** | 依赖：R5-T02、R3-T01、R4-T03 | DESIGN §10.1
  完成：2026-11-08 `TurnRequest` 补 `mode` 与 `intensity`；`POST /api/stories/:id/turns` 接受 `mode` 并在写楼层之前用 `resolveTurnMode`（core 导出）校验，深回合转 400 并指出 R3b、`details.path` 区分 `mode` 与 `turnMode`，楼层数不变；`handleTurnStream` 把模式传给 `generateAssistantTurn`，Trace 记录 `turnMode`；非法 `mode` 返回 400 并指出字段；新增 1 个 server 测试；门禁通过（124 个测试文件、1116 个测试）
  做什么：
  - `packages/protocol/src/turn.ts` 的 `TurnRequest` 补齐 `text`、`mode`（可选，`fast` 或 `deep`）与 `intensity`（可选，`setup`、`natural`、`detonate`）；未知字段仍然 400。
  - `POST /api/stories/:id/turns` 把 `mode` 交给 `handleTurnStream` 与 `runChatTurn` 的 `turnMode` 参数；`intensity` 继续走 `readOptionalIntensity`。缺省值取故事设置 `turnMode`。
  - 深回合在 R3b 完成前由 `resolveTurnMode` 抛错；服务端把它转成 400 并指出 R3b，不写楼层。
  验收：请求带 `mode` 为 `fast` 时 Trace 的 `turnMode` 为 fast；省略 `mode` 时使用故事设置的值；请求 `deep` 返回 400、错误信息指出 R3b、楼层数不变；`intensity` 非法值 400 并指出字段；协议类型与实现字段一致；`pnpm check` 通过。

- [x] **R5-T02.b 路径分页** | 依赖：R5-T02、M4-T06 | DESIGN §13
  完成：2026-11-08 `GET /api/stories/:id/path` 支持 `limit`（默认 60，范围 1–200，越界或非整数 400 且 `details.path` 为 `limit`）与 `before`（必须位于锚点路径上，否则 404；`nodeId` 仍是锚点、缺省 head）；`StoryPath` 增加 `hasMore`，页仍然是根到当前页末楼的顺序，只裁掉更早楼层；`buildPath` 给 swipe、edit、head、开场候选选中这些完整路径响应填 `hasMore: false`；新增 2 个 server 测试（2000 楼夹具 34 页连续向上加载不重复不丢楼、锚点与 `before` 组合、越界与路径外 `before`、空故事）；门禁通过（124 个测试文件、1121 个测试通过，3 个 live 跳过）
  做什么：
  - `GET /api/stories/:id/path` 增加 `limit`（默认 60，范围 1–200）与 `before`（节点 id）；`nodeId` 仍是锚点（缺省 head），`before` 是继续向上加载的起点，必须位于同一锚点的路径上。
  - `StoryPath` 增加 `hasMore`；`nodes` 仍按根到当前页最后一个节点的顺序，分页只裁掉更早的楼层。
  - `before` 不在该故事或不在锚点路径上时 404；`limit` 越界 400 并指出字段；故事没有楼层时 `nodes` 为空、`hasMore` 为 false。
  验收：2000 楼夹具首屏返回 60 楼且 `hasMore` 为真；用上一页最早楼层的 id 作为 `before` 连续取页，页与页之间不重复不丢楼，取完后 `hasMore` 为假；不带分页参数时返回锚点侧最近 60 楼；越界 `limit` 返回 400、路径外 `before` 返回 404；`pnpm check` 通过。

- [x] **R5-T02.c 开局任务入队与开场候选重新生成** | 依赖：R5-T01、R5-T02、O-T01、O-T03 | DESIGN §8.4
  完成：2026-11-08 `StoryStore.enqueueStoryBackgroundJobs` 按种类入队故事级任务（`node_id` 为空；已有待办或执行中的行原样返回，已完成、失败、丢弃的行翻回 `pending`）；`enqueueOpeningBackgroundJobs` 按 `openingPackNeedsRun` 与 `openingCandidatesNeedRun` 过滤后调用它；创建故事与导入卡的路由在响应之前入队并调用 `BackgroundScheduler.schedule`，模型调用只在后台 drain 里发生；新增 `POST /api/stories/:id/openings/generate`（无楼层时入队 `opening_candidates` 并返回 202 与任务 id，已有楼层 409，`StoryOpeningGenerateResult`）；`createOpeningCandidatesHandler` 删掉待选候选守卫，自动入队仍由 `openingCandidatesNeedRun` 控制；新增 1 个 server 测试（闸门卡住模型调用，验证导入响应内两条任务已入队、开局包与候选未生成；连续两次手动生成得到两批 9 条候选且第一批保持 `pending`；选中后成为根楼层且其余丢弃；再生成 409）与 4 个 core 测试；门禁通过（125 个测试文件、1127 个测试，3 个 live 跳过，共 1130 个）
  做什么：
  - 创建故事与导入卡之后调用 `BackgroundScheduler.schedule(storyId)`，让 `opening` 与 `opening_candidates` 两条故事级任务按各自的 `needsRun` 入队；请求立即返回，不等待生成（I11）。
  - 新增 `POST /api/stories/:id/openings/generate`：故事还没有助手楼层时入队一条 `opening_candidates` 任务，返回 202 与任务 id；已有楼层时 409。接口本身不调用模型。
  - `createOpeningCandidatesHandler` 只保留“故事已有楼层就不生成”的守卫，删掉“已有待选候选就不生成”的守卫：自动入队仍由 `openingCandidatesNeedRun` 的待选判定控制，手动任务每次追加新一批。
  - `StoryStore` 新增按种类入队的方法（不改表结构），故事创建、导入与生成接口共用它。
  验收：导入合成卡后响应不等待后台就出现 `opening` 与 `opening_candidates` 两条故事级任务，drain 之后开局包与 3 条候选入库；已有楼层时生成接口返回 409；连续两次手动生成得到两批候选，第一批在选中之前仍为 `pending`；选中一条后成为根楼层，其余待选变为 `discarded`；生成接口与创建流程的模型调用都在后台执行；`pnpm check` 通过。

- [x] **R5-T04 web 骨架与 API 客户端**（原 M4-T10） | 依赖：M4-T05、M4-T06、M4-T01、R5-T02.a | DESIGN §13
  完成：2026-11-08 新建 `packages/web`（React 19、Vite 8、TypeScript，中文，移动端优先）：路由为登录、故事列表与故事页的六个面板（聊天、分支、台账、导演、设置、渠道），面板内容留占位；`api` 客户端带 cookie 凭据并把全部故事、分支、面板与设置接口包成类型化方法，统一抛 `ApiError` 并由 `ErrorNotice` 显示；`parseSseStream` 增量解析任意分块、多事件、注释、CRLF 与多行 data，`streamTurn` 与 `streamRegenerate` 用 fetch 与 ReadableStream 转发事件、`turn.error` 转成 `ApiError`、支持 AbortController，请求体带 `mode` 与 `intensity`；移动端底部导航含安全区，390×844 实测 `scrollWidth` 为 390，桌面宽屏为 220px 侧栏加内容两栏；根脚本接入 `typecheck` 与 `build`，七个依赖登记在 DEPENDENCIES；新增 16 个测试；门禁通过（127 个测试文件、1143 个测试通过，3 个 live 跳过，共 1146 个）
  做什么：
  - 新增 `packages/web`（React、Vite、TypeScript，中文，移动端优先）；路由使用 `react-router-dom`；页面骨架：登录、故事列表、故事页（聊天、分支、台账、导演、设置、渠道）。本任务只建路由与布局，聊天、台账、分支、导演、设置、渠道的内容由后续任务填充。
  - `api` 客户端使用 cookie 凭据与 protocol 类型；`turn` 用 fetch 与 ReadableStream 解析 SSE，支持 AbortController，请求体带 `mode` 与 `intensity`；故事、分支、面板与设置接口各有类型化方法；错误统一显示。
  - 移动端布局：底部导航、安全区、390×844 无横向滚动；桌面宽屏两栏。
  - 根脚本接入 `typecheck` 与 `build`；登记 `react`、`react-dom`、`react-router-dom`、`vite`、`@vitejs/plugin-react`、`@types/react`、`@types/react-dom`。
  验收：`pnpm check` 与 `pnpm --filter @dramaticer/web build` 通过；SSE 解析器单测覆盖分块、多事件、注释与错误事件；API 客户端用假 fetch 测试；390×844 截图无横向滚动。

**R5-T05 web 聊天界面**（原 M4-T11；已分成 R5-T05.b 与 R5-T05.c） | 依赖：R5-T02、R5-T04、R5-T02.a、R5-T02.b、R5-T02.c、R5-T05.a、M4-T06、R3-T99

  做什么：
  - 按 `GET /api/stories/:id/path` 渲染当前路径；向上滚动用 `before` 分页加载更早楼层；虚拟列表只渲染可见楼层；head 变化后重新取路径并定位到 head。
  - 流式正文：`turn.started`、`text.delta`、`thinking.delta`、`blocks.replace`、`turn.completed`、`turn.error`；思考默认折叠；停止用 AbortController 并保留已经收到的正文；失败重试不重复写楼层。
  - 原生块组件：选项、页眉、悄悄话、旁白、备忘、状态栏、分析；未知块显示原文。选项块里的每一行可点击：点击后把该行原文填入输入框，并调用 `POST /api/nodes/:id/choice`（`nodeId` 是含该选项块的助手楼层，正文按原行文本发送），不自动发送。
  - 模式开关：输入框旁的“快 / 深”切换；单轮值通过 `POST /api/stories/:id/turns` 的 `mode` 发送；可以锁定故事（`PUT /api/stories/:id/settings` 的 `turnMode`）；R3b 完成前不展示深回合选项，服务端返回 400 时显示原因。
  - 最新助手楼层可以重新生成（`POST /api/nodes/:id/regenerate`，走 SSE 外壳）；候选行动：回合完成后读取 `GET /api/nodes/:id/actions`，点击一条填入输入框，不自动发送。
  - 开场候选：故事没有助手楼层时读取 `GET /api/stories/:id/openings?status=pending` 显示候选；选中调用 `POST /api/stories/:id/openings/:id/pick` 后刷新路径；“重新生成”调用 `POST /api/stories/:id/openings/generate` 并显示新一批候选。
  - 发送、停止、失败重试；回合完成后显示 `turn.completed` 的台账 diff 数、从 `stateDiffs` 统计的新建与兑现线索条数、首字延迟；自动滚动与“回到底部”。
  验收：增量逐字出现；思考默认折叠；停止后保留部分内容；错误重试不重复写楼层；选项点击只写一条 `choice` 偏好并填入输入框，不发送正文；重新生成写一条 `swipe` 偏好；候选行动与开场候选都不自动发送；模式只能由玩家手动切换，深回合未实现时界面不展示该选项，服务端拒绝时显示原因；2000 楼夹具只渲染可见楼层、分页加载不重复不丢楼、head 变化后定位正确；键盘与触摸可用；纯逻辑单测覆盖 SSE 事件归并、分页合并与选项行选择；`pnpm check` 通过。

- [x] **R5-T05.b 聊天对话：路径、虚拟列表、块渲染与流式回合** | 依赖：R5-T02、R5-T04、R5-T02.a、R5-T02.b、R5-T05.a、M4-T06、R3-T99
  完成：2026-11-08 聊天页按 `GET /api/stories/:id/path` 渲染，向上滚动用 `before` 分页并在加页后停住原楼层，虚拟列表按测量高度只渲染视口附近楼层（2000 楼夹具实测 9 层 DOM）；SSE 归并正文、思考、块快照与工具调用，停止后服务端保存的部分正文重新取路径可见；失败按“是否已经写用户楼层”选择重发、重新生成或提示，不重复写楼层；原生块组件覆盖选项、页眉、悄悄话、旁白、备忘、状态栏、分析与图片，思考折叠，未闭合块与未知标签显示原文；选项行点击填入输入框并调用 `recordChoice`，最新助手楼层可重新生成；回合统计条给出 diff 数、新建与兑现线索与首字延迟；core 新增 `@dramaticer/core/blocks` 浏览器入口与共享的 `readOptionLines`（偏好导出复用）；新增 5 个 web 测试文件共 22 个测试与一次真实 server 加假渠道冒烟；门禁通过（132 个测试文件、1165 个测试通过，3 个 live 跳过，共 1168 个）
  做什么：
  - 按 `GET /api/stories/:id/path` 渲染当前路径；向上滚动用 `before` 分页加载更早楼层；虚拟列表只渲染可见楼层；回合完成或 head 变化后重新取最新页并定位到底部。
  - 输入框发送 `POST /api/stories/:id/turns`，消费 `turn.started`、`text.delta`、`thinking.delta`、`blocks.replace`、`turn.completed`、`turn.error`；思考默认折叠；停止用 AbortController，服务端保存已经生成的部分正文；失败后按“是否已经写过用户楼层”决定重发还是重新生成，不重复写楼层。
  - 原生块组件：选项、页眉、悄悄话、旁白、备忘、状态栏、分析；变量更新与写入类块不显示；未知块与未闭合块显示原文；选项块每一行是按钮，点击把该行原文填入输入框并调用 `POST /api/nodes/:id/choice`，不自动发送。
  - 模式：输入框旁只列出当前可用模式（R3b 完成前只有快回合），单轮值通过 `mode` 发送；服务端 400 时显示原因。最新助手楼层可以重新生成（`POST /api/nodes/:id/regenerate`，走 SSE 外壳）。
  - 回合完成后显示台账 diff 数、`stateDiffs` 里新建与兑现的线索条数、首字延迟；自动滚动与“回到底部”。
  验收：增量逐字出现；思考默认折叠；停止后保留部分内容；错误重试不重复写楼层；选项点击只写一条 `choice` 偏好并填入输入框，不发送正文；重新生成写一条 `swipe` 偏好；深回合未实现时界面不展示该选项，服务端拒绝时显示原因；2000 楼夹具只渲染可见楼层、分页加载不重复不丢楼、head 变化后定位正确；键盘与触摸可用；纯逻辑单测覆盖 SSE 事件归并、分页合并、虚拟窗口、回合统计与选项行选择；`pnpm check` 通过。

- [x] **R5-T05.c 聊天候选：候选行动与开场候选** | 依赖：R5-T05.b、R5-T02.c、R5-T02 | DESIGN §8.3、§8.4
  完成：2026-11-08 聊天页在最新助手楼层完成后读取 `GET /api/nodes/:id/actions`，候选由间隙任务写入，未出现时按 2 秒间隔最多取 15 次；4 条行动与 1 条场景变化按 `ordinal` 分开展示，点击只填入输入框不发送。故事为空时读取 `GET /api/stories/:id/openings?status=pending` 显示候选原文（首次进入同样轮询到出现），选中走 `pick` 后成为根楼层并刷新路径；“重新生成”走 `generate` 后按 2 秒间隔轮询新一批，旧批保留、新批标“新一批”。故事锁定的回合模式从 `GET settings` 读取并作为 `mode` 发送，锁定为深回合时输入框旁提供“切回快回合”按钮，经 `PUT settings` 写回并在下一回合生效；深回合发送被服务端 400 拒绝时 `ErrorNotice` 显示原因且不写楼层。新增 `src/chat/candidate-actions.ts` 与 `src/chat/opening-candidates.ts`（纯逻辑）、`CandidateActions.tsx` 与 `OpeningCandidates.tsx` 两个组件，以及 9 个测试；真实 server 加注入的假客户端冒烟：候选行动点击只填输入框、重新生成后 6 条候选里 3 条标新批、选中成为根楼层、深回合锁定被拒并显示原因、切回快回合写入设置、390×844 无横向滚动；门禁通过（134 个测试文件、1174 个测试通过，3 个 live 跳过，共 1177 个）
  做什么：
  - 回合完成后读取 `GET /api/nodes/:id/actions`，按楼层显示 4 条行动与 1 条场景变化；点击一条填入输入框，不自动发送。
  - 故事没有助手楼层时读取 `GET /api/stories/:id/openings?status=pending` 显示候选原文；选中调用 `POST /api/stories/:id/openings/:id/pick` 后刷新路径；“重新生成”调用 `POST /api/stories/:id/openings/generate`，轮询到新一批候选出现后显示。
  - 模式锁定：把单轮模式写进故事设置 `turnMode`（`PUT /api/stories/:id/settings`），只由玩家操作；锁定为深回合而服务端拒绝时显示原因。
  验收：候选行动按楼层显示且点击只填输入框；开场候选不自动发送；选中后成为根楼层、路径刷新，重新生成后显示新一批且旧批仍可查看；模式锁定写入设置并在下一回合生效；纯逻辑单测覆盖候选批次归并与轮询状态；`pnpm check` 通过。

- [x] **R5-T05.a 重新生成记录 swipe 偏好** | 依赖：R2-T07、R5-T02.a | DESIGN §14.5
  完成：2026-11-08 `GenerateAssistantTurnOptions` 增加可选 `swipeFromNodeId`，`regenerateAssistantTurn` 传入原助手楼层；正常完成与中止保存部分正文两条写入路径都在同一事务里调用 `recordPreference`，载荷为被放弃的原楼层与被接受的新楼层，一次重新生成只写一条；生成失败且没有新楼层时不写；`swipeNode` 路径不变；新增 3 个测试；门禁通过（124 个测试文件、1119 个测试，3 个 live 跳过）
  做什么：
  - `regenerateAssistantTurn` 在写入新助手楼层时，与楼层写入同一个事务里记录一条 `swipe` 偏好：被放弃的原助手楼层、被接受的新楼层。
  - 中止但已保存部分正文时同样记录；生成失败且没有产生楼层时不记录；一次重新生成只写一条，客户端与 CLI 都走同一处。
  - 已有的 `swipeNode` 路径不改，仍然按传入正文写兄弟节点并记录偏好。
  验收：重新生成成功后新增一条 `swipe` 记录且两个节点 id 正确；中止保存部分正文时也记录；失败且没有楼层时不记录；一次操作只有一条记录；服务端与 `dramaticer` CLI 的行为一致；`pnpm check` 通过。

- [x] **R5-T06 web 分支视图**（原 M4-T12） | 依赖：R5-T05、R5-T02
  完成：2026-11-08 新增 `packages/web/src/chat/branch-tree.ts`（`buildBranchRows`、`toggleCollapsed`、`pruneCollapsed`、`collectPathNodeIds`、`describeHeadSwitch`）：`GET /api/stories/:id/tree` 按深度优先展开成行，只有分叉之后的子树缩进一层（线性楼层平齐，缩进上限 8 层），当前 head 路径高亮、head 单独标记、折叠行显示被藏起来的子孙数；完整路径用 `GET /api/stories/:id/path` 按 200 楼分页从最新页向上取完，按根到 head 的顺序合并；切换 head 前给出提示文本，写明其他分支保留、所选楼层是否已有后续、当前末端是否未确认。新增 `packages/web/src/components/branches/BranchTree.tsx` 与重写的 `BranchesPage.tsx`：选楼后按 `GET /api/stories/:id/path?nodeId=&limit=1` 取原文；切换 head 为两步确认，`POST /api/stories/:id/head` 后重取树与路径；编辑走 `POST /api/nodes/:id/edit`（预填原文，保存新建兄弟楼层，旧楼层保留）；swipe 走 `POST /api/nodes/:id/swipe`（玩家填写正文）；重新生成走 `POST /api/nodes/:id/regenerate` 的 SSE，用既有 `TurnDraft` 归并事件，结束后重取树与路径并选中新楼层。`formatFloorTime` 提到 `chat/format.ts` 供聊天页与分支页共用；`styles.css` 增加树与详情面板样式（宽屏左右分栏，390×844 无横向滚动）。新增 14 个纯逻辑测试（展开顺序、路径标记、折叠计数、嵌套缩进上限、缺失节点与环直接失败、分页合并与上限、切换提示）。真实 server 加注入假客户端冒烟：8 层楼与 6 层路径高亮、收起 a1 计 6 楼、带提示的 head 切换与高亮变化、编辑与 swipe 各新增一层且旧分支可切回且原文不变、重新生成流式写入并成为 head、移动端无横向滚动。
  做什么：
  - 楼层树（缩进与折叠）、当前路径高亮、点击切换 head（`POST /api/stories/:id/head`）；树的数据来自 `GET /api/stories/:id/tree`，节点用预览文本显示。
  - 编辑用户或助手正文（`POST /api/nodes/:id/edit`）；在树上任意助手楼层上 swipe（`POST /api/nodes/:id/swipe`，正文由玩家提供）与重新生成（`POST /api/nodes/:id/regenerate`）；切换前提示未确认楼层的后果。
  - 聊天页已经提供最新楼层的重新生成；本任务补齐树上任意楼层的入口。
  验收：swipe 与 edit 后旧分支仍可切回；编辑后原文不变；head 切换与路径刷新正确；移动端可操作；纯逻辑单测覆盖树构造与路径标记；`pnpm check` 通过。

- [x] **R5-T07 web 台账与记忆面板**（原 M4-T13） | 依赖：R5-T04、R5-T02、R1-T01
  完成：2026-11-08 新增 `packages/web/src/chat/ledger-view.ts`（命名空间切分、完整路径高亮、值格式化与展开阈值、故事时间/来源/置信度格式化、事件元数据、offset 分页与按 id 去重）与 `components/ledger/{LedgerValue,StateTree}.tsx`；`LedgerPage` 左侧复用楼层树选择任意楼层，右侧展示本楼 `diffs`（路径、值、`source`、`confidence`、`storyTime`、删除标记，状态树按完整路径高亮并自动展开被写入的子树）、九个命名空间分区的 `state` 与 `facts`（来源楼层、写入时间）、事件分页（每页 20，按 offset 续取并在切换楼层后重取）、分层摘要与覆盖区间、故事级未兑现线索/实体与别名/世界书；全程只调用 `GET` 接口；新增 15 个纯逻辑测试；真实 server 加 Playwright 冒烟通过（默认 head、8 条写入、7 行高亮、长值展开、20→25 条事件、切换楼层后 16 条写入与 12 条事件、只读请求、390×844 无横向溢出）；门禁通过（136 个测试文件、1203 个测试通过，3 个 live 跳过）
  做什么：
  - 本楼台账：`GET /api/nodes/:id/ledger` 返回 `{state, facts, diffs}`；按命名空间树展示 `state`，本楼 `diffs` 高亮（路径、值、`source`、`confidence`、`storyTime`），`facts` 显示来源楼层与写入时间。
  - 分栏：人物与关系（`character`、`relation`）、物品（`item`）、场景（`scene`）、时间（`time`）、线索（`clue`）、知情表（`knowledge`）、用户意志（`userWill`）；`mvu` 按原路径展示。
  - 故事级列表：`GET /api/stories/:id/clues`（未兑现线索）、`/entities`（实体与别名）、`/lore`（世界书条目）。
  - 事件与摘要：`GET /api/nodes/:id/events?limit&offset` 分页展示时间、地点、参与者、重要度、知情者与来源楼层；`GET /api/nodes/:id/compressions` 展示当前生效的分层摘要与覆盖区间。
  - 只读：不提供编辑、批复或兑现入口；变更卡的操作在 R5-T07.a，线索兑现按钮在 R5-T08。
  验收：面板数据与接口一致；本楼 diff 高亮只标该楼层自己的写入；长值可展开；空状态清楚；事件分页游标正确、切换楼层后重新取数；面板没有任何写接口调用；纯逻辑单测覆盖格式化与分页；`pnpm check` 通过。

- [x] **R5-T07.a web 变更卡审批与回滚** | 依赖：R5-T07、R1-T07.a、R5-T02
  完成：2026-11-08 core 新增 `LedgerChangeCardError`（`not_found`、`invalid_status`），批准、拒绝与回滚在原因可区分处抛出该错误；server 新增 `POST /api/proposals/:id/approve|reject|rollback`，复用三个核心函数，卡片不存在 404、状态不允许 409，响应返回更新后的卡片与卡片所属故事 head 的台账快照（`ProposalDecisionResult`，没有楼层时为 null）；web 台账页新增变更卡分组列表（待审、已批准、已拒绝、已回滚），显示来源、来源楼层、路径、值与拒绝原因，批准、拒绝与回滚成功后用返回卡片替换、head 被选中时直接刷新台账并重取线索；`card_decision` 仍由核心在事务里写，界面不重复记录；新增 1 个 server 测试、5 个纯逻辑测试与 1 个客户端测试；真实 server 加 Playwright 冒烟通过（390×844 批准后状态树出现 `mvu.time`、回滚后消失、拒绝不改台账、2 条 `card_decision`、无横向溢出）；门禁通过（137 个测试文件、1210 个测试通过，3 个 live 跳过）
  做什么：
  - server 新增 `POST /api/proposals/:id/approve`、`/reject`、`/rollback`：复用 `approveLedgerChangeCard`、`rejectLedgerChangeCard`、`rollbackLedgerChangeCard`，不另写规则；卡片不存在 404，状态不允许时 409；响应返回更新后的卡片与台账快照。
  - web 在台账面板增加待审变更卡列表：数据来自 `GET /api/stories/:id/proposals?status=pending`，显示路径、值、来源（`model`、`settler`、`player`）与拒绝原因；批准、拒绝与回滚调用上述接口，成功后刷新台账。
  - 批准与拒绝由核心在事务里写入 `card_decision` 偏好，界面不重复记录。
  验收：批准后台账出现 `source` 为 `player` 的事实；拒绝不改台账；回滚恢复批准前的值；非待定卡片再次批准返回 409；不存在或跨故事的卡片返回 404；一次操作只产生一条 `card_decision`；`pnpm check` 通过。

- [x] **R5-T11 沙箱 iframe 块渲染器**（原 M4-T17） | 依赖：R5-T05、M1-T05、M4-T06 | DESIGN §6
  完成：2026-11-08 `packages/protocol/src/turn.ts` 新增 `DisplayedContent` 与 `toDisplayedBlocks`（块只带 `display` 策略，没有注册表定义时为 null），`BlocksReplacePayload` 与 `TurnCompletedPayload.blocks` 都改成该载荷，流式快照、最终块与完成事件由 server 统一转换；`图片` 块默认显示改为 `html` 模板（`packages/core/src/blocks/templates.ts`，占位符 `{{content}}` 按文本转义）；web 新增 `components/chat/SandboxBlock.tsx`（`sandbox="allow-scripts"`、不设 `allow-same-origin`、srcdoc 带 `default-src 'none'` 的最小 CSP 与高度上报脚本）与 `chat/sandbox.ts`（只接受 `ready`、`height`、固定类型的 `action`，校验 `event.source` 与 `event.origin === "null"`，父页面只回发 `{type:"ack", action}`）；原生块继续用 React 组件，没有显示策略的块与未知原生组件按原文显示，图片在沙箱里点击放大；新增 8 个沙箱纯逻辑测试、1 个协议载荷测试与 server 断言；真实 server 加 Playwright 冒烟通过（父 DOM 与 cookie 均不可读、沙箱 origin 为 `null`、高度随图片变为 180px、非法消息不改变高度、模板图片不在主文档、390×844 放大正常且无横向溢出）；门禁通过（138 个测试文件、1220 个测试通过，3 个 live 跳过）
  做什么：
  - `packages/protocol/src/turn.ts` 的 `BlocksReplacePayload` 增加块类型的显示策略（`native` 组件名、`html` 模板或 `hidden`），服务端在 `blocks.replace` 里按块注册表填上；`TurnCompletedPayload` 的 `blocks` 同样带显示策略。`html` 模板只发给沙箱，不进入主文档。
  - web 新增沙箱渲染组件：`<iframe sandbox="allow-scripts">`，不添加 `allow-same-origin`；`srcdoc` 注入块 HTML 与最小 CSP。
  - postMessage 白名单：只接受 `ready`、`height`、`action`（`choice`、`scroll` 等固定类型）；校验 `event.source` 与 `event.origin === "null"`；父页面只回发固定字段。
  - 原生块继续用 React 组件；未知块显示原文；图片块在沙箱里渲染，点击可放大。
  验收：脚本无法读取父页面 DOM 与 cookie；高度自适应；非法消息被忽略；模板 HTML 不进入主文档；没有显示策略的块按原文显示；Playwright 用例覆盖隔离与高度；`pnpm check` 通过。

- [x] **R5-T03 server 渠道管理接口**（原 M4-T09） | 依赖：M4-T04、M1-T03、R1-T01.b
  完成：2026-11-08 `GET /api/channels` 返回渠道与 embedding 的脱敏视图（`apiKeyEnv` 与 `apiKeySet`，不含密钥）、模型（别名、模型 id、优先级顺序、`enabled`、最近体检结果）与四个岗位实际生效的 `roles`；`PUT /api/channels` 整份替换，逐字段校验环境变量引用、整数范围、渠道引用与重复引用、角色别名与启用状态，再用 `parseChannelsConfig` 与 `validateRoleModelFamilies` 复验，临时文件加 rename 原子写回；`POST /api/channels/probe` 用 `probeChannel` 体检并写回 `probe`；模型新增 `enabled`（默认 true，停用后不能作为故事模型、角色目标或路由目标），运行时缓存指纹包含 `roles`，写入后下一回合重建；新增 11 个 server 测试、4 个 core 配置测试与 1 个运行时测试，假通道覆盖体检；ADR-0078；门禁通过（139 个测试文件、1237 个测试通过，3 个 live 跳过）
  做什么：
  - `GET /api/channels`：别名、模型、优先级、启用状态、`${ENV}` 变量名与是否已设置、最近体检结果，以及 `roles`（writer、settler、planner、judge 各自的模型别名）；密钥值永远不出现在响应里。
  - `PUT /api/channels`：编辑别名、模型、优先级、启用状态、`roles` 与新增渠道；密钥字段只接受环境变量引用；`roles` 的每个值必须是已存在的模型别名，writer 与 judge 的模型家族相同时 400 并指出两个角色；校验后原子写回 `channels.yaml`（临时文件加 rename），运行时缓存失效。
  - `POST /api/channels/probe`：调用 `probeChannel`，只在用户点击时联网，结果写回配置。
  验收：脱敏响应里没有密钥；非法 YAML、重复别名、缺失环境变量与 `roles` 指向未知别名 400；writer 与 judge 同家族 400；写入后下一回合使用新配置；probe 用假提供方测试；真实渠道测试放 `*.live.test.ts`；`pnpm check` 通过。

- [x] **R5-T08 web 导演与 Trace 面板**（原 M4-T14） | 依赖：R5-T04、R5-T02、R4-T99
  完成：2026-11-08 新增 `packages/web/src/chat/director-view.ts`（导演决策与信号展开、计划增删改、Trace 视图模型）与 `chat/composer-draft.ts`；导演页复用楼层树选楼，并行读取 `GET director`/`actions`/`trace` 与故事级设置、计划、线索：透明模式显示指令、当前拍（`signals.beat` 与计划里的弧线/序列/目标）、强度、纠偏信号与机制触发状态，盲盒只显示机制，决策为空显示“本楼没有评估”；候选行动按 `ordinal` 分成 4 条行动与 1 条场景变化，点击写入跨面板草稿并转到聊天页，聊天页挂载时取出填入输入框（StrictMode 下只取一次），不自动发送；计划用结构化编辑器增删改弧线、序列与拍（id 自动递增），整份 `PUT` 并显示服务端字段路径；设置表单保存 `directorConfig.mode`、`intensity`、`openingIntensity` 与 `openingFloors`，保存后重取当前楼决策；兑现线索后刷新列表；Trace 展示回合模式、模型/渠道/用量、工具轮次与传输、上下文分段状态、`appendedTo`、预算裁剪与缺失槽位，历史块省略量按块类型逐条显示；新增 2 个测试文件共 15 个测试；真实 server 加 Playwright 390×844 冒烟通过（候选 5 条、透明决策、草稿填入、计划刷新仍在、线索兑现、盲盒隐藏指令与信号、无横向溢出）；门禁通过（141 个测试文件、1252 个测试通过，3 个 live 跳过）
  做什么：
  - 导演决策：`GET /api/nodes/:id/director` 返回 `{nodeId, mode, decision}`；透明模式显示当前拍、强度、纠偏信号与指令，盲盒模式只显示机制触发状态；决策为空时显示“本楼没有评估”。
  - 候选行动：`GET /api/nodes/:id/actions` 按楼层显示 4 条行动与 1 条场景变化，点击一条填入聊天输入框，不自动发送。
  - 计划：`GET` 与 `PUT /api/stories/:id/director/plan` 查看与编辑弧线、序列、节拍（整份替换，来源为 `player`，保存前显示服务端字段错误）。
  - 线索：`GET /api/stories/:id/clues` 列出未兑现线索，`POST /api/clues/:id/fulfill` 兑现后刷新列表。
  - 模式与强度：`PUT /api/stories/:id/settings` 的 `directorConfig.mode`（`off`、`transparent`、`blind`）、`intensity`、`openingIntensity` 与 `openingFloors`。
  - Trace：`GET /api/nodes/:id/trace` 的分段（来源、token、裁剪、缺失槽位、`appendedTo`）、工具轮次与传输、回合模式、渠道与用量；块的 prompt 视图省略量按块类型单独显示。
  验收：导演开关与模式切换后下一回合行为不同，盲盒下界面不显示指令与信号；编辑弧线后刷新仍在；兑现后列表更新；候选行动按楼层显示且点击只填输入框；Trace 与核心记录一致；省略量与块类型可见；纯逻辑单测覆盖展示模型；`pnpm check` 通过。

- [x] **R5-T09 web 故事设置与模板编辑器**（原 M4-T15） | 依赖：R5-T04、M4-T05、M4-T02 | DESIGN §9
  完成：2026-11-08 新增 `packages/web/src/chat/settings-form.ts`：`STORY_SETTINGS_UPDATE_KEYS` 全部字段的草稿与整份更新、与 core 一致的数值范围校验（含 `pace` 必须大于 0、`tensionEscalate < tensionClimax`、张力权重和大于 0、状态路径逐段非空）、历史块覆盖的块名/重复/深度校验、`details.path` 到中文表单名的映射；新增 `chat/template-form.ts`：段落草稿（静态/槽位/优先级/条件）、增删与上下移动、`block_format` 增删、五种条件草稿的递归转换与校验、组装顺序预览、与服务端同一套模板校验；core 的 `assertContextTemplate` 增加条件校验并导出 `assertContextCondition`、`createBlockFormatSegment`；server 新增 `GET /api/stories/:id/template`（故事实际使用的模板、来源与当前 `structuredOutput` 的 `block_format` 段）；`SettingsPage` 覆盖模型与生成、角色与视角、间隙后台、历史块策略、导演全部参数（含机制参数）与模板编辑，复制为新模板后自动设为故事默认，非法项列出字段路径；新增 2 个测试文件共 15 个测试；真实 server 加 Playwright 390×844 冒烟通过（设置保存后刷新仍在、越界温度字段错误、模板下移与保存、`block_format` 开关、空静态段与空开关名被拒绝、条件保存、复制为新模板并设为默认、历史覆盖与间隙开关、无横向溢出）；门禁通过（144 个测试文件、1275 个测试通过，3 个 live 跳过）
  做什么：
  - 故事设置覆盖 `STORY_SETTINGS_UPDATE_KEYS` 的全部字段：`model`、`budgetTokens`、`structuredOutput`、`temperature`、`maxTokens`、`reasoning`、`viewpoint`、`turnMode`、`maxReadRounds`、`directorConfig`（`mode`、`intensity`、`openingFloors`、`openingIntensity` 与既有机制参数）、`historyBlockPolicy`（`default`、`full` 与按块类型覆盖）、`gapPassEnabled` 与 `gapPlanSeconds`；保存前按核心的校验范围检查，服务端错误映射到字段。
  - 模板编辑器：段落列表（静态、槽位、条件）增删与上下移动、槽位选择、条件编辑；保存前由服务端 `assertContextTemplate` 校验；支持复制模板与设为故事默认；`block_format` 是可选段落，通过增删该段落开关，不设独立设置项。
  - ST 预设转换由兼容插件（C 线）提供，本任务不做，界面不放置未实现的导入入口。
  验收：模板增删移动后组装顺序与预览一致；非法条件、空静态段与 `protocol` 不在最后都被拒绝并显示字段错误；设置保存后下一回合生效；刷新后仍在；`block_format` 段落增删与 `structuredOutput` 的取值无关；纯逻辑单测覆盖编辑状态与校验映射；`pnpm check` 通过。

- [x] **R5-T10 web 渠道管理面板**（原 M4-T16） | 依赖：R5-T04、R5-T03、R1-T01.b
  完成：2026-11-08 新增 `packages/web/src/chat/channels-form.ts`：渠道、模型、嵌入提供方与四个岗位的草稿与整份更新，渠道 id/模型别名/嵌入 id 非空与唯一、服务地址与密钥变量名格式、全部数值范围、模型渠道优先级引用与去重、岗位别名存在与启用、writer 与 judge 同家族检查（与服务端同一张关键词表），密钥字段拒绝疑似密钥值，`describeChannelsPath` 把服务端字段路径翻成中文；`ChannelsView` 增加 `configuredRoles`，界面只把显式配置的岗位写回，未配置的岗位保持缺省回落；`ChannelsPage` 展示渠道、模型、优先级、启用、密钥变量是否设置与体检结果，支持渠道与模型的新增删除编辑、体检按钮与失败原因、未设置密钥的醒目提示，嵌入提供方只读并原样保留；`api` 增加 `getChannels`/`updateChannels`/`probeChannel`；server 的体检路由在通道创建或体检抛错时返回具体原因（`details.path` 为 `alias`）；新增 12 个表单测试、1 个 API 测试与 1 个 server 测试；真实 server 加 Playwright 390×844 冒烟通过（密钥提示、五项体检结果、体检失败原因、渠道修改与新增、模型新增、岗位保存与同家族错误、无横向溢出）；门禁通过（145 个测试文件、1289 个测试通过，3 个 live 跳过，共 1292 个）
  做什么：
  - 渠道列表（别名、模型、优先级、启用、密钥变量是否设置、体检结果）；编辑与新增；体检按钮显示流式、函数调用、思考、预填充、用量结果；密钥只显示变量名与是否设置。
  - 角色分工：显示 `roles` 的四个岗位（writer、settler、planner、judge）当前指向的模型别名，可以在这里改；保存前提示 writer 与 judge 必须来自不同模型家族。
  验收：界面不出现密钥值；保存后服务端配置更新；未设置的变量有醒目提示；体检失败显示错误；角色指向未知别名或 writer 与 judge 同家族时显示字段错误；纯逻辑单测覆盖表单校验；`pnpm check` 通过。

- [x] **R5-T12 Playwright 端到端**（原 M4-T18） | 依赖：R5-T01 至 R5-T11 以及 R5-T02.a、R5-T02.b、R5-T02.c、R5-T05.a、R5-T07.a 子任务
  完成：2026-11-08 新增 `packages/web/e2e/` 与 `playwright.config.ts`，根脚本 `pnpm e2e` 先构建 server 与 web，再由 `e2e/serve.mjs` 启动本地假 OpenAI 兼容渠道与 Dramaticer server（每次运行重建数据库与渠道配置）；假渠道按路径分流 writer 与 background 请求，返回思考、原生块、`state_update`、线索、事件、摘要、候选行动、开场候选与 `<tool>` 文本读取调用的固定 SSE；10 个用例在 390×844 与 1440×900 两种视口下各跑一次（20 个全部通过，1.2 分钟），覆盖密码登录、通过接口创建故事与导入合成卡、两轮对话、深回合锁定被拒与玩家切回快回合、选项 `choice` 偏好、重新生成 `swipe` 偏好、编辑与改写分支、head 切换、台账与故事级记忆、变更卡批准与拒绝、导演决策与候选行动、Trace 与计划编辑、线索兑现、模板复制编辑、渠道保存与密钥不显示、开场候选重新生成与选取、130 楼路径分页；失败截图与 trace 落在 `.devloop/scratch/e2e/artifacts`；修复分支页桌面端横向溢出（`branch-select` 与分支面板允许收缩）；`vitest.config.ts` 排除 `packages/web/e2e`；门禁通过（145 个测试文件、1289 个测试，3 个 live 跳过，共 1292 个）。
  做什么：
  - 安装 `@playwright/test` 与 Chromium；`packages/web/e2e/` 配置 `pnpm e2e`：先构建 server 与 web，再启动本地假 OpenAI 兼容渠道与 server；假渠道返回固定 SSE，覆盖思考、块、台账写入、线索、候选行动、开场候选与读取工具调用。
  - 用例覆盖：密码登录、创建故事、导入合成卡、两轮对话、模式开关、选项点击记录偏好、重新生成、swipe、编辑、分支切换、台账与记忆面板、变更卡批准与拒绝、导演与 Trace 面板、模板编辑、渠道编辑、开场候选选取与重新生成、路径分页；390×844 与桌面两种视口。
  - 默认不进入 `pnpm check`（浏览器体积），`pnpm e2e` 单独运行并写进文档。
  验收：`pnpm e2e` 全部通过；不访问外网、不使用私有数据；失败截图与 trace 写进 `.devloop/scratch/e2e/`（git 忽略）；`pnpm check` 通过。

- [x] **R5-T13 自动试玩框架**（原 M4-T19） | 依赖：R5-T12、R5-T01、R2-T02、R2-T07
  完成：2026-11-08 新增 `packages/web/e2e/playtest/`：`config.ts` 解析 `PLAYTEST_*`（轮数与五类排期，60 轮强制 swipe/edit/branch 各两次、分支切换必须在编辑之后），`runner.ts` 用 Playwright 驱动聊天发送、候选行动与选项点击（只填入不发送）、重新生成、编辑与分支切换，`session.ts` 读路径/树/Trace/台账/导演决策/候选行动/线索/后台任务与 SQLite 的 `preference_events`；模拟用户走 `roles.settler`（background）模型，严格 `{message}`，连续 3 次非法即终止并记录；`playtest.spec.ts` 默认跳过，`pnpm playtest` 由 `cli.mjs` 以 mobile 视口运行，`PLAYTEST_LIVE=1` 关闭假 server 并改指 `data/` 与 8787。记录类型、统计、报告与模拟用户放在 `packages/web/src/playtest/`，新增 7 个单元测试。假渠道 5 轮冒烟 14 秒通过：5 轮全部成功，swipe/edit/choice 各 1 次、分支切换 1 次，开场候选 3 条，候选行动显示并填入；私有报告含逐轮原文与截图，统计版覆盖 ADR-0033 §九全部字段且私有标识反向扫描 0 处；`pnpm e2e` 20 个用例通过（自动试玩用例跳过）；门禁通过（147 个测试文件、1296 个测试，3 个 live 跳过，共 1299 个）
  做什么：
  - `packages/web/e2e/playtest/`：用 Playwright 驱动真实界面；模拟用户由 `background` 模型生成，严格 JSON `{message}`，失败重试 3 次后终止并记录；60 轮内至少执行 2 次重新生成、2 次编辑、2 次分支切换，并按配置点击候选行动与选项块（只填入输入框，不发送），轮次位置可配置。
  - 每轮记录序号、节点 id、用户与助手原文、回合模式、首字毫秒、用量、台账 diff 数、新建与兑现线索、导演决策、候选行动与开场候选的显示结果、截图路径；报告头写模型别名、配置与样本数。
  - 私有报告写 `eval-private/reports/r5-playtest.md`；统计版写 `docs/dev/reports/R5-playtest.md`，字段按 ADR-0033 §九：轮数、对比胜率、矛盾率、相邻块 Jaccard 与节拍余弦、首字延迟、token、导演机制命中、新建与兑现线索、兑现率与平均年龄、错误数与复现步骤编号；另加 `swipe`、`choice`、`edit`、`card_decision` 四种偏好信号的条数。
  - 统计版不出现故事名、角色名、原文与题目文本；失败可整批重跑并注明。
  验收：假渠道下 5 轮冒烟跑通且不联网；私有报告含逐轮记录与截图路径；统计版字段齐全并通过私有标识反向扫描；四种偏好信号的条数来自 `preference_events`；`pnpm check` 通过。

**R5-T14 真实 60 轮试玩与报告**（原 M4-T20，已拆成 R5-T14.a 至 R5-T14.e） | 依赖：R5-T13 | 使用 `.env` 里的真实渠道

- [x] **R5-T14.a 真实 60 轮试玩（分会话续跑）** | 依赖：R5-T13
  完成：2026-11-09 监督进程分 6 次调用跑满 60/60 轮、0 条失败记录，两份报告已生成；排期六项操作在第 3–9 轮全部完成（swipe 2、edit 2、branch 2），偏好信号 swipe 2、choice 0、edit 2、card_decision 0，导演决策 60 次（beat 59、clue 16、opening 11），新建线索 3、兑现 0，首字 P50 4,639 毫秒、生成 P50 8,113 毫秒；正文 `main-fallback`、后台 `background`；后台队列饥饿缺陷（R5-T14.c）使候选行动、结算与拍推进的派生指标只能记为未证实。
  做什么：
  - 用专用渠道配置 `.devloop/scratch/R5-T14/channels.yaml`（`writer: main-fallback`、`settler/planner: background`；`rp` 仍返回 503，网关的 `auto/gemini-3.8-flash` 返回 400）与专用数据库 `.devloop/scratch/R5-T14/live.db` 跑满 60 轮，包含两次重新生成、两次编辑与两次分支切换。
  - 试玩由会话外的监督进程执行，会话不要直接运行 `pnpm playtest`。只有 `.devloop/scratch/R5-T14/supervisor.json` 不存在或状态为 `completed`/`failed` 时才启动：
    `powershell -NoProfile -Command '$p = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList "scripts/r5-playtest-supervisor.mjs","--config",".devloop/scratch/R5-T14/supervisor-config.json" -WorkingDirectory "E:\agentcoding\Dramaticer" -WindowStyle Hidden -PassThru; $p.Id'`
  - 监督进程读 `.devloop/scratch/R5-T14/supervisor-config.json`，负责启动 server、按每次调用 20 分钟的预算反复调用自动试玩，直到 60 轮。每轮写 `eval-private/reports/r5-playtest.progress.json`；跑满时自动写 `eval-private/reports/r5-playtest.md` 与 `docs/dev/reports/R5-playtest.md`。状态写 `supervisor.json`，日志写 `supervisor.log`（都在 `.devloop/scratch/R5-T14/`）。
  - 会话检查 `supervisor.json` 的 `state`；轮数以 `eval-private/reports/r5-playtest.progress.json` 的 round 记录数为准（`supervisor.json` 的 `rounds` 只在每次调用结束时刷新）。`running` → 把当前轮数写进 HANDOFF，提交，结果写 `PARTIAL`；`completed` → 核对续跑文件 60 条 round 记录与两份报告后标记完成；`failed` → 读 `supervisor.log` 修复后重新启动监督进程。不要在会话里再启动第二个 server 或第二个试玩。
  - 监督进程只在会话外运行；续跑文件记录的数据库、渠道、标题与排期必须与当前配置一致，不一致直接失败。
  验收：续跑文件有 60 条 round 记录、0 个失败；两份报告生成；统计版无私有信息；报告给出导演机制命中、线索兑现与四种偏好信号的数字。

- [x] **R5-T14.c 后台任务入队只看当前路径（修正任务饥饿）** | 依赖：R5-T14.a、R5-T01
  背景与证据（2026-11-09，对 `.devloop/scratch/R5-T14/live.db` 的只读查询）：`enqueueMissingBackgroundJobs`（`packages/core/src/store/story-store.ts:5077`）的 `confirmed`/`settled` 集合按 `SELECT id FROM nodes WHERE story_id = ?` 取整个故事的节点，没有按 head 路径过滤；已被 drain 丢弃（`status = 'discarded'`）的旧分支楼层任务因此每轮都会被 `ON CONFLICT (node_id, kind) DO UPDATE … WHERE background_jobs.status = 'discarded'` 翻回 `pending`。这些行创建时间最早，而 `listBackgroundJobs` 按 `created_at ASC, id ASC` 加 `limit` 取待办，drain 每轮先丢弃这 20 条旧分支行，当前路径上的任务永远轮不到。实测 5 个不在 head 路径上的楼层共 20 条任务每轮被丢弃，`discarded` 总数保持 20、当前故事的 `done` 停在 109（最后完成 08:39:20Z）、`pending` 每轮增加约 13 条、`pending` 行 `started_at` 全为空；另有一条 08:12:45Z 启动的 `candidate_actions` 行停在 `running`，服务端重启后永不重试（见 R5-T14.d）；`candidate_actions` 从第 2 轮起一直为 0，导演节拍停在 `beat-light-first`。
  做什么：
  - 楼层任务的入队候选只取当前 head 路径上的节点（`getPathToHead`），故事级任务不变。
  - 切回旧分支时该分支楼层重新进入路径，任务仍会被翻回 `pending` 并执行；放弃的分支任务保持 `discarded`，不再每轮复活。
  - 回归测试：两条分支交替，放弃一条后用 drain 推进当前路径上的任务；旧分支任务保持 `discarded`；切回后重新入队并执行；旧任务不占据队列头部。
  - 修复后按 R5-T14 的配置重跑 60 轮（先停掉已完成的监督进程，清空 `live.db` 与续跑文件），确认 `done` 随轮次增长、`candidate_actions` 与 `settle` 有完成记录、`pending` 不再持续增长。
  验收：回归测试覆盖上述四种情形；重跑 60 轮 0 条失败记录且后台 `done` 持续增长；两份报告重新生成；`pnpm check` 通过。
  完成：2026-11-09 入队侧只按 `getPathToHead` 过滤（5008df1），四个回归测试与门禁通过；监督进程 pid 45256 用专用库与渠道分 8 次调用跑满 60/60 轮、0 条 failure（第 6 次调用第 42 轮因模拟用户连续三次空输出以退出码 1 结束，续跑丢弃该记录并重试），续跑文件 60 条 round 记录；后台 `done=770`（`embeddings`/`events`/`npc_agenda`/`summary` 各 119、`settle`/`memory_revision`/`user_will` 各 63、`candidate_actions` 61、`scene` 41、`opening`/`opening_candidates`/`director_plan` 各 1），`pending=5`、`discarded=4`、`failed=19`（`scene` 17 条空输出、`candidate_actions` 2 条严格解析失败），`done` 从修复前 109、42 轮 549 增长到 770，`pending` 在 3–18 之间波动、结束时回落到 5；`director_candidate_actions` 305 行（61 个楼层各 5 条，当前路径 55 个）、`director_beat_states` 55 行、`ledger_settlements` 63 行；两份报告 12:30:23Z 重新生成，统计版 60 成功 / 0 失败、私有标识反向扫描通过（806 个标识）；监督进程停止 server 时一条 `settle`（12:30:16.957Z 启动）留在 `running`，由 R5-T14.d 的 `requeueRunningBackgroundJobs` 在下次启动恢复；门禁通过（148 个测试文件、1310 个测试，3 个 live 跳过）。`scene` 空输出的修复见 R5-T14.e。

- [x] **R5-T14.d 服务端重启后恢复遗留 running 任务** | 依赖：R5-T14.a、R5-T01
  完成：2026-11-09 存储层新增 `requeueRunningBackgroundJobs(storyId?)`（running 退回 pending、清空 `started_at` 与 `finished_at`、`attempts` 减一且不低于 0、保留 `last_error`，其它状态不动）；`startServer` 在打开数据库之后、创建调度器之前调用一次（全部故事），`dramaticer work` 在循环开始前调用一次；新增 4 个回归测试（状态与故事作用域、drain 重新执行且执行次数不重复累计、server 重启恢复遗留 running 行、work CLI 恢复后执行）；门禁通过（148 个测试文件、1310 个测试，3 个 live 跳过）
  背景与证据（2026-11-09 09:19Z，对 `.devloop/scratch/R5-T14/live.db` 的只读查询）：监督进程在 08:12:59Z 重新启动 server，当前故事留下一条 `candidate_actions` 任务（`node_id` `1bb4dde0-8327-4410-a073-1af30c25e6b9`，`started_at` 08:12:45.729Z）永久停在 `running`。`drainBackgroundJobs`（`packages/core/src/background/drain.ts`）只取 `status = 'pending'` 的行，`startBackgroundJob` 只接受 `pending`，所以进程在执行中途退出后这些行既不会重试，也不计入待办。
  做什么：
  - 存储层新增恢复方法 `requeueRunningBackgroundJobs(storyId?)`：把 running 行退回 pending，清空 `started_at`、`attempts` 减一（不低于 0），保留 `last_error`；`done`、`failed`、`discarded` 不动。
  - server 在启动、第一次 drain 之前对数据库里的全部故事调用一次；`dramaticer work` 在循环开始前对目标故事调用一次。
  - 回归测试：插入 running 行模拟进程中断，恢复后 drain 能执行它且 `attempts` 不重复累计；其它状态的行保持不变。
  验收：模拟重启后遗留 running 行被重新执行；恢复后 `attempts` 语义与 `deferBackgroundJob` 一致；`done`、`failed`、`discarded` 行不受影响；`pnpm check` 通过。

- [x] **R5-T14.b 试玩报告核对与文档** | 依赖：R5-T14.a、R5-T14.c
  做什么：核对统计版字段与 ADR-0033 口径，没有信号的指标保持「未证实」，不改口径；在 `docs/dev/reports/R5.md` 引用统计版并写明模型别名、轮数与操作次数；重跑 `pnpm check`。
  验收：统计版字段齐全并通过私有标识反向扫描；`docs/dev/reports/R5.md` 的引用与数字和统计版一致；`pnpm check` 通过。
  完成：2026-11-09 统计版 60 成功 / 0 失败，字段按 ADR-0033 §九逐项核对（对比胜率、矛盾率、节拍余弦保持未证实），独立反向扫描 806 个标识 0 处命中；`docs/dev/reports/R5.md` 记录正文 `main-fallback`、后台 `background`、60 轮与实际操作 swipe 2 / edit 2 / branch 2，候选行动 61 个楼层各 5 条（当前路径 55 个），`scene` 17 条空输出与 `candidate_actions` 2 条严格解析失败单列；门禁通过（148 个测试文件、1310 个测试，3 个 live 跳过）

- [x] **R5-T14.e 现场分析的输出预算与思考 token** | 依赖：R5-T14.c
  背景与证据（2026-11-09，对 `.devloop/scratch/R5-T14/live.db` 的只读查询）：R5-T14.c 重跑到第 12 轮时 17 条 `scene` 任务中 8 条完成、4 条随放弃楼层丢弃、4 条重试三次后 `failed`、1 条待执行，`last_error` 全是「现场分析返回了空内容」。`createSceneHandler` 把 `DEFAULT_SCENE_MAX_TOKENS = 200` 直接作为请求的 `maxTokens`（`packages/core/src/memory/scene.ts:108`）；`background` 模型的思考 token 与正文共用输出上限，思考耗尽 200 后正文为空，当前路径上约三分之一的楼层因此没有现场分析。R1-T07.b.d.b 已确认该网关无法关闭思考，后台模型的声明上限是 32,768。
  做什么：
  - 现场分析请求不再用 200 token 同时充当思考与正文的预算：不显式传 `maxTokens`，让请求使用模型声明的输出上限；正文长度仍由系统提示词的「两百字以内」约束，存储时用 token 估算器记录长度。
  - 假客户端回归测试断言 `scene` 请求不带 `maxTokens`（走模型声明上限），且空正文仍然抛错并按任务重试，三次后 `failed` 并保留原因。
  验收：假客户端下 `scene` 请求使用模型声明上限；空正文仍按失败重试，三次后 `failed`；12 轮重跑里出现过的空输出不再发生（用固定假客户端与一次真实渠道各验证一次请求参数）；`pnpm check` 通过。
  完成：2026-11-09 `scene` 请求不再传 `maxTokens`，删除 `DEFAULT_SCENE_MAX_TOKENS` 与 `SceneHandlerOptions.maxTokens`，正文长度由系统提示词与 token 估算器约束；回归测试断言请求不带 `maxTokens`，新增空正文三次重试后 `failed` 并保留原因的用例；真实渠道一次请求 completion 255 token（思考 131）返回 188 字正文、`finishReason` 为 `stop`，旧上限会在思考写满后截断正文；ADR-0079；门禁通过（148 个测试文件、1311 个测试，3 个 live 跳过）

- [x] **R5-T99 R5 验收** | 依赖：R5 全部任务（含 R5-T02.a、R5-T02.b、R5-T02.c、R5-T05.a、R5-T07.a、R5-T14.a、R5-T14.b、R5-T14.c、R5-T14.e）
  完成：2026-11-09 门禁通过（148 个测试文件、1313 个测试，4 个 live 跳过）；`pnpm e2e` 通过（20 个用例、2 个 playtest 用例跳过）；60 轮重跑续跑文件 60 条 round 记录、0 条 failure（第 9、28、44、52（两次）、54 轮模拟用户空输出或输出形状非法各产生一条失败记录，监督进程丢弃后重试；连续 4 次调用失败后于 14:38:22Z 停在 53/60 轮，14:39:48Z 用同一续跑文件重启并跑满）；统计版 60 成功 / 0 失败；数据库有 60 个用户楼层、64 个助手楼层（4 个是分支楼层），`background_jobs` 为 `done=786`、`pending=5`、`running=1`、`discarded=2`、`failed=5`（`candidate_actions` 完成 56、失败 5、丢弃 2、待执行 1，`scene` 完成 63、失败 0、待执行 1，`settle` 完成 63、待执行 1，`embeddings` 完成 118、运行中 1，`events`、`npc_agenda`、`summary` 各完成 119，`memory_revision` 与 `user_will` 各完成 63、待执行 1，`director_plan`、`opening`、`opening_candidates` 各完成 1）；`director_candidate_actions` 280 行（56 个楼层，当前路径 52 个）、`director_beat_states` 51 行、`ledger_settlements` 63 行、`preference_events` 为 `swipe` 2 与 `edit` 2；`docs/dev/reports/R5.md` 已回填第一至三节并完成逐条核对与 I6、I9、I11–I14 复核
  做什么：同 M0-T99；重跑 `pnpm check`、`pnpm e2e` 与 60 轮试玩报告；逐条核对 R5-T01 至 R5-T14 与全部子任务；复核 I6（模式只由玩家切换）、I9（导演实时选择零模型调用）、I11–I14，以及 server 不绕过 core 直接写库；检查默认回环监听与局域网密码；在 `docs/dev/reports/R5.md` 总结；确认 M6、R1 续与 R3b 任务。
  结果写 `MILESTONE_DONE`；报告缺失时写 `PARTIAL`。

## M6：生图第一批（ComfyUI 优先）

> v3 路线（ADR-0044）：第一批排在最小界面之后，R1 续之前完成。DESIGN §12 定义流程，ADR-0082 记录配置、存储与队列的决定。导演规则触发出图不在第一批；第一批跑过真实数据后另立任务。

- [x] **M6-T00 细化 M6 任务** | 依赖：R5-T99 | DESIGN §12
  完成：2026-11-09 把第一批分成 M6-T01 至 M6-T05 与 M6-T99（生图配置与 ComfyUI workflow 导入、视觉档案与提示词编译、`illustrate` 工具与异步队列、楼层图片显示与媒体接口、生图设置与 workflow 管理界面），第二批分成 M6b-T01 至 M6b-T03 与 M6b-T99 并排在 R6 之后；迁移 v34 预留给 `image_workflows`、`character_visual_profiles`、`node_images` 与 `story_settings.image_config`，R1 续的迁移编号顺延为 v35–v38；新增 ADR-0082、DESIGN §12 补充与 HUMAN-15（ComfyUI 启动与 workflow 文件）；门禁通过（148 个测试文件、1313 个测试通过，4 个 live 跳过）
  做什么：把第一批（ComfyUI API 格式 workflow 导入与插槽识别、`illustrate` 工具、图片块显示、角色视觉档案初版、异步任务队列与结果附加到楼层）与第二批（NovelAI、Grok、OpenAI 兼容图像接口）分成任务，写清依赖与验收；第一批在 R1 续之前完成。
  验收：第一批任务可直接执行；第二批排在 R6 之后；`pnpm check` 通过。

- [x] **M6-T01 生图配置、ComfyUI workflow 导入与插槽识别** | 依赖：R5-T99 | DESIGN §12 | ADR-0082
  完成：2026-11-09 新增 `core/src/images`（`images.yaml` 解析与共享 `${VAR}` 解析、ComfyUI workflow 校验与插槽识别、ComfyUI 客户端、导入辅助与 CLI）；迁移 v34 新建 `image_workflows`、`character_visual_profiles`、`node_images` 并给 `story_settings` 增加 `image_config`；`StoryStore` 增加 workflow 增删改查与引用计数；server 增加 provider/workflow 的 detect、import、list 与删除接口及 `--images` 启动参数；同名导入更新同一行，被引用删除返回 409；门禁通过（154 个测试文件、1351 个测试通过、4 个 live 跳过）
  做什么：
  - 新增 `packages/core/src/images/`。`config.ts` 解析 `data/images.yaml`（示例 `images.example.yaml`）：根 `providers`，第一版只接受 `api: comfyui`；字段 `baseUrl`、`apiKey`（空字符串或 `${VAR}` 引用）、`timeoutMs`（默认 300000）、`pollIntervalMs`（默认 1000）。文件不存在时返回空配置，生图功能关闭；未知 api、未知字段、非法 URL、非正数超时都抛出错误并指出字段路径。`${VAR}` 的解析复用渠道配置的同一套函数（提取成共享函数，不复制第二份规则）。
  - 迁移 v34：新建 `image_workflows(id, name, provider, payload, slots, created_at, updated_at, UNIQUE(name))`、`character_visual_profiles(story_id, character, profile, source, created_at, updated_at, PRIMARY KEY(story_id, character))`、`node_images(id, story_id, node_id, ordinal, status, request, prompt, negative_prompt, workflow_id, seed, attempts, file_name, media_type, width, height, error, created_at, updated_at, UNIQUE(node_id, ordinal))`；`node_images` 的 story 与楼层一致由触发器拒绝；`status` 取 `pending`、`running`、`done`、`failed`；`story_settings` 增加可空的 `image_config` 列。R1 续的迁移编号从 v34–v37 顺延为 v35–v38，同步本文件里 R1 续的任务文字。
  - `images/slots.ts`：`parseComfyUiWorkflow(value)` 校验 API 格式（每个节点有字符串 `class_type` 与对象 `inputs`）；`detectComfyUiSlots(workflow)` 跟随采样器的 `positive`、`negative` 与 `latent_image` 链接识别正向提示词、负向提示词、seed、width、height，返回 `{slots, candidates, unresolved}`；只有唯一候选时才自动采用，出现多个候选或找不到正向提示词与 seed 时返回候选并拒绝保存，要求显式插槽。`assertComfyUiSlots` 校验节点、输入存在与类型匹配。
  - `images/comfyui.ts`：`createComfyUiClient(provider, { fetch })` 按插槽改写 workflow 的 `inputs`，`POST /prompt`，按 `pollIntervalMs` 轮询 `GET /history/<prompt_id>`，从 outputs 取第一张图，`GET /view?...` 下载；总超时、非 2xx、历史里的 `error` 与空输出都抛出错误并带 prompt id。重试由后台任务负责，客户端不重试。
  - 存储层提供 workflow 的增删改查；`StoryStore` 导出接口。CLI `dramaticer images workflow import --file <路径> --name <名称> [--db] [--images] [--slots <json>]`、`list`、`show <id>`、`delete <id>`；导入时打印识别结果，有候选时必须给 `--slots`，不自动猜测。
  - server 新增 `GET /api/images/providers`（只返回 provider id 与是否配置，不含密钥）、`GET /api/images/workflows`、`POST /api/images/workflows/detect`（请求体 `{workflow}`，只返回 `{slots, candidates, unresolved}`，不写入）、`POST /api/images/workflows/import`（请求体 `{name, workflow, slots}`，插槽未解析或指向不存在的节点时返回 400，`details.path` 为 `slots`）、`DELETE /api/images/workflows/:id`（被 `node_images` 引用时返回 409）；server 启动参数增加 `--images <路径>`（默认 `data/images.yaml`），缺失文件时接口返回空列表。
  验收：合法 workflow 自动识别正向、负向、seed、width、height；负向与尺寸缺失时仍可保存；多采样器、找不到 seed、节点或输入不存在、输入类型不符各抛出错误并指出字段路径；同名导入更新同一行，未知 provider 拒绝；`detect` 只返回候选、不写库，`import` 在没有解析插槽时拒绝；删除被引用的 workflow 返回 409；`images.yaml` 缺失时生图功能关闭，未知字段与非法 `${VAR}` 抛出错误；迁移后三张表存在，跨故事的 `node_images` 写入被触发器拒绝；假 fetch 下 ComfyUI 客户端的提交、轮询、下载、超时与错误历史各有用例且零网络；`pnpm check` 通过。

- [x] **M6-T02 角色视觉档案与提示词编译** | 依赖：M6-T01、O-T01.a | DESIGN §12 | ADR-0082
  完成：2026-11-09 补上视觉档案的字段、响应、任务、提示词与入口测试（`visual-profiles.test.ts` 14 个、`image-prompt.test.ts` 8 个、`images-cli.test.ts` 新增 1 个、server 路由 2 个）；重复人物比较改用 `normalizeEntityName`，忽略大小写与标点；导入卡路由断言入队 `visual_profile`；门禁通过（156 个测试文件、1375 个测试）
  做什么：
  - `images/profiles.ts`：`CharacterVisualProfile` 含 `character`、`base`（基础外貌标签）、`defaultOutfit`、`outfitPath`（台账路径，可空）、`negative`、`seed`（可空）与 `backends`（第一版为空对象）；`validateVisualProfilePayload(value, knownNames)` 拒绝未知字段、空字符串、重复人物、空路径段、负 seed 与不在角色卡或实体里的人物；`parseVisualProfilesResponse(text, knownNames)` 要求 `{profiles:[...]}` 有 1 到 8 条。
  - 后台任务 `visual_profile`（`VISUAL_PROFILE_JOB_KIND`）：`enqueue: story`、`tier: gap`，`needsRun` 为故事有角色卡或常驻世界书且档案表为空。输入是角色卡提示词、常驻世界书与已知人物名；模型输出按上面的严格 JSON 校验，整包拒绝；写入 `character_visual_profiles`，来源 `model`，同一人物重复执行覆盖、不新增行。导入卡后由创建与导入路由入队，和开局任务共用同一处调度。
  - `images/prompt.ts`：纯函数 `compileImagePrompt({ profiles, state, request, style })`。`style: "tags"` 按基础外貌、当前服装、场景、镜头、气氛拼接去重后的逗号标签；当前服装从 `outfitPath` 读状态，读不到时用 `defaultOutfit`；负向合并角色负向标签与固定的默认负向常量。`style: "natural"` 用自然语言拼接，供第二批复用。没有档案的人物进入场景文本并记入返回的 `missingProfiles`，不报错。同一个输入重复编译逐字节相同，不读数据库、不调用模型。
  - CLI `dramaticer images profiles --story <id> --db <路径> [--json] [--generate]`：列出档案；`--generate` 同步执行一次视觉档案任务，与后台任务共用处理器与校验。
  - server 新增 `GET /api/stories/:id/visual-profiles`（只读，返回档案、来源与更新时间）；注册表注册 `visual_profile`，`dramaticer work` 与 server 的调度器自动带上。
  验收：假客户端生成一包并入库；重复执行只覆盖不新增；非法人物名、空字符串、重复人物、未知字段、越界 seed 与空路径段各抛出错误并指出路径；没有卡与常驻世界书时不入队也不调用；两种提示词风格的固定断言通过，服装来自台账、缺档案的人物列进 `missingProfiles`；回合内后台客户端零调用；`pnpm check` 通过。

- [x] **M6-T03 `illustrate` 工具与异步出图队列** | 依赖：M6-T01、M6-T02、R1-T02.2、R3-T01、R5-T01 | DESIGN §11、§12 | ADR-0082 | I11
  完成：2026-11-09 `imageConfig` 进入故事设置（`mode`、`workflowId`、`maxPerFloor`、`minFloorsBetween`，旧记录按默认值补齐）；`images/request.ts` 统一校验 `illustrate` 参数；`images/tool.ts` 只在 `auto`、workflow 存在且 provider 已配置时提供工具，回合事务内校验频率并写 `node_images` 的 `pending` 行，拒绝原因进入 Trace 的 `images.rejected` 与 `tools.calls`；`runModelTurns` 新增 `sideEffectTools`（两种传输共用，文本协议回“已登记”）；`images/queue.ts` 每次处理 2 行、单行失败 3 次标记 `failed`，失败行不影响其它行，旧分支不处理；`images/client.ts` 抽象 provider 客户端，`images/media.ts` 读取 PNG/GIF/WebP/JPEG 宽高；`dramaticer images generate|list`、`POST /api/nodes/:id/images`、`POST /api/images/:id/retry`；server 与 `dramaticer work` 注册任务、传入 `--media-dir` 与 `images.yaml`，启动时 `requeueRunningNodeImages`
  做什么：
  - 故事设置新增 `imageConfig`（存 `story_settings.image_config`）：`mode` 取 `off`、`manual`、`auto`（默认 `off`），`workflowId`（默认空），`maxPerFloor`（1 到 4，默认 1），`minFloorsBetween`（0 到 100，默认 3）；`assertStorySettingsUpdate` 校验，`STORY_SETTINGS_UPDATE_KEYS` 收录，旧记录按默认值补齐。
  - `images/tool.ts` 定义 `illustrate` 工具：参数 `{ characters?: string[], scene: string, shot?: "close-up"|"medium"|"wide"|"scenery", mood?: string }`，只允许这些键，`scene` 1 到 500 字，人物最多 4 个、名字非空；描述写明每楼上限、最小间隔与“只登记，后台生成”。只有 `mode` 为 `auto`、`workflowId` 指向存在的 workflow、workflow 的 provider 已配置时才把工具发给模型；`manual` 与 `off` 不发。
  - `runModelTurns` 新增侧效应工具入口：工具定义参与两种传输，但不进入读取工具集合，不执行，参数随 `toolCalls` 返回；文本协议对已知侧效应工具返回“已登记”，未知工具仍然拒绝。Trace 的 `tools.calls` 记录 `illustrate` 的接受与拒绝原因。
  - `generateAssistantTurn` 在写入助手楼层的同一个事务里处理 `illustrate` 调用：校验参数、按当前路径统计本楼与最近一次出图之间的助手楼层、应用 `maxPerFloor` 与 `minFloorsBetween`、写入 `node_images` 的 `pending` 行（`request` 存工具参数、`seed` 在此时生成、`workflow_id` 存当前 workflow）。被拒绝的调用不写行，原因写进 Trace 的 `images.rejected`；`node_images` 不修改楼层原文。
  - 后台任务 `illustrate`（`ILLUSTRATE_JOB_KIND`）：`enqueue: story`、`tier: gap`、`needsRun` 为当前 head 路径上存在 `attempts < 3` 的 `pending` 行。处理器每次按创建顺序最多处理 `IMAGE_BATCH`（默认 2）行：读 workflow、provider 与楼层台账快照，用 `compileImagePrompt` 生成提示词，标 `running`，调用 provider，把文件写到 `<mediaDir>/<storyId>/<imageId>.<扩展名>`，读 PNG/GIF/WebP/JPEG 头得到宽高，写回 `done` 与文件元数据；失败时把该行 `attempts` 加一并保留原因，第三次失败标 `failed`，其余行继续。已完成的行不重复调用；不在当前路径上的行不处理。
  - `dramaticer work` 与 server 注册处理器并传入 `mediaDir`（数据库文件同目录的 `images/`，可用 `--media-dir` 覆盖）与 `images.yaml`；没有 provider 或 workflow 时任务失败并保留原因，配置补上后按 `pending` 行继续。server 与 `dramaticer work` 启动时调用一次 `requeueRunningNodeImages`，把执行中途留下的 `running` 行退回 `pending`。
  - 新增手动入口 `POST /api/nodes/:id/images`（当前路径上的助手楼层，`mode` 不是 `off`，workflow 已选）与 `POST /api/images/:id/retry`（`failed` 回到 `pending` 并清零 `attempts`），两者只入队，不调用图像后端；手动请求不受频率限制。CLI `dramaticer images generate --node <id> --scene <文本> [--characters a,b] [--db] [--images]`、`dramaticer images list --node <id>`。
  - `ImageProviderClient` 抽象放在 `images/client.ts`，第一版只有 ComfyUI 实现；第二批按 provider 增加实现。
  验收：工具只在配置完整且 `auto` 时出现；合法调用在楼层写入后产生 `pending` 行，参数非法、超过每楼上限、间隔不足、`mode` 为 `off` 或 `manual` 时被拒绝并写入 Trace，楼层照常保存；手动入口在 `manual` 与 `auto` 下可用、`off` 返回 409，`retry` 只接受 `failed` 行；假 provider 下两行依次完成、文件与宽高写入、已完成行不重复调用；provider 连续失败三次后该行 `failed` 并保留原因，其它行继续；模拟重启后遗留 `running` 行被重新执行；旧分支的 `pending` 行不被处理，切回后继续；出图不改楼层原文，图片行只出现在所属楼层；回合内图像后端零调用；`pnpm check` 通过。

- [x] **M6-T04 楼层图片显示与媒体接口** | 依赖：M6-T03、R5-T05.b、R5-T02 | DESIGN §6、§12 | ADR-0082
  完成：2026-11-09 protocol 新增 `NodeImage`、`NodeImagesView` 与 `StoryPathNode`；path 与 `GET /api/nodes/:id/images` 返回按 `ordinal` 排序的图片，`url` 只在 `done` 时出现，整页图片一次查询；新增 `GET /api/images/:id/file`（只读 `done`、四种图片媒体类型、真实路径确认仍在 `mediaDir`、未完成/失败/缺失/越界一律 404、需要登录）；聊天页新增图片区（缩略图放大、占位、失败原因与重试）、`chat/node-images.ts` 纯逻辑与 2 秒 15 次轮询；`ImageZoom` 由图片块与楼层图片共用；390×844 冒烟无横向溢出
  做什么：
  - protocol：新增 `NodeImage`（`id`、`nodeId`、`ordinal`、`status`、`url`、`width`、`height`、`error`）与 `NodeImagesView`；`StoryPath` 的节点改为 `StoryPathNode`（`TimelineNode` 加 `images`），path 接口按返回的节点 id 一次查询图片并按 `ordinal` 排序，避免逐楼查询；`GET /api/nodes/:id/images` 返回同一结构，供轮询。
  - server 新增 `GET /api/images/:id/file`：只读 `done` 行，从 `mediaDir` 解析文件名并确认仍在目录内，按 `media_type` 返回；未完成、失败、不存在与越界路径都返回 404，不返回文件系统路径。
  - web：聊天页楼层正文后显示图片区；`done` 显示缩略图，点击放大（复用现有图片放大样式），`pending` 与 `running` 显示“正在生成插图……”，`failed` 显示原因与“重试”按钮（调用 retry 接口）。楼层图片不进入块渲染器，不修改块原文；`图片` 块继续按现有沙箱模板显示。
  - 轮询：回合完成后如果最新楼层有未完成图片，按 2 秒间隔最多 15 次调用 `GET /api/nodes/:id/images`，把结果并入路径状态；离开页面或切换故事时停止。新增 `chat/node-images.ts` 纯逻辑（状态合并、是否需要轮询、失败重试）与测试。
  验收：path 返回的每个楼层带按 `ordinal` 排序的图片，`url` 只在 `done` 时出现，图片查询次数与楼层数无关；媒体接口需要登录，未完成与越界路径不返回文件；聊天页在假 provider 下从占位变为图片，失败显示原因且重试后重新出现占位；放大与移动端布局正常，390×844 无横向溢出；图片不出现在楼层原文与 `parseBlocks` 结果里；纯逻辑测试覆盖合并与轮询停止；`pnpm check` 通过。

- [x] **M6-T05 生图设置与 workflow 管理界面** | 依赖：M6-T01、M6-T03、M6-T04、R5-T09 | DESIGN §12 | ADR-0082
  完成：2026-11-09 新增“生图”面板（provider 状态、workflow 文件导入与插槽确认、删除、视觉档案查看与重新生成）与 `POST /api/stories/:id/visual-profiles/generate`；设置页接入 `imageConfig`；`chat/image-form.ts` 纯逻辑与 10 个测试、server 1 个用例；390×844 生图页与设置页冒烟通过；门禁通过（159 个测试文件、1409 个测试、4 个 live 跳过）
  做什么：
  - 故事页新增“生图”面板（路由与导航与现有六个面板并列）：上半是 provider 状态（ComfyUI 是否配置、地址只读显示）与 workflow 列表；导入入口读取本地 JSON 文件，先调用 `POST /api/images/workflows/detect` 显示自动识别的插槽与候选，用户用下拉框确认正向提示词、负向提示词、seed、width、height 后调用 `import` 保存；删除只允许没有被 `node_images` 引用的 workflow，409 时显示原因；界面不显示密钥值。
  - 同一面板显示角色视觉档案（人物、基础外貌、默认服装、来源）与“重新生成”按钮（新增 `POST /api/stories/:id/visual-profiles/generate`，只入队，不阻塞请求）；档案只在没有记录时自动生成，手动按钮覆盖。
  - 故事设置表单增加生图配置：`mode`（关闭、手动、自动）、workflow 下拉、`maxPerFloor`（1–4）、`minFloorsBetween`（0–100）；保存前按 core 同一套范围校验，服务端错误路径翻成中文；`mode` 不是关闭而 workflow 为空时显示字段错误。设置写入 `PUT /api/stories/:id/settings`。
  - 纯逻辑放在 `packages/web/src/chat/image-form.ts`：workflow 草稿、插槽校验、设置草稿与范围校验、服务端字段路径映射；测试覆盖。
  验收：导入合法 workflow 后识别结果可见，候选插槽必须确认才能保存，保存后刷新仍在；删除被引用的 workflow 返回 409 并显示原因；生图设置保存后下一回合的工具可见性与频率生效；关闭模式后工具不再出现；视觉档案可查看与重新生成；界面不出现密钥；纯逻辑测试覆盖表单与插槽校验；`pnpm check` 通过。

- [!] **M6-T99 M6 第一批验收** | 依赖：M6-T01、M6-T02、M6-T03、M6-T04、M6-T05 | HUMAN-15（真实 ComfyUI 与 API workflow JSON；2026-11-09 端口 8188 仍未监听）
  做什么：用真实 ComfyUI 跑通一张卡的开场图与一次剧情图，结果附加到楼层节点；核对失败重试、频率设置与图片块显示；写 `docs/dev/reports/M6.md`。
  验收：真实 ComfyUI 下工具调用登记后生成图片并附加到正确楼层，记录实际耗时；图片不进入楼层原文；失败重试与手动重试可用；频率设置改变后超出的调用被拒绝并写入 Trace；聊天页与生图面板可用；统计版报告不含密钥与私有原文；`pnpm check` 与 `pnpm e2e` 通过。
  结果写 `MILESTONE_DONE`。

## R1 续：记忆增强（由长对话评测与工程证据决定）

> v3 路线（ADR-0044）：全部任务保留，排在最小界面与 60 轮自动试玩之后。R2-T09 的长对话遗忘报告与 R5-T14 的试玩报告决定四项的先后与默认开关；任何一项都不删除。

- [x] **R1-T03.a 父子分块** | 依赖：M2-T08、M2-T10、R5-T99 | DESIGN §7.3 | ADR-0044
  完成：2026-11-09 迁移 v35 给 `chunks` 增加 `parent_ordinal` 与 `parent_text`，清空旧块、全文索引与块向量并把 `embeddings` 任务退回待执行；`chunkTextByParent` 按段落边界合并父段（上限 1200 个码点），单个段落超限时整楼退化成一个父段，小块沿用 400/80；`StoryStore.open` 新增 `chunkStrategy`，默认 `parent-child`，`fixed` 与旧分块逐条一致；`searchChunks` 按楼层与父段排名并返回父段，`searchVectors` 关联块表返回父段；融合按楼层去重时保留第一条父段文本，记忆槽位与 `memory_search` 注入父段，Trace 的 `injected` 记录父段或整楼；R2-T09 的 legacy native 同题矛盾率从 66.7%（6/9）升到 100.0%（7/7），默认开启（ADR-0083）；新增 10 个测试
  做什么：
  - 迁移 v35 给 `chunks` 增加父段字段（`parent_ordinal`、`parent_text`）：父段按段落边界切分，过长的段落退化为整楼；检索只匹配小块，命中后返回父段文本。
  - 打开数据库时按新规则重建块，旧块与对应向量一并删除；`embeddings` 任务随后补齐缺失向量。回填可重复执行，不产生重复块。
  - `searchChunks` 与 `searchVectors` 返回父段文本；多路融合按楼层去重时保留父段文本，Trace 记录注入的是整段还是整楼。先读 R2-T09 与 R5-T14 的报告，决定是否默认开启。
  验收：小块命中后返回父段；同一父段多个小块只占一个结果位次；回填重复运行后块数不变；旧向量被清理且不参与查询；开关关闭时与现状逐条一致；`pnpm check` 通过。

- [x] **R1-T03.b 重排序** | 依赖：R1-T03.a、M2-T10 | DESIGN §7.3 | ADR-0044
  完成：2026-11-09 新增 `OpenAiRerankClient`（OpenAI 兼容 `POST /rerank`，按 `batchSize` 分批、限速、429/5xx 重试、超时与 `index`/分数校验）；`channels.yaml` 新增 `reranker` 段（`enabled` 默认 false，`batchSize` 32、`requestsPerMinute` 30、`timeoutMs` 30000），`createRerankClient` 在未配置或关闭时返回 null；`retrieveMemory` 融合后取前 `rerankCandidates`（默认 20，1–200）交给重排序，按分数降序、同分保持融合顺序，再取最终 top-K；重排序文档为事件正文、父段文本或旧分块楼层原文；`memory_search` 与记忆槽位共用该入口；server 运行时与 `dramaticer chat` 传入客户端；`channels.example.yaml` 补示例；新增 13 个测试；门禁通过（160 个测试文件、1432 个测试、4 个 live 跳过）
  做什么：
  - 新增 `RerankClient`（OpenAI 兼容 `POST /rerank`，批量、限速、重试），渠道写在 `data/channels.yaml` 的 `reranker` 段（硅基流动 bge-reranker），密钥只从 `.env` 读取；`channels.example.yaml` 补示例。
  - `retrieveMemory` 融合后取前 `rerankCandidates`（默认 20）交给重排序，再取最终 top-K；`memory_search` 与 M2-T12 的槽位共用同一入口。
  - 开关默认关闭；用 R1-T04.b 的记忆评测决定，事件题与状态题都没有下降且有提升才在默认配置打开，结论写 ADR。
  验收：假重排序客户端下候选顺序按分数重排；开关关闭时与现在的融合顺序逐条一致；没有配置 `reranker` 时开关保持关闭且不发起请求；单元测试零网络；`pnpm check` 通过。

- [x] **R1-T04.b 三对话事件表回填与记忆评测重跑** | 依赖：R1-T04.a、R1-T03.a、R1-T03.b、M2-T15 | ADR-0044
  完成：2026-11-12 三个对话的事件表覆盖率 282/290、174/180、112/114；`memory-eval --events --rerank` 完成 386 道题；新默认权重 2/1/0.5/0.5/1 下融合事件题 133/141/146、状态题 20/30/35，均高于全 1 时的 122/135/141 与 18/29/29；`data/channels.yaml` 的 `reranker.enabled` 保持 false（事件题@5/@10 从 122/135 升到 132/140，状态题@5/@10 从 18/29 降到 13/27）；两份报告已重新生成，ADR-0084。
  做什么：
  - 对 3 个 legacy 评测对话运行 `events-backfill`，按窗口数量与实测速率安排运行，记录耗时与请求数；事件覆盖率按对话报告。
  - 重跑 `memory-eval`，分别给出 BM25、向量、实体、事件、融合五路的事件题命中@5、@10、@20 与分对话结果。
  - 权重调整采用留一对话交叉验证：在 2 个对话上从固定候选集（每路权重 0.5、1、2）选择融合参数，在第 3 个对话上报告；规则与结果写 ADR，默认值只在交叉验证得分高于当前默认时更新。
  - 重新生成私有报告与统计版 `docs/dev/reports/R1-retrieval.md`；统计版不含原文与对话名。
  验收：事件表覆盖 3 个对话并给出覆盖率；五路数字齐全；交叉验证规则与选择结果写入 ADR；报告可重复生成；`pnpm check` 通过。

- [x] **R1-T05.a 八段式压缩的存储与后台任务** | 依赖：M2-T06、R1-T01、R1-T04.b | DESIGN §7.3 | ADR-0044
  完成：2026-11-12 迁移 v36 新增 `chapter_compressions`（唯一约束与 story/楼层一致性触发器）；新增压缩模块：八段固定顺序解析（缺键、未知键、非字符串、空正文都指出字段）、章节与主线压缩后台任务（deferred 档、窗口原文加上一份压缩、主线取最近 5 条）、存储接口（规范化、路径有效性、分支失效）；11 个测试；门禁通过（162 个测试文件、1458 个测试、4 个 live 跳过）
  做什么：
  - 迁移 v36 新增 `chapter_compressions(id, story_id, level, start_node_id, end_node_id, sections, token_count, created_at)`，`level` 取 `chapter` 或 `mainline`，同一故事、级别、起止节点唯一；`sections` 存 JSON，键固定为 `剧情脉络`、`人物档案`、`关系网`、`世界与设定`、`物品与资源`、`伏笔与约定`、`当前情况`、`用户意志`。
  - 新增八段解析器：缺键、未知键、非字符串、去空白后为空都抛错并指出字段；渲染顺序固定。
  - 后台任务 `compression`：每 `chapterSize`（默认 20）个已确认助手楼层生成一条章节压缩，输入为窗口原文与上一份压缩；每 5 条章节压缩生成一条主线压缩，输入为最近 5 条章节压缩。缺键或类型不符整条拒绝并记录原因。
  - 有效性与 M2-T06 一致：起止节点都在当前路径上且起点在终点之前；重复执行不产生重复行；空窗口不调用模型。
  验收：八段齐全且顺序固定；缺键、空正文、非字符串各抛错并指出字段；分支切换后旧压缩失效；重复执行不产生重复行；空窗口零模型调用；`pnpm check` 通过。

- [x] **R1-T05.b 压缩槽位注入** | 依赖：R1-T05.a | DESIGN §7.3 | ADR-0044
  完成：2026-11-12 摘要槽位在有有效压缩时改为注入全部主线压缩与最近一条章节压缩，来源写 `compression:<级别>`；整段放不进预算时只保留该压缩的用户意志段，用户意志段不受裁剪；没有有效压缩时仍走原摘要路径，逐字不变；2 个测试；门禁通过（162 个测试文件、1460 个测试、4 个 live 跳过）
  做什么：
  - 槽位提供者按预算注入主线与最近章节压缩，用户意志段永远保留；Trace 来源写 `compression:<level>`。
  - 没有有效压缩时保持现有摘要注入行为。
  验收：预算裁剪保留用户意志；Trace 记录注入的压缩级别；没有压缩时摘要注入逐条不变；`pnpm check` 通过。

- [x] **R1-T06 后台预筛世界书** | 依赖：M2-T13、R1-T02、R1-T05.b | DESIGN §7.3、§9 | ADR-0044
  完成：2026-11-12 迁移 v37 新增 `lore_prefilter`；后台任务 `lore_prefilter`（`gap` 档、`settled` 入队）只处理当前 head 路径上最新的助手楼层，用玩家消息、最近一条有效压缩与当前拍方案做二字窗口 BM25 取前 20 条非恒常条目，再由后台模型按 id 选择并写到该楼层；`createLoreSlotProvider` 先读参照楼层或其父楼层的预筛结果，没有记录时回退关键词与实体命中，常驻条目始终保留；12 个测试；门禁通过（163 个测试文件、1472 个测试、4 个 live 跳过）
  做什么：
  - 迁移 v37 新增 `lore_prefilter(node_id PRIMARY KEY, story_id, entry_ids, created_at)`；`entry_ids` 存 JSON 数组。
  - 后台任务 `lore_prefilter`：回合落定后，用本轮用户消息、最近一条压缩摘要与下一拍方案构造查询；先用 BM25 取前 `prefilterLimit`（默认 20）条非恒常 lore，再由后台模型判断相关性并写入当前 head 楼层的预筛结果；恒常条目永远保留。
  - 下一轮组装时 `createLoreSlotProvider` 优先读当前 head 的预筛结果，没有记录时退回关键词与实体命中；回合内不调用模型。
  - 重复执行覆盖同一 `node_id`，不新增行；分支切换后只使用当前路径上的预筛结果。
  验收：回合内假客户端零调用；下一轮使用预筛结果；没有记录时回退正确；恒常条目始终注入；重复执行行数不变；分支隔离；`pnpm check` 通过。

- [x] **R1-T08 上下文包复用** | 依赖：R1-T02.a、R1-T03.a、R1-T06、M2-T12 | DESIGN §7.3、§9 | ADR-0044
  完成：2026-11-12 迁移 v38 新增 `context_packs`；`generateAssistantTurn` 在组装上下文后按玩家楼层写入完整组装结果、引用与台账快照版本，指纹包含模板、预算、档位、导演强度与各槽位的 `packKey`；重复生成同一玩家楼层直接读包，世界书条目被删、现场分析不在当前 head 路径或检索引用的楼层不在参照路径上时重新组装；槽位内容新增 `references` 供包复核，世界书与现场分析槽位写入引用；新增 7 个测试；门禁通过
  做什么：
  - 迁移 v38 新增 `context_packs(node_id PRIMARY KEY, story_id, payload, created_at)`；`payload` 存检索结果、预筛世界书条目 id、现场分析引用与台账快照版本。
  - 第一次生成玩家楼层的回复时组装上下文并写入上下文包；swipe 与重新生成同一楼层直接读包，不重新检索、不重新调用 embedding 或预筛；包不存在时按现有路径组装并写入。
  - 玩家编辑输入产生新楼层，不继承旧包；包引用的条目被删或分析楼层不在当前路径时视为不存在，重新组装。
  - 包本身不触发模型调用；回合内只读，回合外只准备下一轮能提前准备的部分。
  验收：同一玩家楼层 swipe 两次只组装一次且结果一致；编辑输入后重新组装；引用失效时回退到重新组装；包不跨分支复用；`pnpm check` 通过。

- [x] **R1-T99.a 记忆增强验收** | 依赖：R1-T03.a、R1-T03.b、R1-T04.b、R1-T05.b、R1-T06、R1-T08
  完成：2026-11-12 门禁通过（164 个测试文件、1480 个测试、4 个 live 跳过）；live 测试 3 个文件全部通过（embedding、渠道体检、三轮对话）；五项逐条核对通过；检索融合总体命中@5/@10/@20 从 R1 最小集的 148/170/179 升到 153/171/181，事件题@5 升 8 条、@20 少 1 条，状态题@5 少 3 条、@20 升 3 条；重排序后状态题@5/@10 各降 3/4 条，保持关闭；三份 20 楼八段压缩为 1,146/1,210/1,491 token，原 800 预算只注入用户意志段，新增 `DEFAULT_COMPRESSION_TOKEN_LIMIT = 2_000` 后完整八段注入，散文摘要保持 800；ADR-0086；`docs/dev/reports/R1.md` 第十二节；复核 I5、I11、I12 通过
  做什么：重跑门禁与 live 测试；逐条核对记忆增强的五项；对照 R1 最小集的数字给出检索与压缩的提升或下降，默认开关按证据设置并写 ADR；在 `docs/dev/reports/R1.md` 追加一节；复核 I5（快照只是缓存）、I11、I12。
  结果写 `MILESTONE_DONE`。

## R3b：深回合

- [x] **R3b-T00 细化深回合任务** | 依赖：R3-T99、R5-T99 | DESIGN §10.1
  完成：2026-11-12 按 DESIGN §10.1 拆成 T01 至 T10.b 与 T99：循环与上限、工具集与权限、运行日志、草稿与提交、导演手记、上下文卫生、模板配置、原生元数据、运行中追加要求、界面两段与验收；规划—批评—执行保持 DESIGN §18 的暂缓，模板只配置工具白名单与上限
  做什么：把 DESIGN §10.1 的深回合部分拆成可执行任务：单 agent 循环与防失控上限、故事级锁定与单轮开关、全部工具与权限、文本协议、进度事件、草稿与提交分开（草稿实时投影到界面，未提交不产生楼层）、导演手记挂在楼层树上按楼存修改并沿路径累加、运行日志只追加地并入 Trace、较早步骤工具往返的成对省略与 Trace 计数、模板附带深回合配置、多轮工具调用原样回放原生元数据（尤其 Gemini 思考签名）并配工具循环测试与中转渠道实测、运行中追加要求。容忍协议漂移（ADR-0041 的 A9）：模型没有调用提交工具、直接输出了正文时按草稿接住，不判失败。验收指标：运行失败率明显低于 23%、漂移率、时长分布（以 TauriTavern 的 P50 66 秒、P90 147 秒为对照）与深回合相对快回合的增益。
  验收：任务清单可直接执行；`pnpm check` 通过。

- [x] **R3b-T01 深回合循环与防失控上限** | 依赖：R3-T99、R5-T99 | DESIGN §10.1 | I6、I13
  完成：2026-11-12 新增 `core/src/chat/deep-turn.ts`（`runDeepTurn` 复用 `runModelTurns` 的传输、校验与流式接口）；迁移 v39 给故事设置增加四个深回合字段与范围约束；执行器新增 `maxToolCalls`、`maxDurationMs`，工具调用按总次数收束、每次请求前检查时长，超出上限的调用返回工具错误；`resolveTurnMode` 解冻 deep 并返回四个解析后的设置，删除 `assertTurnModeSupported`；`TurnTrace.deep` 记录上限、调用数、耗时与 `stopReason`（快回合为 null）；server 与 CLI 的 deep 请求不再 400；新增 5 个深回合测试并更新旧断言；门禁通过（164 个测试文件、1484 个测试、4 个 live 跳过）
  做什么：
  - 新增 `packages/core/src/chat/deep-turn.ts`：`runDeepTurn(options)` 与快回合共用 `runModelTurns` 的工具传输、参数校验与流式接口；循环由模型自行决定步骤，不要求它每轮调用工具，也不要求固定输出结构。
  - 上限只有两个：工具调用总次数（默认 40）与运行时长（默认 600,000 毫秒）。迁移 v39 给故事设置增加 `deepMaxToolCalls`（1–200）、`deepTimeoutMs`（60,000–3,600,000）、`deepContextTokenLimit`（默认 48,000）与 `deepRecentToolSteps`（默认 4，1–20）；校验复用范围检查，缺省值来自 `DEFAULT_DEEP_MAX_TOOL_CALLS`、`DEFAULT_DEEP_TIMEOUT_MS`、`DEFAULT_DEEP_CONTEXT_TOKEN_LIMIT` 与 `DEFAULT_DEEP_RECENT_TOOL_STEPS`。
  - 解冻模式：`resolveTurnMode` 不再对 deep 抛错，`ResolvedTurnMode` 增加 `deep` 段（四个设置值，校验后返回）；server 与 CLI 的 deep 请求因此不再 400。快回合的 `maxReadRounds` 语义不变。
  - 达到任一上限时停止继续调用工具，把已有正文按草稿交给草稿与提交环节，Trace 记 `deep.stopReason` 为 `max_tool_calls` 或 `timeout`；程序没有任何根据轮数、错误、预算改写模式的路径。
  - `TurnTrace` 新增 `deep` 段：`maxToolCalls`、`maxDurationMs`、`toolCallCount`、`durationMs`、`stopReason`（`completed`、`max_tool_calls`、`timeout`、`aborted`、`error`）；快回合的 `deep` 为 null。
  验收：第 41 次工具调用被拒绝且运行正常收束并记录 `max_tool_calls`；假时钟越过 10 分钟后不再发出请求；上限内的运行不受限制；设置越界抛错并指出字段；请求 deep 不再抛错；任意工具失败与重试都不改变模式；快回合的输出与 Trace 与改动前一致；`pnpm check` 通过。

- [x] **R3b-T02 深回合工具集、权限与进度事件** | 依赖：R3b-T01 | DESIGN §10.1、§10.2 | I12、I13、I18
  完成：2026-11-12 新增 `tools/registry.ts`（`DeepToolDefinition` 声明 `permission` 与 `progressLabel`，注册时拒绝未知权限、重复工具名与空进度文字）；只读工具补 `ledger_read` 与仅深回合的 `history_read`（拒绝非祖先楼层），写入工具 `ledger_write` 逐条用 `validateLedgerDiff` 校验、最多 20 条、非法条目返回工具错误、合法条目只收集并在楼层事务里写入；执行器按权限执行（`read` 直接执行、`propose` 只收集、`side_effect` 只登记、未启用的侧效应工具返回工具错误、未知工具记入 `rejected`），propose 与 side_effect 纳入同一工具调用上限，Trace 每次调用记录 `permission`；进度事件按阶段去重，server 映射为 SSE `turn.progress`；两种传输共用同一注册表；门禁通过（165 个测试文件、1496 个测试、4 个 live 跳过）
  做什么：
  - 新增 `packages/core/src/tools/registry.ts`：`DeepToolDefinition` 在 `LlmToolDefinition` 之上声明 `permission`（`read`、`propose`、`control`、`side_effect`）与 `progressLabel`；注册时拒绝未知权限与重复工具名，执行时 Trace 记录每次调用的权限级别。
  - 只读工具补两个：`history_read`（沿当前路径读取指定楼层或最近 N 楼的原文与块视图，参数 `{nodeId?, count?}`，不接受非祖先楼层）与 `ledger_read`（按前缀读取当前楼层快照上的台账事实与元数据，参数 `{prefix?}`）。现有 `memory_search`、`lore_lookup`、`state_get` 进入同一注册表。
  - 写入工具 `ledger_write`（权限 `propose`）：参数 `{diffs: [{path, value, storyTime?, confidence?}]}`，每次最多 20 条；逐条用 `validateLedgerDiff` 校验，非法条目作为工具错误结果返回让模型修正，合法条目只收集进本轮的结构化写入集合，工具本身不写数据库（I12）；提交时由楼层事务统一写入。
  - 权限执行规则：`read` 直接执行；`propose` 只收集；`control` 交给 R3b-T04；`side_effect` 只有已启用时才可调用（现有 `illustrate`），未启用的调用返回工具错误。这里只做深回合内的声明与执行，插件安装时的权限展示属于 P2。
  - 进度事件：执行工具前发出 `{type: "progress", phase, detail}`（phase 取 `progressLabel`，例如“回忆中……”“查阅设定……”“读取台账……”）；server 映射为 SSE `turn.progress`，同一阶段连续调用只在阶段变化时发一次。
  - 文本协议：同一套工具在 `tools.transport: text` 下可用，`<tool>` 解析、参数校验、错误结果回填与软上限行为与原生传输一致。
  验收：六个工具各有参数正例与非法参数负例；`history_read` 拒绝非祖先楼层；`ledger_write` 的非法条目返回错误结果、合法条目在提交前查不到；权限未声明的调用被拒绝并记录；进度事件只在阶段变化时发送；两种传输产生相同执行结果；`pnpm check` 通过。

- [x] **R3b-T03 运行日志** | 依赖：R3b-T01、R3b-T02 | DESIGN §10.1 | I7（不阻塞回合）
  完成：2026-11-12 迁移 v40 新增 `turn_runs` 与只追加的 `turn_run_events`（更新与删除由触发器拒绝，序号按运行内最大值加一）；`StoryStore` 新增 `startTurnRun`、`appendTurnRunEvent`、`finishTurnRun`、`listTurnRunEvents`、`countTurnRunEvents`、`getTurnRun`、`getTurnRunForNode`、`listTurnRuns`、`markInterruptedTurnRuns`；`startServer` 与 `dramaticer work` 启动时把遗留的 `running` 标为 `interrupted`；执行器在每次请求、响应、工具调用与工具结果处回调 `onRunEvent`，达到工具次数、时长或读取轮数上限时写 `limit`，失败与中止写 `error`；`TurnTrace.run` 记录 `runId`、结束状态与事件条数，快回合为 null；新增 `GET /api/nodes/:id/run`（没有运行 404）与 `dramaticer explain` 的“运行时间线”段；事件载荷只放轮次、名称、权限、成败、长度与用量，不放正文、参数或路径；新增 10 个测试；门禁通过（166 个测试文件、1506 个测试，4 个 live 跳过）
  做什么：
  - 迁移 v40 新增 `turn_runs(run_id PRIMARY KEY, story_id, user_node_id, node_id, mode, status, started_at, finished_at)` 与 `turn_run_events(run_id, seq, kind, payload, created_at, PRIMARY KEY(run_id, seq))`；事件表的更新与删除由触发器拒绝，只追加。`status` 取 `running`、`completed`、`interrupted`、`failed`、`aborted`。
  - 存储层新增 `startTurnRun`、`appendTurnRunEvent`、`finishTurnRun`、`listTurnRunEvents`、`markInterruptedTurnRuns`；`startServer` 与 `dramaticer work` 启动时把遗留的 `running` 行标为 `interrupted`。
  - 深回合每一步同步追加事件：`model.request`、`model.response`、`tool.call`、`tool.result`、`draft.replace`（只记版本号与长度，不存全文）、`draft.commit`、`steering`、`limit`、`error`；快回合不写运行表，保持现有 Trace 语义。
  - `TurnTrace` 增加 `run` 段（`runId`、`status`、`eventCount`），快回合为 null；新增 `GET /api/nodes/:id/run` 返回运行摘要与按 `seq` 排序的事件（没有运行时 404）；`dramaticer explain --node <id>` 打印同一时间线。
  验收：事件按 `seq` 严格递增；更新或删除事件抛错且原行不变；模拟进程中断后重启把 `running` 改为 `interrupted` 并保留已有事件；Trace 与接口读到同一 `runId`；事件载荷不包含草稿全文与私有路径；`pnpm check` 通过。

- [x] **R3b-T04 草稿与提交** | 依赖：R3b-T01、R3b-T02、R3b-T03 | DESIGN §10.1 | I4、I12
  完成：2026-11-12 新增运行内草稿控制器 `chat/draft.ts`（整份替换、版本号、提交后拒绝修改）与两个 `control` 工具 `draft_write`、`commit_draft`；草稿替换经 `onDraftReplace` 以 SSE `draft.replace` 发送并按 100 毫秒节流，提交后发送 `turn.committed`（楼层 id、最终块与提交方式）；提交走现有楼层写入路径，正文与草稿逐字节一致且只写一次；正常结束但没有提交时把最后一次输出自动提交并记 `deep.drift = missing_commit`，运行仍为成功；中止、超时、工具次数上限或没有任何正文且没有提交时不写助手楼层，运行标为 `aborted` 或 `failed` 并抛 `DeepTurnWithoutCommitError`；提交后同一轮的后续控制工具返回“已经提交”，其它工具返回“运行已经结束”；运行日志只记草稿版本号与长度；新增 5 个 core 测试与 1 个 server 测试；门禁通过（171 个测试文件、1512 个测试、4 个 live 跳过）
  做什么：
  - 两个控制工具：`draft_write`（参数 `{text}`，权限 `control`）整份替换当前草稿；`commit_draft`（无参数）把当前草稿提交为助手楼层并结束运行。草稿只存在运行内状态，提交前不写 `timeline_nodes`、不进入历史、不参与台账。
  - 每次草稿替换通过 `onDraftReplace` 回调交给 server，以 SSE `draft.replace` 发送（按 100 毫秒节流，与 `blocks.replace` 相同）；提交后发送 `turn.committed`，带助手楼层 id 与最终块快照。
  - 提交走现有楼层写入路径：解析块、收集结构化写入、写 `state_update` 与 `plot_note`、写 Trace、`run.status` 改为 `completed`；提交后拒绝后续 `draft_write` 与 `commit_draft`，重复提交返回工具错误。
  - 协议漂移（ADR-0041 A9）：运行正常结束、模型没有调用 `commit_draft` 但最后一次输出有正文时，把该正文当作最终草稿自动提交为楼层，`deep.drift` 记为 `missing_commit`，运行仍算成功；因中止、超时或错误结束且没有提交时，不写助手楼层，草稿保留在运行日志里，运行状态为 `aborted`、`failed` 或对应上限。
  - 用户楼层在运行开始时照常写入；没有助手楼层时 head 停在用户楼层，界面可以重试这一轮。
  验收：草稿替换只出现在 SSE 与运行日志，不产生楼层；提交后楼层正文与草稿逐字节一致且只写一次；无提交正常结束自动提交并记录漂移；中止结束不产生楼层；提交后再次写入或提交被拒绝；`pnpm check` 通过。

- [x] **R3b-T05 导演手记** | 依赖：R3b-T01、R3b-T02 | DESIGN §10.1 | I4、I12
  完成：2026-11-12 迁移 v41 新增 `director_notes`（每楼一行、同故事触发器、归属不可改）；`director/notes.ts` 定义 `set`/`delete` diff 的校验与沿路径累加；`note_read`（`read`，深回合）读累加结果并叠加本轮待提交修改，`note_write`（`propose`）把修改交给运行内 `TurnNoteController`，楼层提交时与台账写入同一事务落库；深回合开始时在组装后的消息之后注入一条手记系统消息，没有手记时不插入，快回合不注入也不暴露两个工具；手记不进入台账；新增 8 个测试；门禁通过（172 个测试文件、1524 个测试、4 个 live 跳过）
  做什么：
  - 迁移 v41 新增 `director_notes(node_id PRIMARY KEY, story_id, diffs, created_at)`，同故事触发器与既有一致；`diffs` 是 JSON 数组，每条 `{action: "set" | "delete", key, text?}`，写入前校验 key 非空、单条文本不超过 2,000 字、每楼不超过 50 条。
  - 工具 `note_read`（权限 `read`，返回沿当前路径累加后的手记键与正文）与 `note_write`（权限 `propose`，写入当前运行的待提交 diff；只有楼层提交时才写 `director_notes`）。
  - 累加规则：从 head 路径根部到当前楼层逐楼应用 `set` 与 `delete`，后写的楼层覆盖先前同名键；分支切换后只读当前路径。手记不进入台账、不参与结算、不改写原文。
  - 深回合开始时装入手记：在组装后的消息之后插入一条系统消息，列出累加后的手记；快回合不注入。手记是模型自己的工作材料，事实以台账为准。
  验收：同一键在后续楼层覆盖、`delete` 后消失；不同分支各自累加且互不影响；提交前手记查不到、提交后可见；没有手记时不插入空消息；手记不出现台账路径中；`pnpm check` 通过。

- [x] **R3b-T06 工具往返的上下文卫生** | 依赖：R3b-T01、R3b-T03、R3b-T04 | DESIGN §10.1
  完成：2026-11-12 新增 `chat/context-window.ts`：`pruneToolRoundTrips` 把“助手工具调用消息 + 紧随其后的工具结果消息”识别为一个工具步，按累计估算 token 与 `tokenLimit` 判定，从最早一步开始整步省略，直到降到上限以下或只剩 `recentToolSteps` 步；系统消息、用户消息、非工具往返的助手消息不参与省略，`addContextOmission` 累计多次请求前的省略；执行器新增 `contextWindow` 选项，每次请求前就地省略并把累计数字随 `ModelTurnResult.contextOmitted` 返回；`runDeepTurn` 新增 `contextTokenLimit` 与 `recentToolSteps` 并校验，接线 `resolveTurnMode` 解析出的故事设置；`TurnTrace.deep.contextOmitted`（`pairs`、`messages`、`tokens`、`reason`）只在有省略时写入；快回合不传该选项，`maxReadRounds` 逻辑不变；新增 8 个测试（上限以下不省略、成对省略与 token 数字、保留最近两步、步数不足不省略、参数非法、深回合 Trace、深回合上限以下、快回合不套用）；门禁通过（169 个测试文件、1528 个测试、4 个 live 跳过）
  做什么：
  - 深回合每次请求前估算工具消息累计 token；超过故事设置 `deepContextTokenLimit`（默认 48,000）时，从最早的一对“助手工具调用消息 + 对应工具结果消息”开始成对省略，直到降到上限以下或只剩最近 `deepRecentToolSteps`（默认 4 步，1–20）为止。
  - 只成对省略：不允许留下没有调用的工具结果，也不允许留下没有结果的工具调用；当前步骤正在使用的材料、系统消息、用户消息与最近步骤不省略。
  - 省略数量、配对数与原因写进 Trace 的 `deep.contextOmitted`（`pairs`、`messages`、`tokens`、`reason`）；未触发省略时不写该记录。
  - 快回合不套用这条规则；`maxReadRounds` 仍按原逻辑收束。
  验收：构造超过上限的工具往返后最早成对的消息被省略且消息序列仍合法；最近步骤与当前步骤完整；不产生孤立的 `tool` 消息或 `toolCalls`；Trace 数字与实际省略一致；上限以下不做任何省略；`pnpm check` 通过。

- [x] **R3b-T07 模板里的深回合配置** | 依赖：R3b-T01、R3b-T02 | DESIGN §10.1 | I6、I13
  完成：2026-11-12 `ContextTemplate` 新增可选 `deepTurn`（`tools`、`maxToolCalls`、`maxDurationMs`、`notesEnabled`），`assertContextTemplate` 调用新增的 `assertContextTemplateDeepTurn` 校验未知字段、未知工具名、重复工具名、越界上限、非布尔开关与「手记关闭却点名手记工具」，错误带模板 id 与字段路径；模板保存与导入都经过 `assertStoredContextTemplate` 走同一校验；`resolveTurnMode` 解析出的深回合设置新增 `tools`（null 表示全部）与 `notesEnabled`，`generateAssistantTurn` 用模板覆盖故事设置，`selectDeepTurnTools` 按白名单过滤注册表工具、手记关闭时排除 `note_read` 与 `note_write`，白名单外调用走执行器的未知工具拒绝并写入 `Trace.tools.rejected`，快回合忽略 `deepTurn`；上下文包指纹本就序列化整份模板，模板改动后旧包失效；新增 12 个测试；门禁通过（170 个测试文件、1540 个测试、4 个 live 跳过）
  做什么：
  - `ContextTemplate` 增加可选 `deepTurn`：`tools`（工具名数组，缺省为注册表全部只读、propose 与 control 工具）、`maxToolCalls`、`maxDurationMs`、`notesEnabled`（默认 true）。规划—批评—执行按 DESIGN §18 保持暂缓，本轮不增加计划方式字段。
  - 校验：未知工具名、重复工具名、越界上限、非布尔 `notesEnabled` 都抛错并指出模板 id 与字段；没有 `deepTurn` 的模板与现有模板逐字段一致。
  - 生效顺序：模板 `deepTurn` 覆盖故事设置，故事设置覆盖默认值；工具白名单之外的工具调用按未知工具拒绝并记录 Trace，不静默放行。快回合忽略 `deepTurn`。
  - 模板保存、导入与 `assertContextTemplate` 走同一校验；上下文包指纹包含模板内容，改动模板后旧包失效。
  验收：深回合只暴露白名单工具；白名单外调用被拒绝并记录；上限覆盖顺序正确；无配置的模板行为与改动前一致；非法配置在保存时被拒绝并指出字段；模板变化后上下文包重新组装；`pnpm check` 通过。

- [x] **R3b-T08 原生元数据保真** | 依赖：R3b-T01、R3b-T02 | DESIGN §10.1、§10.2
  完成：2026-11-12 助手消息新增可选 `native`（完整内容片段），`LlmToolCall.native` 保存 `thoughtSignature`、`namespace`、`argumentsError`，`LlmResult` 与 `LlmProviderResult` 带可选 `native`；pi 通道从 `AssistantMessage.content` 提取签名，只有存在签名类字段时才写 `native`，`buildPiContext` 在 `native.content` 存在时逐块回放并按当前 `toolCalls` 的 id 过滤、补齐缺失调用；执行器的 `RoundToolCall` 保留 `native`，原生传输下写入下一条助手消息与 `ModelTurnResult.toolCalls`，文本协议不受影响；缓存键与缓存结果都保留 `native`；新增 Gemini 两轮工具调用 fixture 测试（`thoughtSignature` 逐字节一致）、无签名渠道测试、深回合循环保留测试、缓存回写测试与 `native-metadata.live.test.ts`（`DRAMATICER_DEEP_LIVE=1` 时用 `main-fallback` 跑两轮工具调用）；门禁通过（171 个测试文件、1544 个测试、5 个 live 跳过）
  做什么：
  - `LlmToolCall` 增加可选的 `native`（不透明 JSON 对象）保存渠道原生字段，至少 `thoughtSignature`、`namespace`、`argumentsError`；助手消息增加可选的 `native`，保存渠道返回的完整内容片段（文本签名、思考签名与工具调用签名）。
  - pi 通道：请求组装时，助手消息若有 `native.content` 就原样回放，否则按现有文本与工具调用拼装；工具调用有 `native` 时把这些字段原样带回。响应时从 `AssistantMessage.content` 提取签名写入 `LlmResult.native` 与各 `LlmToolCall.native`。
  - 深回合循环把每一轮的 `LlmResult` 转成下一条助手消息时保留 `native`，不做合并、移动或丢失；续写产生的合成消息不带伪签名。
  - 测试：固定 fixture 的 Gemini 两轮工具调用，断言第二次请求里 `thoughtSignature` 与第一轮响应逐字节一致；没有签名的渠道不受影响；新增一个 `*.live.test.ts` 用 `data/channels.yaml` 的中转渠道跑两轮工具调用，默认跳过，`DRAMATICER_DEEP_LIVE=1` 时执行。
  验收：签名在两轮请求之间原样保留；缺失签名的响应不产生空对象；原生传输与文本传输都不因 `native` 字段报错；live 测试单独运行时两轮工具循环成功；`pnpm check` 通过。

- [x] **R3b-T09 运行中追加要求** | 依赖：R3b-T01、R3b-T03、R3b-T04 | DESIGN §10.1
  完成：2026-11-12 深回合句柄 `pushGuidance`、server 句柄表与 `POST /api/stories/:id/turns/:runId/steering`、`turn.steering` 回显与 `turn.started.runId`；指引只进入下一次请求，不写楼层。
  做什么：
  - core 的深回合运行暴露控制句柄 `pushGuidance(text)`：每次最多接受 5 条、每条去空白后 1–2,000 字；在下一个步骤开始前取出，作为新的用户消息追加到消息序列（前缀标明这是玩家在运行中追加的指引），并写 `steering` 运行事件；已经结束的运行拒绝追加。
  - server 维护运行中的句柄表（`runId` 到句柄）；`POST /api/stories/:id/turns/:runId/steering` 请求 `{text}`，返回 202；未知或不属于该故事的运行返回 404，已结束返回 409，空文本或超长返回 400 并指出字段。`turn.started` 带 `runId`。
  - 追加的指引不写新楼层、不改写原文，只影响后续步骤；SSE 发 `turn.steering` 回显文本。
  - 文本协议与原生传输都能读到追加消息；追加发生在最后一次模型请求之后时不补发请求。
  验收：运行中追加的指引出现在下一次模型请求里；不产生额外楼层；结束后追加被拒绝；句柄表在运行结束后清理；并发追加保持调用顺序；`pnpm check` 通过。

- [x] **R3b-T10.a 界面：模式开关与进度事件** | 依赖：R3b-T01、R3b-T02、R3b-T07 | DESIGN §10.1 | I6
  完成：2026-11-12 聊天页回合模式下拉框列出快/深两档，初值跟随故事设置，逐轮选择经 `mode` 发送；设置页深回合区段四个数值字段与模板编辑器的工具白名单、工具上限、时长上限、手记开关分别对齐 `StorySettings` 与 `ContextTemplate.deepTurn`；`TurnDraft` 记下 `turn.started.runId` 与 `turn.progress` 阶段文字，正文开始流出时清空阶段提示；浏览器常量移到 `chat/deep-turn.ts`，新增测试与 core 导出逐项比对，避免把 Node 侧 core 打进前端包；e2e 改为深回合锁定后直接发送、再逐轮切回快回合，并覆盖深回合设置越界与模板深回合字段保存；门禁通过（173 个测试文件、1552 个测试、5 个 live 跳过）
  做什么：
  - 聊天页输入框旁的模式选择列出“快回合 / 深回合”，单轮值通过 `POST /api/stories/:id/turns` 的 `mode` 发送；设置页可以锁定故事默认 `turnMode`。深回合可用后移除 R5-T11 的隐藏条件。
  - 生成过程中展示 `turn.progress` 的阶段文字，阶段结束后恢复正文流；深回合的 `turn.started` 带给定时器与句柄表使用的 `runId`。
  - 设置页增加深回合区段：`deepMaxToolCalls`、`deepTimeoutMs`、`deepContextTokenLimit`、`deepRecentToolSteps`，校验范围与服务端一致；模板编辑器的深回合配置字段与 `ContextTemplate.deepTurn` 同形。
  验收：深回合可以被选中并成功发送；故事锁定后新会话默认深回合；阶段文字按事件更新且不覆盖正文；设置表单越界被拒绝并指出字段；`pnpm check` 通过。

- [x] **R3b-T10.b 界面：草稿、追加要求与运行时间线** | 依赖：R3b-T03、R3b-T04、R3b-T09、R3b-T10.a | DESIGN §10.1
  完成：2026-11-12 深回合草稿面板按 `draft.replace` 的版本号向前合并，与流式正文分开展示，`turn.committed` 后收起草稿并显示正式块；失败与中止保留最后草稿与原因；新增 `POST /api/nodes/:id/retry`，以用户楼层为父节点重试这一轮（不追加用户楼层，可带 `mode`），失败条提供“重试这一轮”；深回合运行中输入框切换为“追加要求”，调用 steering 接口并回显 `turn.steering`；助手楼层的“运行时间线”按 `GET /api/nodes/:id/run` 的 `seq` 展示模型请求与响应、工具、草稿版本、提交、追加要求、上限与错误，中断时显示最后一步；纯逻辑放进 `chat/stream-state.ts` 与 `chat/run-timeline.ts`；e2e 覆盖草稿、追加要求与时间线；门禁通过（174 个测试文件、1561 个测试、5 个 live 跳过）
  做什么：
  - 草稿区实时显示 `draft.replace` 快照；提交后草稿区折叠为正式楼层；中止或失败时保留草稿与原因，提供“重试这一轮”。
  - 深回合运行中输入框切换为“追加要求”，调用 steering 接口并在界面回显已追加的条目；运行结束后恢复普通输入。
  - 楼层详情增加运行时间线：按 `GET /api/nodes/:id/run` 的事件顺序展示模型调用、工具调用、草稿版本、提交与上限端点；运行中断时显示停在哪一步。
  - 纯逻辑（草稿快照合并、阶段文字、时间线排序）放进 `src/playtest/` 风格的可测模块，组件只做渲染。
  验收：草稿逐次更新且不与正式楼层混在一起；追加要求出现在运行时间线里且不影响已完成的正文；时间线顺序与 `seq` 一致；中断运行显示最后一步；`pnpm check` 通过。

- [x] **R3b-T99.a 深回合验收评测工具** | 依赖：R3b-T10.b
  完成：2026-11-12 新增 `packages/st-compat/src/evalset/deep-eval.ts` 与 `deep-eval-cli.ts`（`pnpm --filter @dramaticer/st-compat deep-eval`）：在公开合成基准故事上按模拟用户连续跑深回合，逐轮记录失败、漂移、收束原因、提交方式、首字与耗时、工具调用、token、截断与上下文省略；在同一批用户楼层上再生成一次快回合回复，用 `roles.judge` 按两种顺序盲评，统计深胜、快胜、平局与不一致；JSONL 断点续跑，统计只含数字；`PLAYTEST_USER_HINTS` 与 `generateUserMessage` 从试玩模块导出复用；新增 4 个假客户端测试并通过
  做什么：在固定合成卡上连续跑 30 轮深回合，并在同一批分支点上比较快回合与深回合；记录失败、漂移、时长、工具调用与 token；用 `roles.judge` 盲评；支持断点续跑。
  验收：假客户端下深回合、失败、续跑、盲评与统计都有测试；单位测试零网络；`pnpm check` 通过。

- [x] **R3b-T99.b R3b 验收（真实渠道批量与报告）** | 依赖：R3b-T99.a
  完成：2026-11-12 长任务 `R3b-T99.b-01` 成功（exitCode 0、5.8 分钟）：30/30 轮深回合成功、失败率 0%（基线 23%），首字延迟 P50/P90 2,566/3,584 毫秒、总时长 P50/P90 3,261/4,208 毫秒，每轮 1 次模型请求、工具调用 0 次、输入 39,264 / 输出 4,221 token，提交全部为 `auto`、漂移 30/30 `missing_commit`，截断与上下文省略 0；10 个分支点两次顺序盲评：深胜 4、快胜 3、平局 0、两次相反 3；`docs/dev/reports/R3b.md` 逐条核对 T01 至 T10.b 的验收标准，复核 I6、I13、I12、I4、I7 通过；P1 与 H-T00 的依赖均已满足
  做什么：逐条核对深回合循环、草稿与提交、手记、运行日志、原生元数据、追加要求与防失控上限；复核 I6（程序不自动切换）、I13（不强制工具与固定结构）、I12（所有写入经过校验）；用真实渠道在一张固定合成卡上跑至少 30 次深回合，记录运行失败率（目标 ≤10%，明显低于 23% 的基线）、漂移率、首字与总时长分布（对照 TauriTavern P50 66 秒、P90 147 秒）、每轮工具调用数与 token；在同一个分支点上快回合与深回合各生成一次，至少 10 个分支点，用 `roles.judge` 盲评两两对比给出深回合增益；统计版写 `docs/dev/reports/R3b.md`（只含数字与模型别名），私有明细留在 `eval-private/reports/`；确认 P1 与 H 任务。

## P：插件内核（DESIGN §19；ADR-0045）

> 位置与依赖由 ADR-0044 固定：P1 依赖 R5-T99；P2 依赖 P1 与 R5-T99；P3 依赖 P2；P4 依赖 P3；P5 依赖 P4 与 M5-T99；C 线依赖 P2。

**P1 插件内核技术验证**（已拆成 P1.a 至 P1.c） | 依赖：R5-T99 | DESIGN §19.1、§19.6

  总验收（P1.c 逐条核对）：两个原型在删除前各跑一次门禁通过；比较表有数字与结论；ADR 入库并写清采用方式与依赖清单；`pnpm check` 通过。

- [x] **P1.a Cordis 原型** | 依赖：R5-T99
  完成：2026-11-12 新增私有包 `packages/plugin-spike`：用 Dramaticer 自己的契约（槽位提供者、Director 机制、块类型、服务、`onDispose`、五种分发模式）包住 Cordis 4.0.0-rc.13 的 Context、`use`/`inject`/`provide`、`ctx.effect` 与 StandardSchema 配置校验；11 个测试覆盖三个扩展点、依赖缺失阻塞与提供者出现后自动激活、循环依赖识别、同名服务与同名扩展点拒绝、抛错回滚、卸载回收、热重载、配置校验与五种分发模式；上游 `parallel` 不收集结果、`serial` 只返回第一个非空结果、`waterfall` 是中间件，与 DESIGN §19.2 不同，事件分发由适配层自己实现，依赖缺失与循环依赖也只留在 Cordis 的 PENDING 状态，需要适配层分析；门禁通过（176 个测试文件、1576 个测试、5 个跳过）
  做什么：
  - 在 `packages/plugin-spike` 定义插件作者看到的契约：上下文槽位提供者、Director 机制、块类型、服务声明与获取、副作用回收、五种分发模式。
  - 用 Cordis 的 Context、`ctx.use`、`inject`/`provide`、`ctx.effect` 与 StandardSchema 配置校验实现装载器。
  验收：三个扩展点都能注册、取用与卸载；依赖缺失、循环依赖、重名、抛错与热重载都有测试；`pnpm check` 通过。

- [x] **P1.b 自研精简版原型** | 依赖：P1.a
  完成：2026-11-12 同一包内新增 `KernelSurface`（两个内核共用的注册表、槽位取用、机制执行与五种事件分发）与 `LiteKernel`：只保留扩展点注册、`inject`/`provide` 依赖解析、装载失败回滚、卸载回收、热重载、扩展点取用与五种分发模式，不 import `cordis`；依赖缺失停在 pending、提供者出现后按装载顺序自动激活、提供者卸载或依赖消失时回退为 pending 并撤销全部注册；配置校验复用 `StandardSchemaV1`；依赖缺失、循环依赖与重名检查由内核自己分析。`PluginKernel` 接口进入 `contracts.ts`，11 条行为断言抽成 `test/kernel-suite.ts`，`cordis-kernel.test.ts` 与 `lite-kernel.test.ts` 各跑同一份套件（22 个测试）；门禁通过（177 个测试文件、1587 个测试、5 个跳过）
  做什么：
  - 在同一个包、同一组契约下实现只有 Context、注册表、依赖解析与生命周期回收、五种分发模式的精简内核，不依赖 cordis。
  - 把 P1.a 的行为测试抽成共享测试套件，两个内核跑同一份断言。
  验收：两个内核跑同一份断言全部通过；自研内核不依赖任何第三方插件框架；`pnpm check` 通过。

- [x] **P1.c 比较与 ADR** | 依赖：P1.b
  完成：2026-11-12 测量两个原型：Cordis 适配层的运行时依赖为 146,876 字节（`cordis` 77,075 + `cosmokit` 69,801），冷启动模块加载 6.83–7.41 毫秒，新建内核并装载同一组四个插件的中位数 1.079–1.098 毫秒；`LiteKernel` 的运行时第三方依赖为 0，中位数 0.012 毫秒。两者都通过 `strict` 类型检查、同一份 11 条断言与热重载；Cordis 的依赖缺失与循环依赖只停在 PENDING，原因分析、同名服务检查与五种分发仍由适配层实现。ADR-0087 决定采用自研精简内核，并规定 P2 把对外类型与内核迁到 `packages/core/src/plugins/`；删除 `packages/plugin-spike`（原型代码与测量脚本见提交 `9c9c823` 与 `8773049`），`cordis` 与 `@standard-schema/spec` 从依赖登记删除；删除前门禁通过两次（177 个测试文件、1587 个测试、5 个跳过），删除后的门禁通过（175 个测试文件、1565 个测试、5 个跳过）
  做什么：
  - 测量两个原型的包体积（框架及其传递依赖的安装体积）与启动耗时（新建内核并装载同一组插件，重复若干次取中位数），并记录类型检查、热重载、依赖解析与循环检测、许可证与打包方式。
  - 写 ADR 决定采用哪一种，登记依赖清单；删除 `packages/plugin-spike`，把可复现命令与数字留在 ADR。
  验收：比较表有数字与结论；ADR 写清采用方式、依赖清单与原型删除理由；删除前两个原型各跑一次门禁通过；`pnpm check` 通过。

**P2 插件内核改造**（已拆成 P2.a 至 P2.g） | 依赖：P1、R5-T99 | DESIGN §19.1、§19.2

  总验收（P2.g 逐条核对）：每个内置模块都有注册表条目与对应测试；测试覆盖依赖缺失跳过、服务冲突、卸载回收、热重载、五种分发模式与超时跳过；每次改造后门禁通过且 R2 的基准数字不退化；`core` 不依赖任何插件（I15）。

- [x] **P2.a 内核迁入 core 与对外类型** | 依赖：P1、R5-T99
  完成：2026-11-12 `packages/core/src/plugins` 新增 `contracts.ts`、`events.ts`、`registry.ts`、`kernel-surface.ts`、`lite-kernel.ts` 与模块入口，import 改为 core 内部的相对模块；插件作者类型与 `LiteKernel` 从 `@dramaticer/core` 根导出，`ExtensionRegistry`、`EventBus`、`KernelSurface` 由 `plugins` 模块导出；fixtures 与 11 条断言迁到 `packages/core/test/plugin-kernel-suite.ts` 并只跑 `LiteKernel`；`@standard-schema/spec` 登记为 `packages/core` 的依赖，运行时代码不 import 它；门禁通过（176 个测试文件、1576 个测试、5 个跳过）
  做什么：
  - 把原型里的 `contracts.ts`、`kernel-surface.ts`、`registry.ts`、`events.ts`、`lite-kernel.ts` 迁到 `packages/core/src/plugins/`，import 改成 core 内部的相对模块，不经过包根与 `@dramaticer/core/blocks` 子路径。
  - 插件作者看到的类型（`PluginDefinition`、`PluginContext`、`PluginStatus`、`KernelSnapshot`、`EventListener`、`SlotRunResult`、`PluginKernel`）与 `LiteKernel` 从 `@dramaticer/core` 根导出；`ExtensionRegistry`、`EventBus`、`KernelSurface` 由 `plugins` 模块导出。
  - 原型里的 fixtures 与 11 条共享断言迁到 `packages/core/test/`，只跑 `LiteKernel`；断言内容与原型一致。
  - `@standard-schema/spec` 重新登记为 `packages/core` 的类型依赖（配置 schema 类型出现在公开声明里）。
  验收：`LiteKernel` 与插件作者类型从包根可导入；11 条断言全部通过；`packages/core/src/plugins` 不依赖任何第三方插件框架，运行时代码不 import `@standard-schema/spec`；`pnpm check` 通过。

- [x] **P2.b 插件运行环境与生命周期** | 依赖：P2.a
  完成：2026-11-12 `plugins/runtime.ts` 新增 `createPluginKernel({ plugins, configs })`：按数组顺序装载（缺省 `BUILTIN_PLUGINS`，当前为空清单）、配置按插件名取用、`inject`/`provide` 由内核解析、同名服务冲突时先 `dispose()` 已装载插件再抛出；`PluginContext` 新增 `timeout`、`interval`、`backgroundJob`，三者都进 `cleanups`，卸载、重载与装载失败时回收；`ExtensionRegistry` 新增后台任务类型注册（复用 `createBackgroundJobRegistry` 校验，同名拒绝，幂等撤销）；`KernelSnapshot` 新增 `missingServices` 与 `backgroundJobs`，`PluginKernel` 新增 `backgroundJob(kind)` 与 `backgroundJobs()`；`plugin-runtime.test.ts` 新增 6 个测试覆盖装载顺序与配置、缺失依赖、启动冲突回收、定时器回收（卸载与重载）、装载失败回收定时器、后台任务类型回收与重复注册；门禁通过（177 个测试文件、1582 个测试、5 个跳过）
  做什么：
  - core 提供创建插件内核的入口与运行环境：装载内置插件、按 `inject` 与 `provide` 解析依赖，依赖缺失的插件不加载并在状态里给出原因，同名服务冲突启动失败。
  - 卸载与热重载回收插件注册的钩子、定时器与后台任务；内核快照能读回插件状态、缺失服务、槽位、机制、块类型与服务。
  - 五种分发模式（emit、parallel、serial、bail、waterfall）在内核上可用；这一子任务不改动现有内置模块的调用路径。
  验收：依赖缺失、服务冲突、卸载回收与热重载各有测试；快照里的状态与原因可读；现有回合、后台任务与评测行为不变；`pnpm check` 通过。

- [x] **P2.c 上下文槽位提供者插件化** | 依赖：P2.b
  完成：2026-11-12 新增 `plugins/slots.ts`：character、persona、history、state、summary、memory、lore、scene、director、user_will 各是一个插件定义（另有朴素档的 `slot.history.raw`），存储与选项按插件名从内核配置取用，角色提示词或人设为空时不注册槽位；`PluginKernel` 新增 `slotProvider(name)`，`plugins/chat-providers.ts` 的 `createStandardChatSlots` 与 `createNaiveChatSlots` 装载内置插件后从内核读出提供者快照（`collectSlotProviders`），装载失败的插件让工厂抛错并列出原因；`createPluginKernel` 的缺省插件清单改为 `SLOT_PLUGINS`；`chat/providers.ts` 只保留单个槽位提供者工厂；server 运行时、st-compat 会话与 chat CLI、五个评测与回放入口改为异步取 `slots.providers`；`chat-slot-plugins.test.ts` 新增 4 个测试（注册表条目、空角色提示词、朴素集合、卸载后 Trace 记 `missing-slot`）；门禁通过（178 个测试文件、1586 个测试、5 个跳过）
  做什么：
  - 把 `chat/providers.ts` 的槽位提供者逐个改成插件定义并注册进内核：character、persona、history、state、summary、memory、lore、scene、director、user_will；`createStandardChatSlots` 等工厂改从内核取提供者。
  - 槽位内容、顺序、预算与 Trace 条目与改动前逐字段一致；插件缺失或未激活时槽位记 `missing-slot`。
  验收：每个槽位都有注册表条目与测试；同一故事与设置下组装结果与改动前一致；卸载槽位插件后该槽位缺失并被 Trace 记录；`pnpm check` 通过。

- [x] **P2.d Director 机制与块类型插件化** | 依赖：P2.c
  完成：2026-11-12 新增 `plugins/mechanisms.ts`（clue、opening、beat、repetition、event_pool、pacing 六个机制插件与 `DEFAULT_MECHANISM_KERNEL`）与 `plugins/block-types.ts`（12 个块类型插件、`DEFAULT_BLOCK_TYPE_KERNEL`、`blockTypeRegistryFromKernel`、`defaultBlockTypeRegistry`）；`LiteKernel.installSync` 同步安装没有配置校验的插件，`PluginKernel` 增加 `mechanisms()` 与 `blockTypes()`；`evaluateDirector` 缺省机制、`parseBlocks` 与 `renderHistoryView` 缺省块类型都从内核读，顺序与改动前一致；`BUILTIN_PLUGINS` 并入这两组静态插件；新增 `plugin-extensions.test.ts` 7 个测试（注册表条目与顺序、缺省评估与显式机制一致、重复注册回滚、解析器缺省与卸载）；门禁通过（179 个测试文件、1593 个测试、5 个跳过）
  做什么：
  - `DEFAULT_DIRECTOR_MECHANISMS` 与 `DEFAULT_BLOCK_TYPES` 改为通过内核注册的插件；评估顺序、优先级与 `signals` 与改动前一致。
  - Director 机制保持同步纯函数（I9）；块类型校验仍走 `createBlockTypeRegistry`。
  验收：每个机制与块类型都有注册表条目与测试；同一输入下建议、决策记录与块解析结果与改动前一致；重复注册失败且不留下半成品；`pnpm check` 通过。

- [x] **P2.e 后台任务类型与工具插件化** | 依赖：P2.d
  完成：2026-11-12 新增 `packages/core/src/plugins/background-jobs.ts`（17 个任务插件定义与 `createBackgroundJobPlugins`、`createBackgroundJobRegistryFromPlugins`）与 `packages/core/src/plugins/tools.ts`（10 个工具插件、`DEFAULT_TOOL_KERNEL`、`toolRegistryFromKernel`、`defaultToolRegistry`）；`ExtensionRegistry` 新增工具注册（复用 `createDeepToolRegistry` 校验，按 `fast`/`deep` 阶段过滤）与 `tools`/`tool` 查询，`PluginContext` 新增 `tool`，`PluginKernel` 与快照新增工具读取；`createDefaultBackgroundJobRegistry` 改为插件装载后收集注册表，任务未激活直接抛错；`FAST_TURN_TOOLS`、`DEEP_TURN_TOOLS` 从内核派生；`BUILTIN_PLUGINS` 并入工具与静态任务插件；`context/slot-names.ts` 移出槽位名与校验以打断 `tools/index → plugins/tools → kernel → registry → context/template` 的循环；新增 `plugin-background-tools.test.ts` 10 个测试（每类任务与工具的注册表条目、名单与权限、入队条件与档位、illustrate/embeddings 选项、重复注册回滚、卸载、缺失插件抛错）；门禁通过（185 个测试文件、1603 个测试、5 个跳过）
  做什么：
  - `createDefaultBackgroundJobs` 里的每种后台任务与 `FAST_TURN_TOOLS`、`DEEP_TURN_TOOLS` 里的工具改为通过内核注册的插件，保留入队条件、档位与工具权限级别。
  - 深回合按白名单选取工具与手记开关过滤的行为不变。
  验收：每种任务类型与工具都有注册表条目与测试；入队条件、档位、权限与工具名单与改动前一致；缺失插件时不静默降级；`pnpm check` 通过。

- [x] **P2.f 回合内钩子时间预算、Trace 与 explain** | 依赖：P2.e
  完成：2026-11-12 新增 `plugins/turn-hooks.ts`（`runTurnHook`、`DEFAULT_TURN_HOOK_BUDGET_MS = 5_000`、`TurnHookTraceEntry`、`TurnRequestRewriter`）：槽位提供者经内核收集时带上插件名，`assembleContext` 按提供者计时，超时按缺失槽位处理并让回合继续；组装后的请求改写经 `KernelSurface.rewriteRequest` 按注册顺序水流式改写（事件名 `request.rewrite`），超时跳过、后面的钩子继续；`TurnTrace.hooks` 记录扩展点、插件、耗时、结果与原因，超时槽位的上下文包不保存；`dramaticer explain` 第 3 段列出全部钩子、超时数与原因并给出修正建议；server 运行时与 `dramaticer chat` 传入内核作为改写入口；新增 7 个钩子测试与 1 个 explain 测试；门禁通过（181 个测试文件、1611 个测试、5 个跳过）
  做什么：
  - 回合内扩展点按 DESIGN §19.2 接入组装与请求改写，给每个钩子设置时间预算；超时跳过、继续回合，并把扩展点名、插件名、耗时与原因写进 Trace（I17）。
  - `dramaticer explain` 读出被跳过的扩展点与原因；跳过的提供者按缺失处理，不产生半截内容。
  验收：超时钩子被跳过且回合继续，Trace 与 `dramaticer explain` 都能读到原因；未超时钩子的耗时被记录；没有钩子时回合输出与改动前一致；`pnpm check` 通过。

- [x] **P2.g P2 验收** | 依赖：P2.c、P2.d、P2.e、P2.f
  完成：2026-11-12 逐条核对 P2.b 至 P2.f 的验收标准与 I6、I7、I9、I11、I12、I13、I15、I17；所有内置模块（槽位 10、机制 6、块类型 12、工具 10、后台任务 13 个静态项）都经内核注册并有测试；记分牌、遗忘报告与 B1 报告从已保存记录复跑，数字与仓库文件一致（逐字节相同或只差生成时间）；`core` 不依赖其他工作区包；门禁通过（181 个测试文件、1611 个测试、5 个跳过）；结果写入 `docs/dev/reports/P2.md`
  做什么：
  - 逐条核对 P2.b 至 P2.f 的验收标准，复核 I6、I7、I9、I11、I12、I13、I15、I17；重跑 R2 的基准评测，对比数字。
  - 结果与复现命令写进 `docs/dev/reports/P2.md`；有退化的模块回退成直接调用并记录原因。
  验收：全部内置模块经内核注册并有测试；R2 基准数字不退化；`core` 不依赖任何插件；`pnpm check` 通过。

**P3 声明式插件格式与卡片打包**（已拆成 P3.a 至 P3.f） | 依赖：P2 | DESIGN §19.3、§19.4

  总验收（P3.f 逐条核对）：声明式插件只含数据、不执行代码；卡片打包、导入提示与依赖缺失提示有测试；玩法包叠加与用户覆盖的优先级有测试；按故事的开关与覆盖有测试；示例插件通过 schema 校验；`pnpm check` 通过。

- [x] **P3.a 声明式插件格式与卡片打包字段** | 依赖：P2 | DESIGN §19.3、§19.4
  完成：2026-11-12 新增 `packages/core/src/plugins/declarative.ts`：`format`/`formatVersion`/`name`/`version`/`kind`/`payload` 外壳与七种负载（`ledger-schema`、`plot-beat`、`context-template`、`block-renderer`、`skill`、`director-config`、`event-pool`）的严格 schema，输入先按 JSON 值校验，函数与类实例无法通过；事件定义解析抽到 `director/event-definition.ts` 供卡扩展与 `event-pool` 共用；`extensions.dramaticer` 新增 `plugins`、`requires`、`recommends`（插件与玩法包各带可选 `versionRange`），依赖重名与插件重名整组拒绝；新增 13 个测试并更新卡扩展空值断言；门禁通过（182 个测试文件、1624 个测试、5 个跳过）
  做什么：
  - 定稿声明式插件的公共外壳与七种类型的负载 schema，每种类型都有格式版本与严格校验。
  - 卡片可以在 `extensions.dramaticer` 里打包声明式插件与依赖声明。
  验收：七种类型各有合法样例与非法样例测试；函数无法通过解析；卡片随附插件、必需依赖与推荐依赖可解析；`pnpm check` 通过。

- [x] **P3.b 玩法包分层与用户覆盖** | 依赖：P3.a
  完成：2026-11-12 新增 `packages/core/src/plugins/playpack.ts`：`dramaticer.playpack` 外壳（名称、版本、依赖、插件、配置补丁、开关）与严格解析 `parsePlaypackManifest`、`parsePlaypacks`、`parsePlaypackUserOverrides`；`stackPlaypacks` 按加载顺序收集插件，后层覆盖前层同名插件的配置（嵌套对象深合并，数组与标量整体替换）与开关，用户覆盖放在最上层且不写回包文件；依赖必须由更早的层满足，跨包重名插件、重复玩法包、引用未知插件的配置与开关直接拒绝；`isPlaypackPluginEnabled` 未声明按启用；`readPluginName`/`readPluginVersion` 从 `declarative.ts` 导出复用；新增 10 个测试（含深冻结输入证明包文件只读）；门禁通过（183 个测试文件、1634 个测试、5 个跳过）
  做什么：
  - 定义玩法包清单：名称、版本、依赖、包含的插件与配置补丁、开关。
  - 多个玩法包按加载顺序叠加，后面的包覆盖前面的同名配置与开关；用户覆盖在最上层，不修改包文件。
  验收：叠加顺序与用户覆盖优先级有测试；包文件只读；`pnpm check` 通过。

- [x] **P3.c 按故事启用与覆盖** | 依赖：P3.b
  完成：2026-11-12 迁移 v42 给 `story_settings` 增加 `plugin_overrides`（`{config, switches}`，同故事各分支共享）；`StorySettings.pluginOverrides` 与更新字段复用 `PlaypackUserOverrides`，保存与读取都走 `parseStoryPluginOverrides`；用户覆盖解析与 JSON 拷贝抽到叶子模块 `plugins/playpack-overrides.ts`；新增 `resolveStoryPlugins` 在玩法包叠加之后剔除显式关闭的插件，`plugins` 与 `configs` 只含启用项并给出 `disabledPlugins`；新增 `story-plugins.test.ts`（分支切换、重新打开、故事隔离）与按故事解析用例；门禁通过（184 个测试文件、1637 个测试、5 个跳过）
  做什么：
  - 迁移新增故事级插件状态：每个故事的启用开关与配置覆盖，分支共享同一份。
  - 运行时按故事解析最终启用的插件与配置。
  验收：分支切换不改变插件配置；关闭的插件不加载；覆盖值优先于包默认值；`pnpm check` 通过。

- [x] **P3.d 卡片导入依赖检查与提示** | 依赖：P3.a、P3.b
  完成：2026-11-12 `packages/core` 增加 `semver` 依赖；新增 `plugins/versions.ts`（`readVersionRange`、`assertInstalledVersion`、`versionSatisfies`）与 `plugins/card-dependencies.ts`（`checkCardDependencies`，返回 `CardDependencyReport {satisfied, issues}`，状态取 `missing`、`version-mismatch`、`unknown-version`，每条带安装建议）；`parseDeclarativeRequirements` 的版本范围改为 semver 语法校验；`importCardContent` 合并内置插件、调用方 `availableDependencies` 与卡随附插件后核对依赖，报告进入 `ImportedCardContent.dependencies`、server 的 `ImportStoryResult.imported.dependencies` 与 `dramaticer chat --card` 日志；ADR-0089；新增 core 6 条与 st-compat 4 条测试；门禁通过（186 个测试文件、1647 个测试、5 个跳过）
  做什么：
  - 导入卡片时比较 `requires` 与 `recommends` 和本机可用的插件与玩法包，列出缺失项并给出安装建议。
  - 缺少必需依赖时不静默降级，导入报告中逐条说明。
  验收：缺失必需与推荐依赖的提示各有测试；全部满足时不提示；`pnpm check` 通过。

- [x] **P3.e 示例声明式插件与格式文档** | 依赖：P3.a
  完成：2026-11-12 `docs/plugins/examples/` 新增台账 schema（`example.cultivation-ledger`）、块渲染器（`example.status-bar`）与技能（`example.dialogue-craft`）三个示例；`docs/plugins/declarative-plugins.md` 记录外壳字段、七种负载、条件表达式、卡片打包、版本规则与玩法包叠加；新增 `declarative-plugin-examples.test.ts` 读取三个示例走 `parseDeclarativePlugins`，并核对文档包含解析器的类型、命名空间、槽位、导演键与格式常量；门禁通过（187 个测试文件、1650 个测试、5 个跳过）
  做什么：
  - 提供台账 schema、块渲染器与技能三个示例声明式插件，放进 `docs/plugins/examples/` 并由测试读取校验。
  - 写格式文档：外壳字段、七种负载、卡片打包与版本规则。
  验收：示例插件全部通过 schema 校验；文档与解析器行为一致；`pnpm check` 通过。

- [x] **P3.f P3 验收** | 依赖：P3.b、P3.c、P3.d、P3.e
  完成：2026-11-12 逐条核对 P3 总验收与 P3.a 至 P3.e 验收标准，复核 I4、I8、I12、I13、I15、I16；8 个测试文件、56 个测试单独重跑通过；门禁通过（187 个测试文件、1650 个测试、5 个跳过）；结果写入 `docs/dev/reports/P3.md`
  做什么：
  - 逐条核对 P3 总验收与 I4、I8、I12、I13、I15、I16；写 `docs/dev/reports/P3.md`。
  验收：全部 P3 验收标准通过；`pnpm check` 通过。

**P4 代码插件：权限清单、worker 隔离、安装与更新**（已拆成 P4.a 至 P4.f） | 依赖：P3 | DESIGN §19.3、§19.4、§19.7

  总验收（P4.f 逐条核对）：未声明权限的调用被拒绝并有 Trace；安装与更新的权限展示有测试；worker 崩溃不影响主进程并有测试；卸载回收副作用有测试；示例代码插件在沙箱里运行通过；`pnpm check` 通过。

- [x] **P4.a 代码插件清单与权限声明** | 依赖：P3 | DESIGN §19.3、§19.4、§19.7
  完成：2026-11-12 新增 `packages/core/src/plugins/code-plugins.ts`：`dramaticer.code-plugin` 外壳（格式版本 1、档位固定 `code`、名称、版本、引擎范围、入口、`inject`/`provide`、配置 schema、权限）严格解析，函数与类实例无法通过；四类权限带范围（`network` 主机列表、`files` 读取或读写加插件目录相对路径、`model` 模型角色、`ledger-write` 台账命名空间），同类权限只能声明一次；`describeCodePluginPermissions` 给出安装展示文案，`diffCodePluginPermissions` 区分新增与移除并给出 `requiresConfirmation`，`isEngineCompatible` 按 semver 范围判断本机版本；新增 `code-plugins.test.ts` 12 条测试；ADR-0090；门禁通过（188 个测试文件、1662 个测试、5 个跳过）
  做什么：
  - 定义代码插件清单的格式标识、格式版本与档位，字段为名称、版本、兼容的 Dramaticer 版本范围、入口文件、`inject` 与 `provide`、配置 schema、权限。
  - 四类权限带范围：`network`（主机列表）、`files`（读取或读写，加上插件目录内的相对路径）、`model`（模型角色）、`ledger-write`（台账命名空间）。
  - 权限的展示文案（安装时逐条列出）与新旧版本之间的权限差异（新增与移除，用来判断是否需要重新确认）；兼容范围与本机版本是否匹配。
  验收：合法清单的全部字段解析成功；未知字段、非法档位与格式版本、非法入口路径、`inject` 与 `provide` 重名或互相重叠、非法权限范围各抛错并指出字段路径；权限展示文案覆盖四类权限；新旧版本权限差异能区分新增与移除；引擎版本不满足兼容范围时判定为不兼容；`pnpm check` 通过。

- [x] **P4.b 安装确认与安装记录** | 依赖：P4.a
  完成：2026-11-12 迁移 v43 新增全局 `plugin_installations`（清单规范 JSON、已授予权限、来源类型与说明、安装时间），安装与升级覆盖同一行；新增 `plugins/installation.ts` 的 `planCodePluginInstallation`（首次安装列出全部权限并要求确认，升级只列新增与移除，权限无变化不确认）、`confirmCodePluginInstallation`（重算计划，过期抛错，写入的已授予权限等于清单声明）、`assertInstalledCodePluginsMatch`（启动核对记录与磁盘清单，错误指出插件名）与来源校验；`StoryStore` 新增读取、列出与写入安装记录的方法，读回复用清单与权限解析；新增 `code-plugin-installations.test.ts` 9 条测试；ADR-0091；门禁通过（189 个测试文件、1671 个测试、5 个跳过）
  做什么：
  - 迁移新增全局 `plugin_installations`：清单原文、已授予的权限、来源与时间；安装与升级都写同一行。
  - 安装前计算需要确认的权限：首次安装列出全部权限，升级只列出新增与移除；用户确认后才写入记录，拒绝后不留记录。
  - 权限没有变化时不重复要求确认，权限变化时必须重新确认；记录里的清单与本机实际安装的清单不一致时启动失败。
  验收：首次安装列出全部权限并等待确认；升级只列出变化的权限；确认前的记录不存在；拒绝后不留记录；无变化不重复确认；记录与磁盘清单不一致时抛错并指出插件名；`pnpm check` 通过。

- [x] **P4.c worker 隔离与未声明调用拒绝** | 依赖：P4.b
  完成：2026-11-12 新增 `plugins/code-plugin-worker.ts`：每个代码插件一个 worker 线程，入口在 worker 内动态装载，主线程只通过消息端口交付网络、文件、模型与台账四类能力；权限以安装记录的 `grantedPermissions` 为准并要求是清单子集，未声明调用拒绝并写 `CodePluginTraceEntry`；台账 diff 强制来源 `settler` 并只交给注入的待校验接收器，没有 `StoryStore` 入口；消息上限 1 MiB，激活或调用超时、崩溃、非法消息都让插件失败并撤销注册项；槽位与只读工具走代理，Director 机制按 I9 拒绝注册；`DeepToolDefinition` 增加可选 `execute`；ADR-0092；新增 `code-plugin-worker.test.ts` 10 条测试；门禁通过（190 个测试文件、1681 个测试、5 个跳过）
  做什么：
  - 代码插件在 worker 线程里运行，主线程只通过消息端口交付清单允许的能力；插件对网络、文件、模型与台账写入的调用先查已授予权限，未声明直接拒绝并写入 Trace，不做静默放行。
  - worker 崩溃、超时或非法消息时终止该插件并记为失败，主进程与其他插件继续；插件注册的槽位、机制与工具在失败后不再产出内容并记入 Trace。
  - 台账写入仍然只能提交为待校验的 diff，经过结算器校验（I12、I16）。
  验收：未声明的四类调用各被拒绝并带 Trace 记录；声明的调用正常执行；worker 崩溃后主进程继续并且插件状态为失败；超限消息被拒绝；台账写入路径上没有绕过结算器的入口；`pnpm check` 通过。

- [x] **P4.d 从 npm、git、zip 安装与更新，卸载回收副作用** | 依赖：P4.c
  完成：2026-11-12 新增 `plugins/code-plugin-installer.ts` 的 `CodePluginManager`：三种来源先解包到 `<pluginsDir>/.staging/` 并读取根清单 `dramaticer.plugin.json`，npm 直接读 registry 元数据、按 `dist.integrity` 校验并解包 tarball（`tar`），git 用 `git clone --depth 1 --` 并删除 `.git`，zip 用 `fflate` 解包且拒绝逃出安装目录的条目；`prepare` 给出权限计划与本机兼容判定，不兼容时删除暂存目录且 `confirm` 抛错；`confirm` 先备份旧目录、就位后写安装记录（失败恢复旧目录）；`checkUpdate` 重新解包来源比较版本并给出不兼容提示，只有更高且兼容的版本算可更新；`uninstall` 先停 worker（撤销注册项）再删除插件目录与安装记录；故事级配置 `story_settings.pluginOverrides.config` 不参与安装与更新；安装记录接口新增 `deleteCodePluginInstallation`；ADR-0093；新增 9 条本地 fixture 测试；门禁通过（191 个测试文件、1690 个测试、5 个跳过）。
  做什么：
  - 三种来源的安装：npm 包名与版本、git 地址、zip 文件；安装到插件目录，读取清单，按 P4.b 走确认。
  - 更新检查与版本兼容提示；卸载时回收 worker、注册项与插件目录里的文件。
  验收：三种来源各有一个用本地 fixture 的安装测试；版本不兼容时给出提示且不安装；更新保留故事级配置；卸载回收 worker 与注册项；`pnpm check` 通过。

- [x] **P4.e 插件开发文档与示例代码插件** | 依赖：P4.c
  完成：2026-11-12 新增 `docs/plugins/code-plugins.md`（清单字段与 `dramaticer.plugin.json`、四类权限范围、Context API、生命周期与失败处理、安装更新与卸载、安全边界）；示例插件 `docs/plugins/examples/code-travel-log/` 注册 `memory` 槽位、`travel_log` 只读工具与 `旅行日志` 块类型，只声明 `files` 只读权限；`code-plugin-examples.test.ts` 5 条测试在 worker 沙箱里按清单权限装载并验证三种扩展点，空权限下验证拒绝与 Trace，另核对文档与解析器常量；门禁通过（192 个测试文件、1695 个测试、5 个跳过）
  做什么：
  - 写代码插件的开发文档：清单、权限、Context API、生命周期与错误处理。
  - 提供示例代码插件并由测试在沙箱里装载运行。
  验收：示例插件在沙箱里装载、注册扩展点并通过权限检查；文档与清单字段一致；`pnpm check` 通过。

- [x] **P4.f P4 验收** | 依赖：P4.b、P4.c、P4.d、P4.e
  完成：2026-11-12 逐条核对 P4 总验收与 P4.a 至 P4.e 的验收标准，复核 I4、I12、I15、I16、I17、I18；5 个测试文件、45 个测试单独重跑通过，`node scripts/check-invariants.mjs` 通过；门禁通过（192 个测试文件、1695 个测试、5 个跳过）；结果写入 `docs/dev/reports/P4.md`
  做什么：
  - 逐条核对 P4 总验收与 I4、I12、I15、I16、I17、I18；写 `docs/dev/reports/P4.md`。
  验收：全部 P4 验收标准通过；`pnpm check` 通过。

- [ ] **P5 应用内插件市场** | 依赖：P4.f、M5-T99 | DESIGN §19.5
  做什么：
  - 在应用内浏览、搜索、安装与更新插件；显示权限与档位；支持从 git 地址安装。
  - 更新检查与版本兼容提示（兼容范围与本机版本不匹配时给出说明）。
  - 发布与上架由人类执行，市场只做浏览与安装。
  验收：市场界面能完成安装与更新；权限展示与 P4 的清单一致；版本不兼容时给提示不安装；发布操作不自动化；`pnpm check` 通过。

## 兼容插件线（DESIGN §6、§9、§19；ADR-0038，取代 C-T00）——依赖 P2，排在内核改造之后

- [x] **C-T01 ST 沙箱与 prompt 一致性测试台**（已拆成 C-T01.a 至 C-T01.d） | 依赖：P2 | DESIGN §6、§9
  完成：2026-11-12 四个子任务全部完成；录制服务在零模型调用下产出请求记录，逐条比对给出覆盖率与差异原因，沙箱与录制数据只在私有目录，共存开关对照入口与四项原生指标报告就绪；C-T02 从这里开始。
  做什么：
  - 把 `D:\SillyTavern\` 的程序与数据复制到 `eval-private/st-sandbox/` 运行；原安装目录只读，不得修改、不得调用任何模型（I14）。
  - 启动本地录制服务，把沙箱里 ST 的 API 地址指向它；录制服务只记录请求，不调用模型。
  - 用 58 个预设 × 卡片 × 对话片段驱动 ST 生成，录下 ST 实际组装的请求；实现逐条比对工具，输出受支持功能的覆盖率与不一致清单（不一致逐条列出原因）。
  - 两种模式（ADR-0041 的 A10）：忠实模式关闭全部原生功能，用于一致性比对，目标是 100% 一致；共存模式按 ADR-0040 执行，不做一致性比对，只做开关对照评测。
  - 净室规则：ST 是 AGPL-3.0，只以录制下来的行为与测试作为规格，不移植或改写 ST 源码；其他上游项目（酒馆助手、MVU 等）逐个确认许可证并写进 `docs/dev/DEPENDENCIES.md`，许可证不允许的直接排除并记录。
  - 沙箱副本、录制结果与比对产物只留在 `eval-private/`，不进入提交。
  总验收（四个子任务完成后由 C-T02 开始前核对）：录制服务在零模型调用下产出请求记录；比对工具对同一输入输出 100% 一致或逐条差异；原安装目录没有被写入；副本与录制数据没有被 git 跟踪；测试台提供「同一批卡开启与关闭兼容插件」的评测入口与原生指标（矛盾率、编造回忆率、盲测胜率、首字延迟）报告，供其余兼容插件共用（ADR-0040 共存验收）。

- [x] **C-T01.a 沙箱副本与零模型录制服务** | 依赖：P2 | ADR-0094
  完成：2026-11-12 `packages/st-compat/src/st-bench/` 新增 `sandbox.ts` 与 `recorder.ts`；`sandbox.ts` 按允许清单复制 ST 程序（`server.js`、`src`、`public`、`default` 等）与指定数据子集，排除第三方前端扩展、服务器插件、`secrets.json`、`settings.json`、缓存与备份，`node_modules` 以 junction 链到源目录，写出 `sandbox.json` 清单（来源、版本、AGPL-3.0、复制与缺失条目）；`recorder.ts` 启动只录制不回源的 OpenAI 兼容 HTTP 服务，记录 chat completions 的请求体、脱敏后的请求头与查询参数到 `requests/NNNNN.json` 与 `index.jsonl`，流式返回 SSE 桩、非流式返回固定桩，正文超限返回 413 且索引只记字节数，可设 `maxRequests` 自动停止，并暴露 `closed`；`st-bench` CLI 提供 `sandbox` 与 `record` 子命令，产物默认落在私有根目录；无新增依赖；真实沙箱副本（`eval-private/st-sandbox/st`，ST 1.18.0，public 59M、src 18M、node_modules junction）与录制冒烟通过；10 个测试通过；门禁通过（193 个测试文件、1705 个测试、5 个跳过）
  做什么：
  - 按允许清单把 ST 程序与驱动器需要的数据子集复制到私有根目录；目标必须在私有根目录内部，源目录只读；`node_modules` 用 junction（Windows）或目录符号链接指向源目录；写 `sandbox.json` 记录来源、版本、许可证、复制与缺失条目。
  - 录制服务只监听本机，记录生成请求的正文、脱敏后的请求头与查询参数，写 `requests/NNNNN.json` 与 `index.jsonl`；生成请求返回固定桩（非流式 JSON、流式 SSE），不持有任何模型客户端；`GET /v1/models` 返回桩模型列表；正文超过上限返回 413 并只记录字节数。
  - `st-bench sandbox` 与 `st-bench record` 两个子命令；所有产物默认写入仓库私有根目录。
  验收：副本只含允许清单内的程序与数据子集，密钥、第三方扩展、服务器插件、缓存与备份不复制；原目录没有被写入；`node_modules` 链接可读；录制服务在非流式与流式请求下都产出记录与桩响应，外呼零次，敏感头脱敏，超限返回 413；目标目录守卫拒绝私有根目录之外与互相包含的路径；副本与录制数据被 git 忽略；`pnpm check` 通过。

- [x] **C-T01.b 沙箱 ST 启动与生成驱动**（已拆成 C-T01.b.a 至 C-T01.b.c） | 依赖：C-T01.a
  完成：2026-11-12 三个子任务全部完成；真实沙箱连跑 5 个组合，每个组合一条录制请求，清单序号范围 0..0 至 4..4，沙箱日志无外呼失败；重复批次跳过已完成组合；失败组合在私有批次里记录原因后继续，后两个组合照常完成；沙箱与录制目录都在 `eval-private/` 下且未被跟踪
  总验收（三个子任务完成后由 C-T01.c 开始前核对）：零模型调用下每个组合产出一条或一组请求记录；run 清单能把每条记录对应回组合；中断后续跑不重复已完成组合；驱动只操作沙箱副本与私有录制目录；失败组合记录原因并继续；沙箱与录制数据不在提交里。

- [x] **C-T01.b.a 沙箱 ST 配置、桩设置与启动器** | 依赖：C-T01.a | ADR-0095
  完成：2026-11-12 `packages/st-compat/src/st-bench/launcher.ts` 新增 `configureSandboxServer` 与 `startSandboxServer`：只接受私有根目录内带 `sandbox.json` 的副本，用 `yaml` 的 Document 改写 `config.yaml`（`listen: false`、仅 IPv4 回环、白名单只允许 `127.0.0.1`/`::1`、关闭访问口令、浏览器启动、扩展与自动更新、缩略图、CORS 代理、请求代理、SSL、主机白名单、聊天备份与访问日志，保留其余键与注释）；写入 `data/default-user/settings.json`，自定义 OpenAI 兼容端点指向录制服务、模型名为桩模型、上下文与输出额度进入 `oai_settings`，不含任何密钥；录制端点只接受回环地址；启动器用当前 Node 运行 `server.js --port`，日志写 `<沙箱>/st-bench-server.log`，轮询首页直到 200（默认 180 秒，覆盖首次 webpack 编译），提前退出或超时终止子进程并报告退出码与日志路径，`stop()` 幂等；CLI 新增 `st-bench serve [--configure-only]`；`packages/st-compat` 新增 `yaml` 依赖并在 DEPENDENCIES.md 登记；真实沙箱冒烟（ST 1.18.0，端口 8899）首页与 `/api/settings/get` 均 200，读回的 `custom_url`、`custom_model` 与写入一致，录制零请求，沙箱配置里的原访问口令已清空；7 个测试；ADR-0095；门禁通过（194 个测试文件、1712 个测试、5 个跳过）
  做什么：
  - 改写沙箱里的 ST 配置与数据根目录，只监听本机端口；写一份不含密钥的 `settings.json`，把自定义 OpenAI 兼容端点指向录制服务，模型名用桩模型。
  - 提供启动器：运行沙箱内 `server.js`，等首页可访问再返回，失败时终止子进程并报告退出码与日志；CLI `serve` 负责配置与启动，`--configure-only` 只写配置。
  验收：配置改写只作用于私有根目录内带清单的副本，原安装目录不会被写；监听地址只有回环，访问口令被清空，扩展不自动更新；`settings.json` 指向回环录制端点与桩模型且不含密钥；录制端点不是回环地址时拒绝；启动器在首页 200 后返回，提前退出与超时都报错且不留子进程；`pnpm check` 通过。

- [x] **C-T01.b.b 组合计划、run 清单与断点续跑** | 依赖：C-T01.b.a
  完成：2026-11-12 `packages/st-compat/src/st-bench/plan.ts` 新增沙箱输入发现、轮转组合计划与追加式 run 清单：预设取 `OpenAI Settings/*.json`、卡取 `characters/` 顶层 PNG/JSON、片段取 `chats/` 递归 `.jsonl`，聊天按行流式统计楼层且首行 `chat_metadata` 不计；三份清单按码点排序后第 i 个组合取 `i % 长度`，组合数为最长一维（`--limit` 只截前缀），组合 id 为三者 SHA-256 前 32 位；`manifest.jsonl` 每行记录组合、楼层、时间、录制序号范围与 `pending`/`running`/`completed`/`failed` 状态，`plan` 为缺记录补 `pending`、完成跳过、中断与失败补 `pending` 重试，`findSandboxRunEntryBySeq` 反查组合；CLI 新增 `st-bench plan`；真实沙箱 36 预设、68 卡、88 片段生成 88 组合，重复运行不新增行；ADR-0096；11 个新测试；门禁通过（195 个测试文件、1723 个测试，5 个跳过）
  做什么：
  - 从沙箱数据读出 58 个预设、卡片与对话片段，生成「预设 × 卡片 × 片段」组合；每个组合写 run 清单（组合、预设、卡、片段、楼层、时间、录制序号范围），完成的组合带完成标记，再次运行时跳过。
  - 清单只写私有目录，只含标识与统计，不含提示词与对话正文。
  验收：同一批数据生成的组合稳定且可复现；中断后重新运行只处理未完成组合；清单能把录制序号范围对应回组合；`pnpm check` 通过。

- [x] **C-T01.b.c Playwright 生成驱动** | 依赖：C-T01.b.a、C-T01.b.b
  完成：2026-11-12 `packages/st-compat/src/st-bench/driver.ts` 新增 `driveSandboxBatch`、`prepareSandboxChat` 与 `sanitizeSandboxPresets`：驱动在进程内启动录制服务与沙箱 ST，用 Playwright 调 `SillyTavern.getContext()` 的预设、角色卡、片段与生成函数，片段复制成 `chats/<角色>/bench-<组合 id>.jsonl`；启动前把 36 个预设的连接字段改写为录制端点、桩模型并清空代理与凭据，切换预设后再用 `/api/settings/get` 复核；每个组合写 `running` 与 `completed`/`failed` 及序号范围，失败重建页面继续；CLI 新增 `st-bench drive`；真实沙箱（ST 1.18.0，端口 8899，录制 8130）连跑 5 个组合，5 条请求、序号 0 至 4、零外呼错误；6 个测试；ADR-0097；门禁通过（196 个测试文件、1729 个测试，5 个跳过）
  做什么：
  - 用 Playwright 打开沙箱 ST 前端，逐个组合选择预设、卡片与对话片段，触发一次生成；生成前确认端点仍是录制服务。
  - 失败组合记录原因并继续；驱动只操作副本与私有录制目录。
  验收：零模型调用下每个组合产出一条或一组请求记录；run 清单能把每条记录对应回组合；失败组合有原因且不阻塞后续；`pnpm check` 通过。

- [x] **C-T01.c 逐条比对与覆盖报告** | 依赖：C-T01.b
  做什么：
  - 把 ST 录制请求与 Dramaticer 在相同输入下组装的请求规范化（消息序列、角色、深度注入位置、预填充、采样参数、模型无关字段），逐条比较并输出覆盖率与差异清单；每条差异写原因与定位。
  - 忠实模式关闭全部原生功能（记忆、台账、导演、写作契约等）后比对，目标是受支持功能 100% 一致；报告只含统计与结构哈希，不含提示词正文。
  验收：同一输入一致时报告 100%；不一致逐条列出原因；覆盖率口径写进报告；`core` 不出现 ST 概念（I1）；报告不含提示词正文；`pnpm check` 通过。
  完成：2026-11-12 `packages/st-compat/src/st-bench/compare.ts` 把 ST 录制请求与忠实模式请求规范化为角色、SHA-256 正文哈希、长度、采样参数与流式开关，逐位比较并输出覆盖率、差异路径与结构哈希；`faithful.ts` 关闭记忆、台账、导演与写作契约，只映射预设条目、角色卡字段、聊天历史、深度注入与预填充，无法映射的功能逐条记入不支持；`core` 静态段增加可选 `role`（默认 `system`）；CLI 新增 `st-bench compare [--sandbox] [--batch] [--limit]`，报告写到批次 `compare/` 且不含正文；驱动改为在生成前打开录制开关、等待片段加载稳定并核对副本名与楼层数；合成测试 8/8 匹配、覆盖率 100%，真实批次采样参数 25/25 一致，消息覆盖率 0%（录制请求缺聊天历史，另立 C-T01.c.a）；ADR-0098；门禁通过（197 个测试文件、1739 个测试，5 个跳过）

- [x] **C-T01.c.a 录制请求与聊天片段一致性** | 依赖：C-T01.c
  完成：2026-11-12 `Default` 的历史被预设上下文预算（4095/300）裁掉，三个 `Gemini Summary` 预设的 `prompt_order` 100001 组没有启用 `chatHistory`；驱动切换预设后把沙箱 `openai_max_context` 抬到 2,000,000 并读回确认，忠实模式改用 100001 组、补 `new_chat_prompt`、按 `names_behavior` 加说话人前缀并修正 `injection_position` 语义；`compare` 新增逐请求历史诊断（片段楼层、进入请求楼层、未包含原因）与 `settings.json` 人设名；重新驱动批次 `compare-smoke4`：`Default` 61/61 楼进入请求，摘要预设 0 楼并给出提示词顺序原因，`GrayWill` 2/2 楼；消息覆盖率 3.80%，采样参数 25/25；ADR-0099；门禁通过（197 个测试文件、1740 个测试，5 个跳过）
  做什么：
  - 用 `st-bench compare` 的报告定位为什么 `Default` 与三个 `Gemini Summary` 组合的录制请求只有 2–3 条系统消息、没有聊天历史；核对驱动打开的副本、ST 的上下文预算与 `chatHistory` 条目。
  - 修复后重新驱动一个小批次，使 ST 录制请求的消息数与片段楼层一致；覆盖率作为 C-T02 的入口基线。
  验收：录制请求包含片段历史，或逐条给出 ST 丢弃历史的原因；`compare` 的差异路径能对应到原因；`pnpm check` 通过。

- [x] **C-T01.d 共存开关对照评测入口与原生指标** | 依赖：C-T01.b、C-T01.c
  完成：2026-11-12 `packages/st-compat/src/st-bench/coexist.ts` 新增 `CoexistPluginAdapter`、`runCoexistComparisons`、`writeCoexistOutputs` 与配置解析：同一批卡在插件关闭与开启时各跑一遍，使用相同角色卡、片段与脚本玩家消息；四项指标复用 R2 的跑后提问、两顺序盲评与 Trace（矛盾率与编造回忆率按题目计数，盲测胜率取开启侧顺序级胜率，首字延迟取 P90）；变差门槛为 5 个百分点、45% 与 1.2 倍加 100 毫秒，样本少于 5 记「样本不足」；报告与 `metrics.json` 只含数字与样本量，不含正文；CLI 新增 `st-bench coexist --config <路径> [--out <目录>]`，输出限制在私有根目录；插件注册表留空供 C-T02–C-T05 追加；新增 3 个测试；ADR-0100；门禁通过
  做什么：
  - 提供「同一批卡在开启与关闭每个兼容插件时各跑一遍」的评测入口，跑原生指标（矛盾率、编造回忆率、盲测胜率、首字延迟），输出两组对比报告；入口供 C-T02–C-T05 共用。
  - 开关由配置控制，原生指标的计算复用 R2 的评测与裁判口径；变差时报告列出差异与样本量。
  验收：开与关两组各跑完同一批卡；四项指标有数字与样本量；报告能指出明显变差的项目；入口不调用玩家本机 ST 额度（I14）；`pnpm check` 通过。

**C-T02 P-A `st-content` 内容与 prompt 组装**（已拆成 C-T02.a 至 C-T02.f） | 依赖：C-T01、P2

  总验收（C-T02.f 逐条核对）：一致性测试覆盖的世界书、预设、宏、正则、卡片与对话导入用例全部通过；导入不丢字段；`core` 不出现 ST 概念（I1）；ST 内容按槽位进入原生预算分配器，Trace 分开显示 ST 与原生内容的 token 占比；写作契约保持在离生成最近的位置，导入时识别预设里的总结类与规划类条目；兼容报告覆盖未识别字段、未知 marker、无法映射的深度与角色、重复条目，且不含提示词正文；ST 正则、宏与 EJS 只作用于 ST 内容，不碰 harness 槽位；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [x] **C-T02.a 角色卡、群聊问候、人设与作者注释映射** | 依赖：C-T01、P2
  完成：2026-11-12 新增 `packages/st-compat/src/st-content/`：`mapCharacterCard` 按酒馆 marker 输出 `charDescription`、`charPersonality`、`scenario`、`main`、`dialogueExamples`、`jailbreak` 六类未改写字段，卡作者注释只作元数据，未知字段、扩展键、内嵌世界书条目数与字符数进入不含正文的报告；`listCharacterGreetings` 与 `selectCharacterGreeting` 分离单聊与群聊问候，群聊优先 `group_only_greetings`；`readStPersona` 读取活动头像、名字、描述、位置、深度、角色与关联世界书，`mapStPersona` 输出 `personaDescription` marker 并把作者注释位置、聊天内深度、非 system 角色与关联世界书记入 issues；`readStAuthorNote` 读取聊天元数据的作者注释；`importCardContent` 返回 `cardMapping`，`dramaticer chat` 打印报告摘要，`renderCharacterPrompt` 复用同一字段映射；新增 16 个测试；ADR-0101；门禁通过（199 个测试文件、1759 个测试、5 个跳过）
  做什么：
  - 先写一致性测试并让它变红：V1/V2/V3、PNG/JSON、群聊问候、人设、作者注释（卡片 `creator_notes` 与聊天作者注释）各一组用例；期望值以 C-T01 录制里的消息内容与 ST 卡片/设置语义为准。
  - 新增 `st-content` 的卡与人物映射：按 ST 的 marker 标识（`charDescription`、`charPersonality`、`scenario`、`dialogueExamples`、`jailbreak`、`main`、`personaDescription`）输出未改写的正文字段，保留卡片原始对象；群聊问候只在群聊场景作为候选，单聊不注入。
  - 读取 ST 的人设设置：活动头像、名字、描述、位置、深度、角色、关联世界书；位置 1 与 2（作者注释上方/下方）与位置 3（聊天内按深度）保留元数据并逐条记入无法原生映射的原因。卡片作者注释只作为元数据与报告，不进入提示词。
  - 兼容报告只含字段名、标识、字符数、条目数与原因，不含任何提示词正文；导入不丢字段，未知字段进入报告。
  验收：一致性测试的卡片、群聊问候、人设与作者注释用例全部通过；V1/V2/V3、PNG/JSON 的字段与原始对象保持；群聊问候在单聊不进入候选、在群聊进入候选；人设位置、深度、角色与关联世界书可读；卡片作者注释不进入提示词；报告不含正文；`pnpm check` 通过。

- [x] **C-T02.b 预设与 prompt 顺序** | 依赖：C-T02.a
  完成：2026-11-12 新增 `packages/st-compat/src/st-content/preset-mapping.ts`：`mapStPreset` 按 `prompt_order`（100001 优先）生成原生模板，普通条目变静态段、`chatHistory` 变 history 槽位、`worldInfoBefore` 变 lore 槽位，卡片 `system_prompt` 与 `post_history_instructions` 覆盖 `main` 与 `jailbreak`；`scenario_format` 与 `personality_format` 替换占位符，其余宏记问题留给 C-T02.d；绝对位置条目收集为深度注入，`createStHistoryProvider` 按酒馆语义叠加到历史消息（深度 0 在最后，同一深度按顺序组与角色排列，扩展提示词接在预设正文之后），包装器用内容哈希更新 `packKey`；作者注释三种位置与玩家楼层间隔、人设提示词内/聊天内位置均接入模板与槽位，作者注释上下方与无法映射条目逐条记入不含正文的报告；采样只映射 temperature、openai_max_tokens 与可识别的 reasoning_effort，其余字段与 prefill、continue、squash 逐条说明；写作契约固定为最后一段；`selectStPromptOrderGroup` 移到 `preset.ts` 供忠实模式共用；新增 14 个测试；ADR-0102；门禁通过
  做什么：`prompt_order`、深度注入、角色、预填充、续写预填充、squash、format 字段、采样参数；把 C-T02.a 的卡、人设与作者注释映射成原生模板段落与槽位，未映射条目逐条记入报告。先写一致性测试。
  验收：预设一致性用例通过；写作契约保持在最后；无法映射的条目有原因；`pnpm check` 通过。

- [x] **C-T02.c 世界书完整激活语义** | 依赖：C-T02.b
  完成：2026-11-13 新增 `st-content/world-info-activation.ts`，纯函数 `activateStWorldInfo` 实现主次关键词与四种逻辑、正则关键词、大小写与整词、递归与 `preventRecursion`/`excludeRecursion`/`delayUntilRecursion`、sticky/cooldown/delay、分组覆盖与组内权重、组内评分、概率、扫描深度、全局扫描字段、位置/深度/角色、outlet、token 与时间预算；`createStWorldInfoProviders` 把 before/after 送进原生 `lore` 槽位并应用 `wi_format`，深度条目经历史包装器注入，两者共用激活结果并跨轮保存计时状态；`mapStPreset` 的两个世界书 marker 合并到同一 `lore` 槽位并返回 `worldInfo.before/after`；`StWorldInfoEntry` 补六个扫描范围标志，角色卡内嵌世界书补齐位置、深度、角色、分组、概率、计时效果与 outlet 等字段；新增 23 个测试；ADR-0103；门禁通过
  做什么：主次关键词与逻辑、正则关键词、递归、sticky/cooldown/delay、分组与组内权重、概率、扫描深度、位置/深度/角色、outlet；按 ST 语义在插件里实现，结果交给原生槽位预算。
  验收：世界书一致性用例通过；激活结果与录制一致；扫描深度与递归受时间预算约束；`pnpm check` 通过。

- [x] **C-T02.d 宏与正则** | 依赖：C-T02.c
  完成：2026-11-13 新增 `st-content/macros.ts`（`createStMacroEngine` 复刻酒馆旧宏引擎：环境宏与展开顺序、`setvar`/`getvar`/`addvar`/`incvar`/`decvar` 与 global 版本、`random`/`pick`/`roll`、对话、时间、outlet、屏蔽词与后处理）与 `st-content/regex.ts`（`parseStRegexScript`、`collectStRegexScripts` 按全局→角色卡→预设收集并受允许开关约束、`applyStRegexScripts` 复刻位置、只影响显示、只影响 prompt、编辑开关与深度筛选、`runStRegexScript` 复刻 `$1`/`$<name>`/`{{match}}`/`trimStrings`/`substituteRegex`）；`mapStPreset` 的预设条目、卡片 marker、人设注入与作者注释在写入前替换宏，`activateStWorldInfo` 用同一替换函数处理关键词与正文并让替换后的正文进入递归缓冲与 token 预算，激活结果按 `WORLD_INFO` 位置执行 promptOnly 正则并带深度；新增 23 个测试与 ADR-0104
  做什么：完整宏引擎与完整正则语义；只作用于来自 ST 的内容，不碰 harness 槽位；正则作用范围、只影响显示、只影响 prompt、深度限制与宏替换与 ST 一致。
  验收：宏与正则一致性用例通过；原文不被修改；作用范围受控；`pnpm check` 通过。

- [x] **C-T02.e 对话 jsonl 导入导出** | 依赖：C-T02.d
  完成：2026-11-13 `chat-jsonl.ts` 新增 `StChatDocument` 与文档收集、序列化、文件写入，解析与序列化往返逐字节一致；`importChatToStore` 返回源文档；新增 `chat-export.ts` 从当前 head 路径导出消息、兄弟楼层作为 swipe、变量由 `mvu` 快照还原，传入源文档时补回头部元数据、未知字段、`swipe_info`、`extra`、原始 `send_date` 与编辑前的 swipe 文本；9 个测试；ADR-0105；门禁通过
  做什么：对话 jsonl 的导入导出；保留 swipe、变量快照、头部元数据与未知字段；导出尽力而为。
  验收：导入导出往返不丢已支持字段；原文不变；`pnpm check` 通过。

- [x] **C-T02.f 兼容报告与共存评测接入** | 依赖：C-T02.a 至 C-T02.e
  完成：2026-11-13 `StPresetEntryMapping` 增加 token 估算；新增 `st-content/compat-report.ts` 汇总启用条目 token 规模、未识别 marker、角色卡未知字段与扩展键、无法映射的深度与角色、重复条目、总结类与规划类条目、世界书启用规模，报告与摘要不含正文；`classifyStPresetEntry` 按标识与名称分类；CLI 新增 `st-bench preset --preset <路径> --card <路径> [--out <路径>]`；共存配置卡支持 `preset`，`ST_BENCH_COEXIST_PLUGINS` 注册 `st-content` 适配器（宏替换、ST 世界书槽位、深度注入、`st-content：` Trace 来源），开关两组各跑 5 轮、四项指标均有数字与样本量；新增 6 个测试；ADR-0106；门禁通过（205 个测试文件、1834 个测试、5 个跳过）
  做什么：汇总兼容报告（启用条目 token 规模、未识别 marker 与字段、无法映射的深度与角色、重复条目）；在 `ST_BENCH_COEXIST_PLUGINS` 注册 `st-content` 适配器；开启与关闭对照评测。
  验收：报告覆盖要求且不含正文；开关对照四项原生指标有数字与样本量；变差时列出项目；`pnpm check` 通过。

**C-T03 P-C `st-mvu` MVU 兼容**（已拆成 C-T03.a 至 C-T03.d） | 依赖：C-T02

  总验收（四个子任务全部完成后由 C-T03.d 逐条核对）：一致性测试的 MVU 用例全部通过；非法更新经结算器修复或拒绝并留 Trace；原楼层原文不可修改（I4）；MVU 变量与台账是同一套数据，没有第二份事实，读取路径与结算路径的测试证明这一点；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [x] **C-T03.a MVU 变量引擎** | 依赖：C-T02
  完成：2026-11-13 新增 `packages/st-compat/src/st-mvu/`：`initvar` 读取 `[initvar]` 条目（YAML/JSON、代码块、`<initvar>` 块）、多条目深度合并与开场白覆盖；`$meta` 提取 `extensible`、`required`、`recursiveExtensible`、`template`、`$__META_EXTENSIBLE__$`、`$arrayMeta`、根级 `strictSet`/`strictTemplate`/`concatTemplateArray` 并生成与酒馆同形的结构；`<UpdateVariable>`/`<JSONPatch>` 支持 `replace`、`delta`、`insert`/`add`、`remove`、`move`、JSON Pointer 与 `/-`；`[值, 说明]` 保留说明，`strictSet` 关闭隐式保留；每条操作在副本上执行并按结构校验，非法条目逐条拒绝并给出路径，原型污染键被拒绝；17 个测试；ADR-0107；门禁通过（206 个测试文件、1851 个测试、5 个跳过）
  做什么：
  - 先搭一致性测试并让它变红，再实现纯函数引擎：`initvar`（世界书 `[initvar]` 条目、YAML/JSON、多条目合并、开场白 `<initvar>` 覆盖）、`$meta`（`extensible`、`required`、`recursiveExtensible`、`template`、`$__META_EXTENSIBLE__$`、`$arrayMeta`、根级 `strictSet`/`strictTemplate`/`concatTemplateArray`）与生成的变量结构。
  - `<UpdateVariable>` 与 `<JSONPatch>` 解析（`replace`、`delta`、`insert`/`add`、`remove`、`move`，JSON Pointer 与 `/-`）；`[值, 说明]` 的保留与 `strictSet`；按变量结构校验类型、必填键与可扩展性，非法操作逐条拒绝并给出原因。
  - 引擎只操作传入的状态，不读写存储、不调用模型。
  验收：以上每种语义各有一致性用例；非法 JSON、未知操作、越界路径、必填键删除、锁定结构写入都被拒绝并指出位置；`pnpm check` 通过。

- [x] **C-T03.b 台账命名空间与待结算视图** | 依赖：C-T03.a
  完成：2026-11-13 新增 `core/src/ledger/pending.ts`（`PendingLedgerView`：读台账快照、按 `validateLedgerDiff` 逐条收下写入、叠加读取待结算值、提交后重新从台账读取；限定前缀时拒绝前缀之外的路径）与 `state.ts` 的 `applyDiffEntriesTo`；新增 `st-mvu/ledger.ts` 的 `MvuLedgerSession`（台账没有 `mvu` 子树时把 initvar 初始值作为待结算写入；`applyMvuPatch` 后只对变化路径生成 `["mvu", ...]` 写入，补丁与写入的拒绝原因进 Trace，提交结果给出删除修复记录）；常规结算窗口把已写入路径视为已覆盖，不用模型提案覆盖；ADR-0108；新增 9 个测试（core 5、st-compat 4）；无 schema 变更、无新增依赖；门禁通过（208 个测试文件、1860 个测试、5 个跳过）
  做什么：
  - 把 MVU 变量写入台账 `mvu` 命名空间，写入前经过结算器校验与修复（I12），修复与拒绝原因进入 Trace；变量与台账是同一套数据。
  - 插件内的临时视图：脚本写变量后立刻读取先读到待结算值，结算完成后以台账为准。
  验收：读取路径与结算路径的测试证明只有一份事实；非法更新经结算器修复或拒绝并留 Trace；`pnpm check` 通过。

- [x] **C-T03.c 消息修改分类与显示状态** | 依赖：C-T03.b
  完成：2026-11-13 新增 `core/src/plugins/display-state.ts`（`PluginDisplayState`：按楼层与插件分桶，`display` 与 `metadata` 分开，值校验为有限 JSON，只在当前会话存在）与 `core/src/plugins/message-modification.ts`（`classifyMessageModification` 只接受正文、显示、元数据中的一类；`applyMessageModification` 对正文修改追加同父同角色的兄弟楼层，原楼层逐字节不变，显示与元数据修改只写显示状态）；新增 `st-mvu/message.ts`（`applyMvuMessageChange` 分派 `content`、`statusBar`、`metadata`；状态栏刷新要求原文含 `<StatusPlaceHolderImpl/>`，只写 `st-mvu` 的 `display.statusBar`，占位符留在原文；`readMvuStatusBar` 读回）；插件改写正文不写偏好记录；新增 12 个测试（core 7、st-compat 5）与 ADR-0109；无 schema 变更、无新增依赖
  做什么：
  - 改正文的类型生成新 swipe，不修改原楼层原文（I4）；只改显示或元数据的类型写进插件显示状态，不新建节点。
  - 状态栏刷新、`<StatusPlaceHolderImpl/>` 等显示副作用不进入台账，也不写楼层。
  验收：改正文生成新 swipe 且原楼层逐字节不变；显示状态不新建节点；`pnpm check` 通过。

- [x] **C-T03.d MVU 一致性测试与共存评测** | 依赖：C-T03.a 至 C-T03.c
  完成：2026-11-13 新增 `buildMvuCardInitState`（世界书 `[initvar]` 与开场白 `<initvar>` 合并，坏条目只记原因，无变量时返回 null）与 `st-bench/st-mvu-plugin.ts` 适配器（`apply` 只读初始变量，`afterTurn` 每轮解析 `<UpdateVariable>` 经 `MvuLedgerSession` 写台账并校验原文未变）；`CoexistPluginAdapter` 增加可选 `afterTurn`，`ST_BENCH_COEXIST_PLUGINS` 注册 `st-mvu`；新增一致性用例 6 个（卡级初始变量、一轮写入与 Trace、多块与围栏、结构往返校验、结算覆盖）与共存用例 2 个，合成批次四项指标 0%/0%（8/8）、0%/0%（4/4，样本不足）、80%（10/10）、首字 P90 0/1 毫秒（5/5），无变差项；`docs/dev/reports/C-T03.md` 逐条核对总验收并记录 zod 结构校验口径；ADR-0110；门禁通过
  做什么：
  - 补齐 MVU 一致性用例并逐条核对 C-T03 总验收；在 `ST_BENCH_COEXIST_PLUGINS` 注册 `st-mvu`，开启与关闭各跑一批，报告四项原生指标与样本量（ADR-0040）。
  - 记录变量结构（zod 卡生成的 schema）的校验口径；需要执行卡内 zod 脚本时复用酒馆助手宿主（C-T05）的沙箱。
  验收：C-T03 总验收逐条通过；开关对照四项指标有数字与样本量，变差时列出项目；`pnpm check` 通过。

- **C-T04 P-B `st-ejs` Prompt Template 兼容**（已拆成 C-T04.a 至 C-T04.d） | 依赖：C-T03
  做什么：
  - 先搭一致性测试并让它变红，再实现：世界书条目与预设里的 EJS 模板，包括 `getvar`/`setvar` 等函数、装饰器、激活正则与世界书条目的能力；模板在沙箱里执行。
  - 执行隔离（ADR-0041 的 A10）：EJS 在 worker 里执行，`node:vm` 不作为安全边界；模板发起的生成按卡限流并计入后台预算。
  - 作用范围：ST 正则、宏与 EJS 只作用于 history 槽位里的 ST 内容，不碰记忆、台账、导演与写作契约等 harness 槽位。
  总验收（C-T04.d 逐条核对）：EJS 模板的一致性用例全部通过；沙箱逃逸测试通过；模板执行不影响台账事实（I12）；EJS 只作用于来自 ST 的内容，不修改 harness 槽位；模板执行与世界书递归激活计入回合内时间预算，超时写入 Trace；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [x] **C-T04.a EJS 模板解析与变量函数库** | 依赖：C-T03 | ADR-0111
  完成：2026-11-13 新增 `packages/st-compat/src/st-ejs/`：`createStEjsRuntime` 用 `ejs` 编译模板，`locals.__append` 与 `print(...args)` 按调用顺序收集输出，`<%=` 走可配置格式化（生成阶段原样、消息渲染后续接入格式化），`<#escape-ejs>` 与 HTML 转义还原按上游文档处理，错误包装成带来源与行号的 `StEjsTemplateError`；`StEjsVariableStore` 实现 `initial`/`global`/`local`/`message`/`cache` 五个作用域与文档规定的合并顺序、`getvar`/`setvar`/`incvar`/`decvar`/`delvar`/`insvar` 及三种作用域别名、`nx`/`xx`/`nxs`/`xxs`、`old`/`new`/`fullcache`、`merge`、`dryRun` 与准备阶段写保护，每次写入记一条 `StEjsVariableWrite`；函数库另有 `define`（绑定 `this`）、`evalTemplate`（同运行时递归，上限 16 层）、`getChatMessage`/`getChatMessages`/`matchChatMessages`、`injectPrompt`/`getPromptsInjected`/`hasPromptsInjected`；原型污染路径与非法选项直接拒绝；`ejs`、`lodash` 与类型包登记进 `DEPENDENCIES.md`；新增 26 个测试；门禁通过
  做什么：
  - 用 `ejs` 编译模板，提供 `print`、`define`、`evalTemplate` 与 `getvar`/`setvar`/`incvar`/`decvar`/`delvar`/`insvar` 及作用域别名。
  - 变量按 `initial`、`global`、`local`、消息四层合并；写入默认落消息变量并同步合并视图；支持条件写入、返回类型、深合与准备阶段写保护。
  - 提供楼层读取与 prompt 注入函数；非法选项、非法路径与超深递归直接抛错。
  验收：模板语法、`print` 输出位置、格式化开关、转义区域、错误来源与行号有测试；五个作用域、四种条件、三种返回类型、深合、准备阶段写保护、整棵树替换、增减删插与作用域别名有测试；写入记录完整；原型污染路径被拒绝；`pnpm check` 通过。

- **C-T04.b 装饰器、激活正则与世界书条目能力**（已拆成 C-T04.b.a 与 C-T04.b.b） | 依赖：C-T04.a

- [x] **C-T04.b.a 装饰器、内容注入与激活正则** | 依赖：C-T04.a
  完成：2026-11-13 新增 `st-ejs/decorators.ts`（`parseStEjsDecorators` 解析内容开头 17 个装饰器，未知行丢弃并记录，`@@@` 行按原文保留，`@@if` 表达式用模板局部变量求值并带表达式原文报错）、`st-ejs/injection.ts`（`[GENERATE|RENDER:BEFORE|AFTER]`、带下标、`REGEX` 标记与 `@INJECT` 的 `pos`/`target`/`regex`/`order`/`role` 拆成注入条目，`[InitialVariables]` 先 JSON 再 YAML 并写进 `initial` 作用域）、`st-ejs/activate-regex.ts`（`basic`/`generate`/`message`/`html`/`before`/`minDepth`/`maxDepth`/`order`/`sticky`，字符串 pattern 复用酒馆正则解析，替换函数绑定 `this.getvar` 等运行时上下文并记录写入）；新增 31 个测试；ADR-0112；门禁通过（217 个测试文件、1937 个测试、5 个跳过）
  做什么：
  - 解析世界书内容开头的 `@@` 装饰器：`@@activate`、`@@dont_activate`、`@@message_formatting`、`@@generate_before`/`@@generate_after`、`@@render_before`/`@@render_after`、`@@dont_preload`、`@@preload`、`@@only_preload`、`@@initial_variables`、`@@always_enabled`、`@@private`、`@@if`、`@@iframe`、`@@preprocessing`；未知装饰器行丢弃，`@@@` 前缀按原文保留。
  - 内容注入：`[GENERATE:BEFORE]`/`[GENERATE:AFTER]`、`[GENERATE:{idx}:BEFORE]`/`[GENERATE:{idx}:AFTER]`、`[GENERATE:REGEX:pattern]`、`[RENDER:*]`、`[InitialVariables]`（JSON 优先、再按 YAML 解析）；`@INJECT` 的 `pos`、`target`、`regex` 三种位置与 `order`/`role`。
  - `activateRegex(pattern, replacement, options)`：`basic`、`generate`、`message`、`html`、`before`、`minDepth`/`maxDepth`、`order`、`sticky`，替换内容可以是函数并绑定运行时上下文。
  验收：每个装饰器与注入形式有测试；未知装饰器被丢弃、`@@@` 转义保留；激活正则的每种选项有测试且替换函数拿到 `this.getvar`；`pnpm check` 通过。

- [x] **C-T04.b.b 世界书与数据读取函数** | 依赖：C-T04.b.a
  完成：2026-11-13 新增 `st-ejs/world-info.ts`（同世界书省略、递归激活、强制激活表、激活数据与候选过滤、token 预算与嵌套上限）、`st-ejs/data.ts`（角色卡、预设、快捷回复读取与 `qrList` 归一）、`st-ejs/json.ts`（严格 JSON 与 YAML 宽松回退、RFC 6902 全部操作）、`st-ejs/schema.ts`（变量结构校验）；`StEjsRuntime` 暴露全部函数并接入模板局部变量，`patchVariables` 与 `setVariableSchema` 生效；新增 24 个测试；ADR-0113；门禁通过（220 个测试文件、1961 个测试、5 个跳过）
  做什么：
  - 世界书与数据读取：`getwi`/`getWorldInfo`（含递归与同世界书省略世界书名）、`activewi`/`activateWorldInfo`、`activateWorldInfoByKeywords`、`getWorldInfoData`、`getWorldInfoActivatedData`、`getEnabledWorldInfoEntries`、`selectActivatedEntries`，以及 `getchar`/`getCharData`/`getpreset`/`getqr`/`getQuickReplyData`。
  - `parseJSON`、`jsonPatch`、`patchVariables`、`setVariableSchema`。
  验收：世界书递归与同世界书省略参数有测试；`getwi` 的结果再次进入模板处理与 token 预算；JSON 与补丁函数有测试；`pnpm check` 通过。

- **C-T04.c worker 隔离、时间预算与流水线接入**（已拆成 C-T04.c.a 至 C-T04.c.d） | 依赖：C-T04.b.b
  总验收：沙箱逃逸测试通过（模板拿不到 `process`、`require`、文件系统与网络）；超时用例留下 Trace 且回合继续；EJS 只修改 ST 内容，harness 槽位逐字节不变；变量读写与 MVU 是同一份数据且有测试；模板发起的生成作为后台任务且按卡限流；`pnpm check` 通过。

- [x] **C-T04.c.a 沙箱执行与超时重建** | 依赖：C-T04.b.b
  完成：2026-11-13 新增 `st-ejs/sandbox.ts`（worker 内每个执行新建 `node:vm` 上下文，EJS 在 worker 里编译成源码后于上下文里求值；模板函数按允许清单在上下文里定义，经同步 RPC 回到主线程的运行时执行，结果写 `SharedArrayBuffer` 后 `Atomics.notify`；变量快照与函数回包用带标记的 JSON 编解码；默认 5 秒预算，超时终止 worker 并重新启动，执行记录带来源、耗时、结果、原因与调用过的函数）；`StEjsRuntime` 增加 `executor` 选项、`setExecutor`、`#functionTable`、`listSandboxFunctions`、`invokeSandboxFunction` 与 `formatEscapedValue`，`#render` 在沙箱模式下只准备文本；新增 10 个测试（逃逸、超时重建、变量写入、`print`/`define`/`evalTemplate`、世界书嵌套渲染、允许清单）；ADR-0114；门禁通过（221 个测试文件、1971 个测试、5 个跳过）
  做什么：
  - 模板编译在 worker 里进行，模板函数在 `node:vm` 上下文里执行；主线程只传模板文本、变量快照、允许的函数清单与格式化方式，函数调用经同步 RPC 回到主线程执行，沙箱里拿不到任何主线程对象。
  - 超时终止 worker 并重建，执行记录带来源、耗时、结果、跳过原因与调用过的函数名。
  验收：模板拿不到 `process`、`require`、`fetch`、`Buffer`、动态 `import` 与文件系统；超时后同一沙箱能继续执行下一次渲染；变量读写、`print`、`define`、`evalTemplate` 与嵌套世界书渲染在沙箱里输出与主线程渲染一致；`pnpm check` 通过。

- [x] **C-T04.c.b 回合内时间预算与 Trace** | 依赖：C-T04.c.a
  完成：2026-11-13 `runTurnHook` 的 `run` 回调拿到 `TurnHookBudget`（`budgetMs`、`remainingMs()`、`recordTemplate()`），钩子结束时把模板执行记录写进 `TurnHookTraceEntry.templates`，钩子结束后不再接收记录；`ContextSlotRequest` 增加可选 `budget`，组装器在插件槽位里传入同一次钩子的预算；`StEjsRuntime.render` 支持 `budget`，每次执行按 `remainingMs()` 限制，超时按空内容处理并把来源、耗时、原因与函数写进预算，嵌套 `getwi` 沿用同一预算；`StEjsSandbox.run` 接受 `budgetMs` 覆盖默认预算；`dramaticer explain` 逐条列出模板执行并对超时模板给出建议；新增 8 个 st-compat 测试、3 个 core 钩子测试与 1 个 explain 测试；ADR-0115；门禁通过（222 个测试文件、1984 个测试、5 个跳过）；会话 346 修复门禁：`remainingMs()` 预留 50 毫秒收尾时间，模板按子预算先于外层截止超时，钩子记录后正常返回。
  做什么：
  - 每次模板执行计入回合内时间预算，超时跳过该条并写 `TurnHookTraceEntry`（来源、耗时、跳过原因、调用的函数），`dramaticer explain` 能读到。
  验收：超时用例的 Trace 可在 `dramaticer explain` 输出里读到，回合继续；未超时也记录耗时；`pnpm check` 通过。

- [x] **C-T04.c.c st-content 流水线接入与变量视图** | 依赖：C-T04.c.b
  完成：2026-11-13 新增 `st-content/ejs-pipeline.ts`（`StEjsContentPipeline`：每回合一个运行时与沙箱，`beginTurn`/`renderTemplate`/`wrapProviders`/`dispose`；只渲染预设静态段与 `history`、`lore` 槽位，跳过写作契约与 harness 槽位；`createStEjsTurnBudget` 与 `hasStEjsMarkup`）；`st-ejs/variables.ts` 新增 `StEjsVariableBackend`，`initial` 层接台账 `mvu` 子树（`PendingLedgerView` 读写，stage 后 commit，拒绝直接抛错），global 与消息变量留在插件存储；`StEjsRuntimeOptions.backend` 透传；`CoexistApplyResult` 新增 `prepareTurn` 与 `dispose`，st-content 适配器每轮渲染预设静态段并在结束时释放；新增 5 个测试；ADR-0116；门禁通过（223 个测试文件、1989 个测试、5 个跳过）。
  做什么：
  - 接入 `st-content` 的预设、世界书与深度注入：EJS 只作用于来自 ST 的内容，进入槽位前完成；不碰记忆、台账、导演与写作契约等 harness 槽位。
  - 变量来源接到 ST 的变量视图：与 MVU 使用同一份台账数据（`mvu` 子树），读经台账快照，写经待结算视图与结算器校验；全局与消息级变量留在插件自己的存储里，不新建台账事实。
  验收：EJS 只修改 ST 内容，harness 槽位逐字节不变；变量读写与 MVU 是同一份数据且有测试；`pnpm check` 通过。

- [x] **C-T04.c.d 模板发起的生成** | 依赖：C-T04.c.c
  完成：2026-11-13 新增 `st-ejs/generation.ts`（`StEjsGenerationScheduler` 只登记请求并返回 id，`drain` 在间隙逐条执行；卡级待执行上限默认 4，超出抛 `StEjsGenerationLimitError`；计数与回合正文调用分开；单条失败记录错误后继续；`createStEjsBackgroundGenerationRunner` 用注入的后台 `LlmClient` 构造 system 与 user 消息）；`StEjsRuntime` 新增 `generate`/`getGenerated`，没有队列或参数非法时直接报错；`StEjsContentPipelineOptions` 新增 `generation` 与 `cardId`，流水线把请求绑定到当前故事、卡与楼层；新增 9 个测试；ADR-0117；门禁通过（224 个测试文件、1998 个测试、5 个跳过）。
  做什么：
  - 模板发起的生成按卡限流并作为后台任务执行，不进入回合内（I6、I11）。
  验收：模板发起的生成走后台渠道、单独计数并受卡级限流；回合内不等待生成；`pnpm check` 通过。

- [x] **C-T04.d EJS 一致性测试与共存评测** | 依赖：C-T04.a 至 C-T04.c
  完成：2026-11-13 新增 `packages/st-compat/test/st-ejs-consistency.test.ts` 18 个测试（世界书、预设、角色卡、对话片段四类用例表逐条记录上游文档行为与期望输出；预设/history/lore 执行 EJS，写作契约与 harness 槽位逐字节不变；变量写经结算器落成 `mvu` 事实且原文不变）；`CoexistPluginAdapter` 新增可选 `baseline`，关闭组可执行“同一份 ST 内容、只关掉本插件”；`buildStContentCoexistResult(input, { ejs })` 拆出 EJS 开关并修正首轮无楼层时也渲染预设静态段；新增 `st-bench/st-ejs-plugin.ts` 并注册 `st-ejs`；合成批次矛盾率 0%/0%（8/8）、编造回忆率 0%/0%（4/4，样本不足）、盲测胜率 100%（10/10）、首字 P90 1/0 毫秒（5/5），无变差项；`docs/dev/reports/C-T04.md` 逐条核对总验收；ADR-0118；门禁通过（226 个测试文件、2017 个测试、5 个跳过）。
  做什么：
  - 用世界书、预设、卡片与对话片段组成 EJS 一致性用例表，逐条记录期望输出与来源（上游文档行为）；在 `ST_BENCH_COEXIST_PLUGINS` 注册 `st-ejs` 适配器，开启与关闭各跑一批。
  - 报告四项原生指标与样本量；变差时列出项目；写 `docs/dev/reports/C-T04.md`，逐条核对 C-T04 总验收。
  验收：一致性用例全部通过；开关对照四项指标有数字与样本量；报告不含正文；`pnpm check` 通过。

- **C-T05 P-D `st-helper-host` 酒馆助手宿主**（已拆成 C-T05.a 至 C-T05.f） | 依赖：C-T04
  做什么：
  - 先搭一致性测试并让它变红，再实现：执行酒馆助手脚本、角色卡内脚本、HTML 状态栏与开场页；运行在沙箱 iframe 里，提供与酒馆助手 API 对齐的变量读写、事件监听、`triggerSlash`/STscript、生成、读消息、改消息。
  - 修改消息一律映射成新建楼层或新的 swipe，不修改原文（I4）；只改显示或元数据的写进插件显示状态，不新建节点。
  - 执行隔离（ADR-0041 的 A10）：脚本在沙箱 iframe 里运行，`node:vm` 不作为安全边界；脚本发起的生成按卡限流并计入后台预算。
  总验收（C-T05.f 逐条核对）：酒馆助手 API 覆盖率与一致性测试达到提案口径；修改消息不触碰原文；脚本在沙箱里运行；脚本发起的生成一律作为后台任务执行并在 Trace 里单独计数，走后台渠道、不进入回合内；脚本与正则的变量写入经过结算器；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [x] **C-T05.a 脚本库发现与宿主会话 API** | 依赖：C-T04 | I4、I12
  完成：2026-11-13 新增 `packages/st-compat/src/st-helper-host/`：`scripts.ts` 严格读取角色卡 `extensions.tavern_helper.scripts`（启用与禁用脚本、重复 id 与字段类型错误），`variables.ts` 把七个变量函数映射到 EJS 变量存储（`character` 经台账后端写 `mvu`，`preset`/`script` 留会话），`events.ts` 提供六个事件函数与 `tavern_events` 常量，`messages.ts` 把消息 API 映射到 head 路径（改正文生成兄弟楼层、`is_hidden` 写显示状态、`swipe_id` 切换 head），`host.ts` 组装会话与覆盖清单；`ejs-pipeline.ts` 导出 `createStEjsMvuVariableBackend` 供共用；新增 12 个测试；ADR-0119；门禁通过（227 个测试文件、2029 个测试、5 个跳过）
  做什么：
  - 从角色卡 `extensions.tavern_helper.scripts` 严格读取脚本库（`id`、`name`、`content`、`enabled`、`type`、`info`、`button`、`data`），保留禁用脚本；重复 id 或结构错误直接抛错并指出位置。
  - 宿主会话提供变量、事件与消息三组 API：变量 `getVariables`/`replaceVariables`/`insertOrAssignVariables`/`updateVariablesWith`/`getVariable`/`insertOrAssignVariable`/`deleteVariable`；事件 `eventOn`/`eventOnce`/`eventEmit`/`eventRemoveListener`/`eventClearEvent`/`eventClearAll` 与 `tavern_events` 常量；消息 `getChatMessages`/`getChatMessage`/`getLastMessageId`/`getCurrentMessageId`/`setChatMessages`。
  - 变量与 EJS 共用 `StEjsVariableStore`：`message`、`chat`、`global` 用插件的消息、局部与全局作用域；`character` 落台账 `mvu` 并经结算器校验；`preset`、`script` 留在宿主会话。改正文走 `applyMessageModification` 生成新 swipe，只改 `is_hidden` 写插件显示状态，`swipe_id` 切换 head。
  验收：脚本库覆盖启用与禁用、重复 id 与结构错误；七个变量函数、六个事件函数与五个消息函数各有测试；改正文不触碰原文并生成兄弟楼层；只改显示不新建楼层；`character` 写入经结算器成为台账事实；`pnpm check` 通过。

- [x] **C-T05.b 沙箱 iframe 执行与权限声明** | 依赖：C-T05.a | ADR-0041（A10）、I18
  完成：2026-11-13 新增 `st-helper-host/sandbox.ts`：`st-helper:run/call/result/event/clear/done/ready` 纯 JSON 协议，`parseStHelperSandboxPermission` 严格解析 `{ kind: "st-helper", apis }` 白名单（未知、重复、依赖缺失直接抛错），`StHelperSandboxHost` 负责权限判定、API 分派、事件 token 桥接、执行计时与 Trace；未声明调用拒绝并记录，超时执行调用 `terminate` 并清掉该执行的监听器，之后仍可启动新脚本；新增 `packages/web/src/chat/helper-sandbox.ts`：`sandbox="allow-scripts"` 文档带 `default-src 'none'` CSP、无 `allow-same-origin`，脚本经内联 `<script>` 执行，宿主 API 按白名单生成异步包装，`updateVariablesWith` 在 iframe 内组合；新增 7 个 st-compat 测试、5 个 web 测试、2 个 Playwright 逃逸与超时用例；ADR-0120；门禁通过（229 个测试文件、2041 个测试、5 个跳过）
  做什么：把 C-T05.a 的宿主 API 通过 `postMessage` 暴露给沙箱 iframe；脚本在 iframe 里执行，拿不到主线程对象、文件系统与网络；代码插件权限声明列出脚本可用的 API，未声明的调用被拒绝并记录；脚本死循环或超时被终止，原因写进 Trace。
  验收：逃逸测试通过；超时终止后宿主仍可继续；未声明权限的调用被拒绝并记录；`pnpm check` 通过。

- [x] **C-T05.c `triggerSlash` 与 STscript 子集** | 依赖：C-T05.b
  完成：2026-11-13 新增 `st-helper-host/slash.ts`：`StHelperSlashRunner` 支持变量读写与作用域别名、`messages`/`hide`/`unhide`/`addswipe`/`swipe` 的楼层映射、`pass`/`echo`、`gen`/`genraw` 经注入的 `generateQuiet` 执行安静生成；管道、双引号与转义按上游口径解析，未知命令与未知参数直接失败并指出名称；`addswipe` 追加同父楼层且默认不切换 head，`swipe` 在兄弟楼层之间循环切换；沙箱权限新增 `slash` 分组，宿主异步返回 Promise 结果并在执行结束后丢弃迟到响应；新增 12 个测试；ADR-0121；门禁通过
  做什么：实现酒馆助手脚本常用的 STscript 子集（变量读写、消息读取与修改、聊天切换、安静生成、管道与引号），`triggerSlash` 返回结果字符串；未实现的命令抛错并指出命令名。
  验收：每个受支持命令有测试；命令改写消息仍映射为新 swipe；未知命令失败并指出命令名；`pnpm check` 通过。

- [x] **C-T05.d 脚本发起的生成后台化** | 依赖：C-T05.c、C-T04.c.d | I6、I11
  完成：2026-11-13 新增 `st-helper-host/generation.ts` 的 `StHelperGenerationQueue`，复用 EJS 的 `StEjsGenerationScheduler` 共享卡级上限（默认 4）；`/gen`、`/genraw` 只登记后台请求并返回 id，新增 `/genresult <id>` 读取正文；`StEjsGenerationDrainOptions` 增加 `ids` 过滤，队列 `drain` 只执行脚本登记的请求；Trace 用 `kind: "generation"` 与独立计数记录登记、完成、失败与拒绝；宿主会话选项 `generation` 接收调度器并暴露 `session.generation`，删除 `generateQuiet`；新增 5 个测试；ADR-0122；门禁通过（231 个测试文件、2058 个测试、5 个跳过）
  做什么：`generate`/`generateRaw` 只登记后台任务，复用卡级限流调度器，走后台渠道并在间隙执行；Trace 单独计数；回合内不等待。
  验收：脚本发起的生成不进入回合内；按卡限流；Trace 有独立计数；`pnpm check` 通过。

- [x] **C-T05.e HTML 状态栏与开场页** | 依赖：C-T05.b | I4、I8
  完成：2026-11-13 新增 `st-helper-host/html.ts`：`extractStHelperHtmlFragments` 只认 `html` 围栏、完整 `<html>` 文档与整段 HTML 三种载体；`StHelperHtmlRenderer` 从楼层原文或角色卡 `firstMessage` 生成渲染请求并把快照写进插件显示状态（`statusBar`、`openingPage`），原文与台账不变；变量写入触发状态栏重渲染，进行中的写入合并、连续自动刷新默认上限 8；沙箱协议新增 `st-helper:render`/`st-helper:rendered`，渲染共用超时与 `terminate`，Trace 用 `kind: "render"` 记录；web 沙箱用 `DOMParser` 插入页面、按顺序执行页面内联脚本与卡片脚本后回传快照，外部与 module 脚本直接失败；新增 10 个 st-compat 测试、2 个 web 单元用例与 1 个 e2e 用例；ADR-0123；门禁通过
  做什么：提取角色卡与楼层里的 HTML 状态栏和开场页，在沙箱 iframe 里渲染；脚本只能通过宿主 API 读写变量与消息；渲染结果进入插件显示状态，不改原文、不写台账。
  验收：状态栏随变量更新重新渲染；开场页与楼层中的脚本在沙箱里运行；原文逐字节不变；`pnpm check` 通过。

- [x] **C-T05.f 一致性测试与共存评测** | 依赖：C-T05.b 至 C-T05.e
  完成：2026-11-13 新增 `st-helper-host/coverage.ts`：按本机 JS-Slash-Runner 4.8.10 公开类型定义记录 140 个函数与 6 个非函数入口，`summarizeStHelperCoverage()` 给全量 16/140、任务范围 16/19 与逐项缺口，另列三个扩展名；`st-helper-consistency.test.ts` 31 条用例覆盖清单里每个函数；`st-bench/st-helper-plugin.ts` 注册进 `ST_BENCH_COEXIST_PLUGINS`，开启组每轮读脚本库、提取状态栏渲染请求，合成批次两组提示词逐字节相同、四项指标有数字；`compareBlindWin` 改为平局不计入胜负；写 `docs/dev/reports/C-T05.md` 逐条核对总验收；ADR-0124；门禁通过
  做什么：按酒馆助手公开 API 统计覆盖率，补齐一致性用例；在 `ST_BENCH_COEXIST_PLUGINS` 注册 `st-helper-host`，开启与关闭各跑一批并报告四项原生指标；写 `docs/dev/reports/C-T05.md` 逐条核对总验收。
  验收：API 覆盖率与一致性用例达到提案口径；开关对照四项指标有数字与样本量；报告不含正文；`pnpm check` 通过。

## H：应用内助手（排在 R5 与 R3b 之后，取代原侧边 agent）

- [x] **H-T00 细化应用内助手** | 依赖：R5-T99、R3b-T99、E-T01 | DESIGN §10.3
  完成：2026-11-13 把应用内助手分成 H-T01 至 H-T09 与 H-T99：会话存储与类型化接口、运行时与只读工具、三级权限与待确认动作、排障与使用指南、台账修订与参谋、资料员与卡片工坊与设置向导、抽屉界面、上下文压缩与用量环、变更审阅面板、验收；迁移 v44–v46 预留给助手会话、消息、事件、待确认动作与压缩记录；ADR-0125；门禁通过（234 个测试文件、2074 个测试、5 个跳过）
  做什么：把抽屉界面与全部技能（排障、台账修订、参谋、资料员、卡片工坊、设置向导、使用指南）、类型化 server 接口、三级权限（只读、修改前确认、自动执行）、对话保存与搜索、关掉抽屉后任务继续运行与状态提示、上下文自动与手动压缩、用量环分成任务；复用深回合的 agent 运行时，与正剧隔离：不写楼层，不进入剧情上下文；影响剧情的修改一律走变更卡并由结算器校验。写清依赖与验收。
  验收：任务清单可直接执行；应用内助手不写楼层、不进入剧情上下文；影响剧情的修改全部经过变更卡；`pnpm check` 通过。

- [x] **H-T01 助手会话存储与类型化接口** | 依赖：R5-T99、R3b-T99、E-T01、P2.g | DESIGN §10.3 | ADR-0125
  完成：2026-11-13 迁移 v44 新建 `assistant_conversations`、`assistant_messages`、`assistant_events` 与 trigram 全文索引；`StoryStore` 增加创建、按故事与技能列出、标题与正文搜索（两字走 LIKE、三字以上走 FTS）、改名、改权限与模型、状态切换、删除与消息、事件读写；`packages/protocol/src/assistant.ts` 定义技能、请求、视图与事件载荷；`packages/server/src/assistant.ts` 挂载七个 `/api/assistant` 接口；`packages/web/src/api/assistant.ts` 类型化客户端；门禁通过（237 个测试文件、2084 个测试、5 个跳过）
  做什么：
  - 迁移 v44 新建 `assistant_conversations`、`assistant_messages`、`assistant_events` 与 `assistant_message_text`（trigram 全文索引）。会话字段：`id`、可空的 `story_id`（使用指南与全局设置可以为空）、`skill`、`title`、`permission`（`read_only`、`confirm`、`auto`）、`status`（`idle`、`running`、`completed`、`failed`、`cancelled`、`interrupted`）、可空的 `model_alias`、`thinking`（`off`、`low`、`high`）、`context_budget`（默认 48,000）、`compaction_threshold`（默认 0.8，范围 0.5–0.95）、`created_at`、`updated_at`、`last_message_at`。消息表按会话内递增 `ordinal` 保存 `user`、`assistant`、`tool`、`system` 四种角色，工具消息带 `tool_name` 与 `tool_result`，助手消息带可空的 `usage`（JSON）。事件表只追加，主键 `(conversation_id, seq)`，更新与删除由触发器拒绝。
  - `assistant_message_text` 的插入与删除由 `assistant_messages` 上的触发器同步；会话标题用普通索引，消息正文用 trigram，中文两字查询可以命中。
  - `StoryStore` 增加会话与消息的读写：创建、按故事或技能列出、按标题与正文搜索（返回会话摘要与命中片段）、读取完整会话、改名、改技能与权限、改模型与思考强度、删除（消息、事件级联删除）；消息序号在同一事务里取最大值加一。
  - `packages/protocol/src/assistant.ts` 定义与 server 共用的类型：技能 id、权限级别、会话摘要、消息、状态、创建与修改请求、搜索响应、事件名与事件载荷。`packages/server` 与 `packages/web` 只从 protocol 取这些类型；web 不从 core 取运行时值。
  - server 新增 `packages/server/src/assistant.ts` 并挂到 `/api/assistant`：`GET /api/assistant/conversations?query=&storyId=&limit=`、`POST /api/assistant/conversations`、`GET /api/assistant/conversations/:id`、`PATCH /api/assistant/conversations/:id`、`DELETE /api/assistant/conversations/:id`、`GET /api/assistant/conversations/:id/status`、`GET /api/assistant/conversations/:id/events?after=<seq>`。未知 id 返回 404，字段非法返回 400 并指出字段，删除会话不影响任何楼层。
  验收：迁移后四张表与索引存在，事件表的更新与删除被拒绝；会话改名、改权限、改模型、删除都能读回；中文两字查询命中标题与正文并返回片段；删除会话后消息、事件一起消失；未知 id 与非法字段有明确错误；protocol 类型被 server 与 web 共用且 web 没有 core 运行时导入；助手接口不创建楼层、不改 head、不写状态 diff；`pnpm check` 通过。

- [x] **H-T02 助手运行时、隔离与只读工具** | 依赖：H-T01 | DESIGN §10.1、§10.3 | ADR-0125 | I4、I8、I11
  完成：2026-11-13 新增 `assistant/runtime.ts` 的 `runAssistantTurn`（复用 `runDeepTurn`，消息只来自技能系统提示、会话消息与本轮输入；上限 20 次工具、300,000 毫秒、32,000 token 与最近 4 步，会话 `context_budget` 覆盖 token 上限；正文、工具结果与用量写进消息，事件与状态在同一事务里切换，并发启动抛 `AssistantRunConflictError`，取消保留部分正文并写 cancelled）；新增 `assistant/tools.ts` 的十个只读工具（`explain_node`、`run_log_read`、`memory_search` 限当前故事与 head 最多 10 条、`ledger_read`、`lore_lookup`、`state_get`、`director_read`、`settings_read`、`template_read`、`plugin_list`；结果超过 32,000 字符截断并写明原长与截断位置）与 `assistant/prompts.ts`；`StoryStore` 新增 `startAssistantConversationRun`、`finishAssistantConversationRun`；protocol 增加 `assistant.*` SSE 事件与 `SendAssistantMessageRequest`、`AssistantCancelView`；server 新增消息 SSE 与取消接口、`AssistantRuntimeManager`、启动时把遗留 `running` 改为 `interrupted`；客户端断开不中止运行；新增 7 个 core 测试与 3 个 server 测试；门禁通过（238 个测试文件、2094 个测试、5 个跳过）
  做什么：
  - 新增 `packages/core/src/assistant/runtime.ts` 的 `runAssistantTurn`：复用 `runDeepTurn` 的工具循环、传输、流式回调与上限，消息只由技能系统提示、压缩摘要、会话内消息和本轮附件组成。不调用 `generateAssistantTurn`，不组装剧情上下文，不读取 `history` 槽位，不写 `turn_runs`。
  - 默认上限：工具调用 20 次、运行 300,000 毫秒、工具往返 32,000 token、保留最近 4 步；会话的 `context_budget` 可以覆盖 token 上限。达到上限按现有规则正常收束并记录事件。
  - 新增 `assistant/tools.ts` 的只读工具集：`explain_node`（包装 `explainNode`，按楼层给出 Trace、上下文分段、检索、台账、导演与建议）、`run_log_read`（读运行日志）、`memory_search`（限定当前故事与当前 head 路径，最多 10 条）、`ledger_read`、`lore_lookup`、`state_get`、`director_read`、`settings_read`、`template_read`、`plugin_list`。工具结果超过 32,000 字符时截断并写明截断位置。注册表里没有草稿、提交、手记、正文写入与生图工具。
  - 每次运行写 `assistant_events`：`started`、`text.delta`、`thinking.delta`、`tool.call`、`tool.result`、`usage`、`completed`、`error`，会话状态在同一事务里切换。同一会话同时只允许一次运行，重复启动返回 409。取消把状态改为 `cancelled` 并中止请求；server 启动时把遗留的 `running` 改为 `interrupted`。
  - server 新增 `POST /api/assistant/conversations/:id/messages`（SSE）与 `POST /api/assistant/conversations/:id/cancel`；SSE 事件名与载荷来自 protocol。客户端断开不中止运行，重新连接用 `after` 续读事件，再按 `GET /status` 判断是否结束。
  - 模型默认使用 `roles.writer` 解析到的别名，会话的 `model_alias` 可以覆盖；思考强度按会话设置传给请求。用量写进助手消息与 `usage` 事件。
  验收：假客户端下排障问答能调用 `explain_node` 并读回报告；工具结果截断有标记；没有运行记录时报告写“没有记录”；同一会话并发启动被拒绝；取消、超时与工具上限都让状态结束而不是停在 `running`；进程重启后遗留运行变为 `interrupted`；运行前后楼层数量、head、状态 diff 与剧情 Trace 不变；正剧上下文里不出现助手消息；`pnpm check` 通过。

- [x] **H-T03 三级权限与待确认动作** | 依赖：H-T02 | DESIGN §10.3 | ADR-0125 | I12、I13
  完成：2026-11-13 迁移 v45 新建 `assistant_actions`（唯一待定索引、会话与故事一致性触发器、内容不可改）并重建 `ledger_change_cards` 允许来源 `assistant` 与可空的 `assistant_conversation_id`；`assistant/permissions.ts` 把三级权限映射到四类工具权限，只读拒绝提案与外部影响并写 `permission.denied` 事件，自动级别只有渠道动作可绕过确认；`assistant/actions.ts` 校验七类载荷、规范化去重、批准时重新校验并调用 `updateStorySettings`、`createContextTemplate`/`updateContextTemplate`、`insertLoreEntries`、`replaceDirectorPlan` 与生图配置写入，拒绝只改状态；`assistant_actions` 与变更卡共用现有会话删除保护；server 新增列表、批准与拒绝接口，批准渠道动作复用 `applyChannelsUpdate`；门禁通过（239 个测试文件、2106 个测试、5 个跳过）
  做什么：
  - 新增 `assistant/permissions.ts`，把助手权限映射到工具权限：`read_only` 只执行 `read`，其余调用返回 `permission_denied` 工具结果并写事件；`confirm` 执行 `read` 与 `control`，`propose` 与 `side_effect` 生成待确认动作；`auto` 执行 `read` 与 `control`，可以在不确认的情况下直接执行渠道、模型选择、思考强度与界面设置这类不改变剧情内容的工作，剧情相关内容仍然生成待确认动作。
  - 迁移 v45 新建 `assistant_actions(id, conversation_id, story_id, kind, summary, payload, status, rejection_reason, created_at, decided_at)`，`kind` 取 `channels`、`settings`、`template`、`lore`、`director_plan`、`card`、`image_config`，`status` 取 `pending`、`approved`、`rejected`；同会话内相同 `kind` 与规范化 `payload` 的待确认动作不重复创建。重建 `ledger_change_cards` 允许来源 `assistant`，增加可空的 `assistant_conversation_id`，原触发器与唯一约束保留。
  - 台账修改不使用 `assistant_actions`：`propose_ledger_change` 直接生成待批准的台账变更卡，来源为 `assistant`，`source_node_id` 取当前 head，`before` 取 head 快照，内容不变时复用已有待批准卡。
  - server 新增 `GET /api/assistant/actions?status=`、`POST /api/assistant/actions/:id/approve`、`POST /api/assistant/actions/:id/reject`；批准前重新校验载荷，批准时调用现有写入函数（`applyChannelsUpdate`、`updateStorySettings`、`updateContextTemplate` 并复用模板校验、世界书写入、`replaceDirectorPlan`、卡片字段写入、生图配置写入），拒绝只改状态并保留原因。任何级别都不能自动批准台账变更卡。
  - 删除会话时存在待确认动作返回 409，先批准或拒绝再删除。
  验收：只读级别下 `propose` 与 `side_effect` 调用被拒绝并写事件；确认级别生成待确认动作，批准后数据改变、拒绝后不变；自动级别只直接执行渠道与模型这类操作，模板、世界书、导演计划、卡片字段、生图配置与台账仍进入待确认流程；相同载荷不重复创建；批准时载荷非法保留 `pending` 并返回原因；删除有待确认动作的会话被拒绝；任何权限级别都不会自动批准台账变更卡；`pnpm check` 通过。

- [x] **H-T04 排障与使用指南技能** | 依赖：H-T02、E-T01 | DESIGN §10.3 | ADR-0125
  完成：2026-11-13 新增 `assistant/skills.ts` 技能注册表（`AssistantSkillDefinition` 含 id、名称、说明、系统提示、工具白名单与默认权限），注册 `troubleshoot`（`explain_node`、`run_log_read`、`ledger_read`、`director_read`、`memory_search`、`state_get`，要求结论附楼层 id 与具体字段、缺失写“没有记录”）与 `guide`（`docs_search`、`settings_read`、`template_read`、`plugin_list`，要求引用相对路径与标题）；创建与修改会话按注册表校验，未注册的技能返回 400 并指出 `skill`；新增 `assistant/docs.ts` 的 `AssistantDocsIndex`（启动时读取 DESIGN、TASKS、HUMAN 与 `dev/reports/*.md`，按标题与文本块切分，三字以上用 trigram、两字退回子串）与 `docs_search` 工具，目录缺失或没有可读文件时启动失败并指出路径；`runAssistantTurn` 的工具白名单按本次已注册工具校验，技能说明接在基础提示之后交给模型；server 新增 `GET /api/assistant/skills` 与 `--docs-root`（默认仓库 `docs/`）；门禁通过（241 个测试文件、2115 个测试、5 个跳过）
  做什么：
  - 新增 `assistant/skills.ts` 的技能注册表：`AssistantSkillDefinition` 含 id、名称、说明、系统提示、工具白名单与默认权限。本任务注册 `troubleshoot`（排障）与 `guide`（使用指南）；其余五个技能由 H-T05 与 H-T06 注册，未注册的技能 id 在创建会话时被拒绝。
  - 排障提示词要求每条结论附证据（楼层 id、Trace 字段、上下文分段 id、检索名次、台账路径或导演机制），没有记录时写“没有记录”，修正建议只使用现有工具能做到的动作；工具白名单为 `explain_node`、`run_log_read`、`ledger_read`、`director_read`、`memory_search`、`state_get`。
  - 新增 `assistant/docs.ts` 的 `docs_search`：启动时从 `--docs-root`（默认仓库根目录的 `docs/`）读取 `DESIGN.md`、`dev/TASKS.md`、`dev/HUMAN.md`、`dev/reports/*.md`，按标题与文本块切分后用 trigram 检索，返回路径、标题、片段与匹配词；目录不存在或没有可读文件时启动失败并指出路径，不静默返回空结果。工具只读，不访问网络。
  - `GET /api/assistant/skills` 返回已注册技能的名称、说明、默认权限与工具名；使用指南会话的系统提示要求引用来源路径与标题，回答“怎么用”时优先引用内置文档。
  验收：排障会话用假客户端时能调用 `explain_node`，回答包含楼层 id 与具体字段；没有运行记录或检索记录的楼层明确写“没有记录”；使用指南的中文两字查询命中文档路径与标题；文档目录缺失时启动失败并指出路径；未注册技能创建会话被拒绝；工具本身零模型调用；`pnpm check` 通过。

- [x] **H-T05 台账修订与参谋技能** | 依赖：H-T03、R1-T07.a、R4-T99 | DESIGN §10.3 | ADR-0125 | I12、I13
  完成：2026-11-13 注册 `ledger_revision` 与 `strategy`；新增 `assistant/proposals.ts` 的 `propose_ledger_change`（逐条用 `assertLedgerChangeCardDiff` 与 head 快照校验，`delete` 要求路径存在，稳定 id 复用同内容待批准卡，生成来源 `assistant` 的变更卡并锚定当前 head）与 `propose_director_plan`（`parseDirectorPlan` 校验后写成 `director_plan` 待确认动作，批准走 `replaceDirectorPlan`）；新增只读工具 `summarize_recent`（读取有效压缩与摘要，不调用模型）；server 在助手运行里注入提案工具；门禁通过（242 个测试文件、2124 个测试、5 个跳过）
  做什么：
  - 注册 `ledger_revision`（台账修订）：工具 `propose_ledger_change`（权限 `propose`）接收 `{diffs: [{path, op, value?}], explanation}`，逐条用 `validateLedgerDiff` 与 head 快照校验，`delete` 必须指向已存在的路径；生成 `before` 快照与待批准的台账变更卡，来源 `assistant`，`text` 写解释，`source_node_id` 取当前 head；内容相同的待批准卡不重复创建。批准走现有 `approveLedgerChangeCard`，写入的事实来源为 `player`。
  - 注册 `strategy`（参谋）：工具 `propose_director_plan`（权限 `propose`）接收弧线、序列与拍的草案，用现有导演计划解析器校验后写成 `assistant_actions` 的 `director_plan` 待确认动作；批准调用 `replaceDirectorPlan`，拒绝不改计划。参谋的读取工具为 `director_read`、`ledger_read`、`memory_search`、`state_get`、`summarize_recent`（复用现有章节压缩或最近楼层摘要，不生成新模型调用）。
  - 两个技能的系统提示都要求先读事实再提议，提案里写清会改变哪条路径或哪个拍；只读级别没有提案工具，确认与自动级别也只能生成待确认动作或变更卡。
  验收：假客户端下“把某人的好感度改成某值”生成一张待批准卡，批准后快照改变、拒绝后不变；非法路径整条拒绝并指出字段；相同内容不重复建卡；没有 head 的故事直接失败并说明原因；参谋生成的计划批准后能按现有读取接口读回，拒绝后计划不变；两个技能都不写楼层、不改 head、不调用正文写入工具；`pnpm check` 通过。

- [x] **H-T06 资料员、卡片工坊与设置向导技能** | 依赖：H-T03、P4.f、R4-T99 | DESIGN §10.3 | ADR-0125 | I14、I18
  完成：2026-11-13 注册 `research`（`web_search`、`lore_lookup`、`settings_read`、`propose_lore_entries`）、`card_workshop`（`card_read`、`template_read`、`lore_lookup`、`settings_read`、`propose_card_change`、`propose_lore_entries`）与 `setup_wizard`（`settings_read`、`channels_read`、`plugin_list`、`propose_channels_change`、`propose_settings_change`）；新增 `assistant/setup.ts` 的卡片读取、联网搜索与四类提案工具，以及 `assistant/search.ts` 的搜索接口与 HTTP 客户端；`propose_channels_change` 要求四个配置段给全，批准仍走 `applyChannelsUpdate` 与现有解析校验；`web_search` 只在 server 以 `--assistant-web-search <地址>` 显式开启时注册，渠道读取只返回非敏感字段；门禁通过
  做什么：
  - 注册 `research`（资料员）：工具 `web_search` 只在 server 用 `--assistant-web-search <baseUrl>` 显式开启时注册，接口通过注入的 `AssistantSearchClient` 调用，返回标题、链接、摘要与抓取时间；单元测试用假客户端，零网络。研究结论必须带链接；原作资料整理成世界书条目的待确认动作（`kind` 为 `lore`），批准时调用现有世界书写入并校验，拒绝不写。
  - 注册 `card_workshop`（卡片工坊）：工具 `card_read` 读当前故事的 `character_prompt`、`persona`、实体、世界书条目与上下文模板；`propose_card_change`（权限 `propose`）生成 `card` 或 `template` 待确认动作。批准模板时复用 `assertContextTemplate`，批准人物字段时复用现有设置校验；卡片工坊不修改楼层原文，也不导入或覆盖外部卡文件。
  - 注册 `setup_wizard`（设置向导）：工具 `settings_read`、`channels_read`、`plugin_list`、`propose_channels_change`、`propose_settings_change`。渠道读取只返回别名、模型名、baseUrl 与是否有密钥，密钥值永不进入工具结果、事件与消息；批准渠道修改调用 `applyChannelsUpdate` 并复用现有解析校验，批准故事设置调用 `updateStorySettings`。不读写 `.env`，不写仓库外文件。
  验收：资料员用假搜索客户端产出带链接的条目草案，批准后世界书出现条目、拒绝后不变；未开启联网时不注册 `web_search`；卡片工坊读回人物字段与世界书，生成模板草案，非法模板在批准时被拒绝并保留待确认状态；设置向导读到的渠道不含密钥值，批准渠道修改后配置可重新解析，非法配置被拒绝；三个技能都不写楼层；`pnpm check` 通过。

- [x] **H-T07 抽屉界面与运行状态** | 依赖：H-T01、H-T02、H-T03 | DESIGN §10.3 | ADR-0125
  完成：2026-11-13 新增 `packages/web/src/assistant/` 的抽屉、会话列表、事件流与权限文案；抽屉覆盖右侧，运行状态由故事页持有，关闭与切换标签页继续接收事件，右下角标记显示运行中、失败与待确认动作数，刷新后从活动会话、`GET /status` 与事件续读恢复；`AssistantApiClient` 增加技能、动作、取消、渠道与消息流，SSE 解析器按事件名白名单泛化；新增 3 个 web 单元测试文件与三条 Playwright 路径，desktop 与 mobile 各 3 条通过；门禁通过（246 个测试文件、2146 个测试、5 个跳过）
  做什么：
  - 新增 `packages/web/src/assistant/`：`AssistantDrawer.tsx`、`conversation-list.ts`、`stream.ts`、`permissions.ts`。抽屉从聊天页输入框旁打开，覆盖在右侧，不挤压聊天区；包含会话列表、标题搜索、新建、改名、删除、技能切换、模型与思考强度选择、权限选择、消息流、工具活动折叠区与错误提示。
  - 消息流按 `assistant_*` 事件增量渲染；重新打开抽屉时先读会话与 `status`，再用 `after` 续读事件，运行中继续接收，完成后显示结束状态。取消按钮调用取消接口。
  - 抽屉关闭不取消运行；聊天页右下角保留状态标记（运行中、待确认动作数、失败），点击重新打开。状态标记在路由切换后仍然存在，刷新页面后从 `GET /status` 与待确认动作列表恢复。
  - 所有请求走 `packages/web/src/api/assistant.ts`，类型只从 `@dramaticer/protocol` 导入；不模拟点击，不访问助手接口以外的内部状态。
  - 新建会话默认技能为排障、权限为修改前确认、模型为 `roles.writer`；设置在一次会话内保留，切换会话时读取该会话自己的设置。
  验收：抽屉打开、关闭、刷新后能恢复会话与运行状态；关闭后运行继续且状态标记更新；事件续读不重复消息；会话搜索、改名、删除可用；权限与技能切换写回 server；取消后状态为 `cancelled`；键盘可以打开与关闭抽屉，焦点不留在隐藏元素上；助手操作不改变楼层数量与 head；web 单元测试与 Playwright 用例覆盖打开、关闭后继续运行、重新连接三条路径；`pnpm check` 与目标 e2e 通过。

- [x] **H-T08 上下文压缩与用量环** | 依赖：H-T02、H-T07 | DESIGN §10.3 | ADR-0125 | I11
  完成：2026-11-13 迁移 v46 新增 `assistant_compactions`（只追加，删除会话时级联删除）；新增 `assistant/context.ts`（`estimateAssistantContext`、`buildAssistantRequestMessages`、`compactAssistantConversation`），用量按系统提示、摘要、消息与工具结果四部分估算并给出 `used`、`budget`、`percent`；server 在每次请求前检查阈值并先压缩，手动 `POST /api/assistant/conversations/:id/compact` 可附要求，压缩失败保留原消息并写 `compaction` 事件；详情接口返回最新压缩与用量；抽屉新增用量环、摘要折叠面板与手动压缩表单；新增 `assistant-context.test.ts`（9 个）与 `assistant-context-usage.test.ts`（3 个），扩充 store、server、API 与事件流断言，desktop/mobile 各 4 条 e2e 通过；门禁通过（253 个测试文件、2170 个测试、5 个跳过）
  做什么：
  - 新增 `assistant/context.ts`：按消息、系统提示与附件估算下一次请求的 token；会话报告 `context_used`、`context_budget`、`context_percent` 与各部分占用。用量环读取这三个字段，悬停显示输入、输出、工具结果与摘要的占比。
  - 迁移 v46 新建 `assistant_compactions(id, conversation_id, seq, summary, omitted_message_ids, before_tokens, after_tokens, created_at)`；压缩把较早的消息合并成一条 `system` 摘要消息，保留最近 N 条（默认 10）与被待确认动作引用的消息，省略的消息 id 写进压缩记录。摘要由会话选择的模型生成，使用 `NO_CONTINUATION`，失败时保留原上下文并把失败写进事件，不丢消息。
  - 自动压缩在每次模型请求前检查 `context_percent`，达到 `compaction_threshold` 时先压缩再请求；同一会话同时只有一次压缩。手动压缩走 `POST /api/assistant/conversations/:id/compact`，可以附带一段要求；压缩完成后写事件并更新会话的 `updated_at`。
  - 界面在消息流顶部显示可折叠的摘要与“省略 N 条消息”的来源列表；压缩不触碰正剧的章节压缩与记忆，也不把助手摘要写进剧情上下文。
  验收：构造超过阈值的会话后，下一次请求前自动压缩并且请求里的消息数下降；用量环的数字与接口一致；手动压缩按给定要求生成摘要，省略的消息 id 可读；压缩请求失败时原消息仍在、状态为可继续；压缩后待确认动作仍然可见；正剧的记忆压缩记录与上下文不变；`pnpm check` 通过。

- [x] **H-T09 变更审阅面板** | 依赖：H-T03、H-T05、H-T06、H-T07 | DESIGN §10.3 | ADR-0125 | I12
  完成：2026-11-13 抽屉新增“对话 / 待确认”视图切换与“待确认”面板，同时列出 `assistant_actions` 与待批准台账变更卡，按故事与来源会话过滤；新增 `assistant/review.ts` 的字段描述（七类动作按种类展开，渠道只显示别名、模型与密钥是否设置，台账卡按路径带出原值与新值）与过滤、标题查找函数；批准与拒绝复用 H-T03 动作接口和 H-T05 变更卡接口，失败保留条目并在条目内显示原因，台账卡不提供批量或自动批准；右下角状态标记的待确认数量改为动作与变更卡之和，与面板一致并在决定后立即刷新；新增 4 个 web 单元测试与 desktop/mobile 各 1 条 e2e（8 项待确认、密钥不显示、非法载荷保留并显示原因、批准后设置改变、拒绝写原因、数量同步）；门禁通过
  做什么：
  - 抽屉内新增“待确认”视图：列出 `assistant_actions` 与待批准台账变更卡，按会话与故事过滤；每条显示类型、摘要、产生它的会话、路径或字段的前后值、以及批准与拒绝按钮。
  - 台账变更卡复用现有卡片接口与差异展示；其他动作按 `kind` 显示字段差异（渠道只显示别名与模型，密钥永远显示为已设置或未设置）。批准与拒绝调用 H-T03 的接口，失败时保留待确认状态并显示原因，不吞错误。
  - 聊天页状态标记上的待确认数量与视图一致；批准或拒绝后数量立即更新。审阅面板不提供批量批准，也不提供自动批准台账变更卡。
  验收：五种以上动作类型在面板里可读，台账卡显示路径与前后值，渠道卡不显示密钥；批准后条目消失且数据改变，拒绝后条目消失且数据不变；非法载荷批准失败并保留条目与原因；台账卡无法批量或自动批准；状态标记数量同步；`pnpm check` 通过。

- [x] **H-T99 H 验收** | 依赖：H-T01 至 H-T09
  完成：2026-11-13 门禁通过（249 个测试文件、2169 个测试、5 个跳过）；`e2e/assistant.spec.ts` 的 desktop 与 mobile 各 5 条全部通过；用 `.env` 的 `main` 渠道（`main-fallback`）跑通排障问答（只读，11,207 毫秒，6 次工具调用）与台账修订批准（确认级别，9,919 毫秒，3 次工具调用，批准后 `冷淡` → `亲近`、来源 `player`、楼层与 head 不变）；手动压缩把 40 条消息的估算从 1,122 降到 613 token，省略 30 条；逐条核对 H-T01 至 H-T09 与 I4、I8、I11、I12、I13、I14、I15；报告 `docs/dev/reports/H.md` 只写数字与配置
  做什么：重跑门禁与 web 目标 e2e；用真实渠道跑一次排障问答与一次台账修订批准流程（只调用 `.env` 里的渠道，不访问本地 ST，不修改 `.env`）；逐条核对 H-T01 至 H-T09 的验收；复核 I4（不写楼层原文）、I8（助手不改变剧情视图）、I11（助手运行不进入剧情回合）、I12（台账写入全部经过变更卡与结算校验）、I13（不强制模型输出结构）、I14（不消耗本地 ST 额度）、I15（core 不依赖其他工作区包）；写 `docs/dev/reports/H.md`，记录技能、权限、压缩与用量环的实测结果，只写数字与配置，不写对话原文。
  验收：全部技能可用且未注册技能被拒绝；助手会话与正剧隔离；三级权限按 ADR-0125 执行；台账修改只能通过批准后的变更卡写入；抽屉关闭后运行继续；压缩与用量环有实测数字；报告不含私有数据；`pnpm check` 通过。结果写 `MILESTONE_DONE`。

## X：对比实验（排在 H 之后）

**X1 世界模型表示方式对比**（已拆成 X1.a 至 X1.e） | 依赖：R1-T99.a、R2-T99 | DESIGN §14.4

总验收（五个子任务全部完成后逐条核对）：三种候选通过同一个读写接口切换，用故事设置选择，调用方只传种类；三种候选各自可运行并产出同一格式的指标表（3 个对话、固定轮数、同一批记忆题与探针，每种至少重复 3 次）；判定按规则执行（主要指标不劣于 ①，且盲测胜率明显高于 ① 才切换，否则保留 ①）；设计与结论写 ADR；未切换的候选留在开关后面；`pnpm check` 通过。

- [x] **X1.a 世界模型读写接口与台账候选** | 依赖：R1-T99.a、R2-T99 | DESIGN §14.4
  完成：2026-11-14 新增 `packages/core/src/world-model/`（`WorldModelKind`、`WorldModel`、`createWorldModel`）；`ledger` 适配器读取复用 `readLedger` 与状态快照、写入复用 `validateLedgerDiff` 与 `appendStateDiffs`；故事设置新增 `worldModel`（迁移 v47，默认 `ledger`），状态槽位按设置选择实现且 `packKey` 为 `state:<kind>`，台账下消息与 `source` 不变；server、`dramaticer chat`、回放与评测入口传入设置；`wiki` 与 `temporal_graph` 在实现前由工厂直接失败；ADR-0126；新增 7 个测试；门禁通过（250 个测试文件、2,176 个测试、5 个跳过）
  做什么：
  - 新增 `packages/core/src/world-model`：`WorldModelKind`（`ledger`、`wiki`、`temporal_graph`）、`WorldModel` 接口与工厂 `createWorldModel(store, kind)`。读取返回 `{state, sections, source}`；写入接受与存储无关的事实数组，先校验再写，非法条目抛错并指出路径。
  - `ledger` 适配器：读取复用 `readLedger` 与状态快照，写入复用 `validateLedgerDiff` 与 `appendStateDiffs`；`sections` 为空，状态槽位的消息与 `source` 与改动前逐字节一致。
  - 故事设置新增 `worldModel`（迁移 v47，默认 `ledger`），写入校验种类；状态槽位按设置选择实现，`createStandardChatSlots` 与 server、`dramaticer chat`、评测入口把设置传进去。`wiki` 与 `temporal_graph` 尚未实现时由工厂直接抛错。
  验收：`ledger` 适配器的读取与状态快照一致，`source` 与改动前相同；写入后读取可见，删除后不可见，非法路径抛错并指出路径；未知种类与未实现的候选在选择时抛错；设置默认值与非法值校验有测试；`pnpm check` 通过。

- [x] **X1.b 实体 Wiki 页候选** | 依赖：X1.a
  完成：2026-11-14 迁移 v48 新增只追加的 `world_wiki_revisions`（实体 id、写入楼层、正文、故事时间、来源与创建时间，修改由触发器拒绝）；`world-model/wiki.ts` 的 `createWikiWorldModel` 读取台账快照加每人一段档案（当前路径最新正文、版本数、当前与最早出处），档案用 `["profile", "<人物>"]` 写入、人物需在台账里存在（同批写入的人物也算），未知人物、空正文与删除抛错并指出路径；工厂接上 `wiki`，状态槽位在 `wiki` 下渲染档案段且 `source` 为 `state:<n> 条 diff，档案 <m> 版`；ADR-0127；新增 5 个测试；门禁通过（250 个测试文件、2,181 个测试、5 个跳过）
  做什么：
  - 迁移新增 `world_wiki_revisions`：实体 id、楼层、正文、来源楼层与时间，只追加；沿当前路径取每个实体的最新一版，并保留版本数与最早出处。
  - `wiki` 适配器读取台账状态加实体档案段（性格变化、关系史，带出处楼层与版本数），写入校验实体与正文后追加一版；分支切换后只出现当前路径上的版本。
  验收：写入两版后读取到最新正文、版本数与出处；分支切换不跨分支；空正文与未知实体会话抛错并指出字段；状态槽位在 `wiki` 下包含档案段；`pnpm check` 通过。

- [x] **X1.c 时序知识图谱候选** | 依赖：X1.a
  完成：2026-11-14 新增 `world-model/temporal-graph.ts`（`TemporalFactVersion`、`TemporalEndReason`、`TemporalGraphWorldModel`、`createTemporalGraphWorldModel`）：沿当前路径回放台账 diff，每次 set 开启一版、set 或 delete 关闭该路径及其下层的活动版本并保留最后一版的值、起止楼层、失效原因与结束事件时间；`read` 不传时间点时返回台账快照与一段「已失效事实」，`source` 为 `state:<n> 条 diff，已失效 <m> 条`；`WorldModel.read` 新增可选 `atStoryTime`，按标签首次出现顺序建立时间轴、只选自身带 `storyTime` 的版本，台账与 wiki 收到时间点查询直接抛错；`versions(nodeId)` 列出全部版本；工厂接上 `temporal_graph`，状态槽位自动带失效段；ADR-0128；新增 5 个测试；门禁通过（250 个测试文件、2,186 个测试、5 个跳过）
  做什么：
  - `temporal_graph` 适配器从台账 diff 回放事实的有效区间：每次 set 开启区间，delete 关闭区间并保留最后值；读取返回当前事实与已失效事实（带起止楼层），不删除任何记录。
  - 支持按故事内时间点查询：给定 `storyTime` 返回该时间点成立的事实，缺少时间的事实只在当前视图出现。
  验收：set 后 delete 的事实仍在读取结果里且带失效楼层与最后值；按时间点查询只返回该时间成立的事实；分支切换只看到当前路径；状态槽位在 `temporal_graph` 下包含失效段；`pnpm check` 通过。

- [x] **X1.d 对比运行器** | 依赖：X1.b、X1.c、R2-T99
  完成：2026-11-14 新增 `packages/st-compat/src/evalset/world-model-compare.ts` 与 CLI（`world-model-compare`）：每个候选与每次重复复制同一份源数据库，固定快回合与同一串玩家消息、同一批记忆题与探针运行；实体档案候选在每轮后把涉及人物的档案修订通过 `WorldModel.write` 补写，台账与时序图谱不额外写入；时间点探针只对 `temporal_graph` 调 `read(nodeId, { atStoryTime })`，台账与 wiki 记为不适用；指标表统一为矛盾率、编造回忆率、盲测胜率与每轮请求数、首字与时延 P50/P90，默认重复 3 次；每个候选与重复写 sidecar，重跑复用，单次失败只进报告；ADR-0129；新增 3 个假客户端测试；门禁通过（251 个测试文件、2,189 个测试、5 个跳过）
  做什么：
  - 新增 `packages/st-compat/src/evalset/world-model-compare.ts` 与 CLI：每个候选复制一份数据库，按固定轮数运行自动试玩，写入走对应适配器，结束后跑同一批记忆题与探针，并与候选 ① 做盲测对比。
  - 指标表统一为矛盾率、编造回忆率、盲测胜率与每轮成本（请求数与时延），每种候选默认重复 3 次；结果写 JSON 与报告，支持断点续跑。
  验收：假客户端下三种候选各产出同一格式的指标表；重复次数与样本数写入结果；单次失败不丢其他候选结果；`pnpm check` 通过。

- [~] **X1.e 在 3 个对话上运行并判定** | 依赖：X1.d
  等待长任务：X1.e-01（`node .devloop/scratch/X1.e/run-compare.mjs`，600 分钟）。
  已完成：从 `eval-private/raw/manifest.json` 的 3 个 legacy 对话各取连续 8 条玩家消息（截断点之前的楼层导入源数据库）；源数据库 `eval-private/world-model-compare/source/<slug>.db` 各有 563、396、215 个楼层，导入卡与 lore，并各结算最后 4 个窗口，head 上可出题的台账事实分别为 55、27、146 条；时间点标签为 0。每个故事 12 道记忆题（从现成 50 道里按 id 排序取前 12 道，且证据楼层都在截断点之前）。preflight（`yuwang`、1 轮、1 次重复、1 条探针、2 道题）三种候选全部完成，召回探针与盲测都产出了判定。
  剩余：长任务跑完后读 `.devloop/jobs/X1.e-01.status.json` 与 `eval-private/reports/world-model-compare/*.json`，按判定规则写 ADR、`docs/dev/reports/X1.md`，决定是否切换 `worldModel` 默认值。
  做什么：
  - 用 3 个评测对话、固定轮数、每种候选重复 3 次运行对比；按判定规则决定是否切换，结论写 ADR；未切换的候选保留在 `worldModel` 开关后面。
  验收：指标表与判定规则逐条对照；ADR 入库；报告只写统计数字；`pnpm check` 通过。

- [ ] **X2 Director 组织方式对比** | 依赖：R2-T99、R4-T99 | DESIGN §14.4
  做什么：
  - 候选：① 现有方案与序列；② 剧情小品引擎：只有一种对象，条件是自然语言或台账查询，间隙里一次调用批量判断，支持冷却、顺序约束、可否重复与兜底；卡作者可以在 `extensions.dramaticer` 里附带自己的小品。
  - 指标：重复度、推进度、线索兑现率、盲测胜率、条件判断准确率；条件判断用固定样本逐条核对，不能只靠裁判模型自评。
  - 判定：不劣于 ① 且盲测胜率明显更高才切换，否则保留 ①；设计与结论写 ADR。
  验收：两个候选在同一批试玩样本上产出指标表；条件判断样本与核对结果入库；判定按规则执行；`pnpm check` 通过。

## R6：效果门槛

- [ ] **R6-T00 细化 R6 任务** | 依赖：R5-T99、R3b-T99、R1-T99.a、H-T00 | DESIGN §14.2
  做什么：预注册门槛：B1 对比胜率的判定方式与置信区间、矛盾率上限、重复度与推进度口径、深回合增益口径、偏好一致率口径；B2 的申请模板与样本上限；未达标时自动生成改进任务并重评最多三轮，之后写入 HUMAN.md。拆成具体任务并写清依赖与验收。
  验收：门槛在运行前写死；每项都有可复现的统计口径；`pnpm check` 通过。

- [ ] **R6-T99 R6 验收** | 依赖：R6 全部任务
  做什么：按预注册门槛运行 B0、B1 对比（必要时按 HUMAN 流程申请 B2）；逐项判定；未达标时列出改进任务与重评结果；把结论写入 `docs/dev/SCOREBOARD.md` 与 `docs/dev/reports/R6.md`；确认 P3–P5 与 M5 任务。
  结果写 `MILESTONE_DONE` 或 `PARTIAL`。

## M6b：生图第二批（排在 R6 之后）

> DESIGN §12 的第二批。共用 M6 第一批的 `ImageProviderClient`、`images.yaml`、`node_images` 与显示路径，只增加后端适配与各自的参数。迁移编号在第一批之后继续顺延。

- [ ] **M6b-T01 OpenAI 兼容图像接口** | 依赖：R6-T99、M6-T99、M6-T01 | DESIGN §12 | ADR-0082
  做什么：
  - `images.yaml` 的 `providers` 接受 `api: openai-images`：`baseUrl`、`apiKey`、`model`、`size`、`quality`（可空）、`timeoutMs`；请求 `POST /v1/images/generations`，读取 `b64_json` 或下载 `url`；自然语言提示词由 `compileImagePrompt(..., style: "natural")` 生成；响应与错误映射成统一的 `GeneratedImage`。
  - 视觉档案的 `backends.openai` 可以附带额外正向与负向文字；没有时只用基础外貌与服装。图片仍写 `node_images` 与 `mediaDir`，显示与重试复用第一批。
  - 假 HTTP 覆盖成功、`url` 下载、空响应、非 2xx 与超时；真实调用放 `*.live.test.ts`，只有设置对应环境变量时运行；`images.example.yaml` 补示例，不新增依赖。
  验收：假 HTTP 下生成一张图并附加到楼层；`b64_json` 与 `url` 两种响应都可用；空响应、非 2xx、超时各按行失败并保留原因；提示词是自然语言；没有配置时不向模型提供出图工具；`pnpm check` 通过。

- [ ] **M6b-T02 Grok 图像接口** | 依赖：M6b-T01 | DESIGN §12 | ADR-0082
  做什么：
  - `providers` 接受 `api: grok-images`：`baseUrl`、`apiKey`、`model`、`size`；请求 xAI 的图像生成接口，响应里的 `b64_json` 或 `url` 交给 M6b-T01 的同一套解析；提示词风格为自然语言。
  - 与 `openai-images` 的请求差异只在地址、模型与更少的参数；真实调用放在 live 测试，默认跳过；示例配置补一个关闭的条目。
  验收：假 HTTP 下与 OpenAI 兼容接口产出相同的 `GeneratedImage`；参数映射与错误原因正确；未配置时不影响其他后端；`pnpm check` 通过。

- [ ] **M6b-T03 NovelAI 图像接口** | 依赖：R6-T99、M6-T99、M6-T01 | DESIGN §12 | ADR-0082
  做什么：
  - `providers` 接受 `api: novelai`：`baseUrl`、`apiKey`、`model`、`sampler`、`steps`、`scale`、`width`、`height`；请求 NovelAI 的生成接口，响应是 ZIP，需要解压取第一张 PNG。新增 ZIP 读取依赖（候选 `fflate`），在 `docs/dev/DEPENDENCIES.md` 登记理由并写进 ADR。
  - 提示词用标签式：`compileImagePrompt` 产出正向与负向；视觉档案的 `backends.novelai` 提供角色专属提示词（`characters`）与 `uc`，有多个人物时按 NovelAI 的多人物格式拼接，超过 3 人退化为普通标签并在元数据里记原因。
  - 假 HTTP 用固定 ZIP fixture 覆盖成功、空 ZIP、损坏 ZIP 与非 2xx；真实调用放 live 测试，默认跳过；示例配置补一个关闭的条目。
  验收：假 HTTP 下解压出 PNG 并附加到楼层；角色专属提示词与负向进入请求；空与损坏 ZIP 按行失败并保留原因；未配置时不影响其他后端；`pnpm check` 通过。

- [ ] **M6b-T99 M6 生图第二批验收** | 依赖：M6b-T01、M6b-T02、M6b-T03
  做什么：用三个后端的假 HTTP 各生成一张图并附加到楼层；在有人类额度时用真实渠道各跑一次并记录耗时与失败；核对提示词风格、频率设置、失败重试与显示；写 `docs/dev/reports/M6b.md`。
  验收：三个后端都能出图且显示路径一致；真实调用有结果或明确记录未申请；统计版报告不含密钥与私有原文；`pnpm check` 通过。
  结果写 `MILESTONE_DONE`。

## M5：公开 alpha——由 M5-T00 细化，排在 R6 与 P3/P4 之后

- [ ] **M5-T00 细化 M5 任务** | 依赖：R6-T99、P4
  做什么：把公开 alpha 拆成任务：README 与使用说明、安装与升级说明、许可证与第三方声明、安装包与一键启动、发布前检查清单（不变量复审、私有数据扫描、依赖登记、示例卡与基准），写清依赖与验收。
  验收：清单可直接执行；`pnpm check` 通过。

- [ ] **M5-T99 M5 验收** | 依赖：M5 全部任务
  做什么：逐项核对发布材料与安装包；复核全部设计不变量与私有数据红线；写最终报告。
  结果写 `MILESTONE_DONE`。

## M7：Tauri 打包——由 M7-T00 细化，排在 M5 之后

- [ ] **M7-T00 细化 M7 任务** | 依赖：M5-T99
  做什么：拆解桌面与移动打包、Windows 一键启动、更新机制与签名；写清依赖与验收。
  验收：清单可直接执行；`pnpm check` 通过。

- [ ] **M7-T99 M7 验收** | 依赖：M7 全部任务
  做什么：打包产物在干净机器上启动并完成一轮对话；复核不变量；写报告。
  结果写 `MILESTONE_DONE`。

## V：Vertex AI 渠道（人类请求，2026-11-09）

- [x] **V-T01 加入 google-vertex 渠道** | 依赖：M1-T02 | 人类请求
  完成：2026-11-09 `LlmChannelApi` 增加 `google-vertex`，`PiLlmChannel` 用 pi-ai 的 `google-vertex` 适配器并按 API 分派，渠道环境传给适配器；`channels.example.yaml` 与 `data/channels.yaml` 增加 `api: google-vertex` 的 `vertex` 渠道与 `gemini-4-argon` 模型（`baseUrl: https://{location}-aiplatform.googleapis.com`、`apiKey: ""` 走服务账号/ADC）；server 渠道更新接口与 web 渠道表单接受新 API；凭证、项目与区域从 `.env` 的 `GOOGLE_APPLICATION_CREDENTIALS`、`GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION` 读取；新增配置测试与 `DRAMATICER_VERTEX_LIVE=1` 才运行的 live 测试；ADR-0080；门禁通过（152 个测试文件、1313 个测试通过、4 个 live 跳过，共 1317 个）。
  做什么：复用 pi-ai 1.5.0 的 `google-vertex` 适配器，增加 `google-vertex` 渠道 API；`apiKey` 为空时使用 ADC/服务账号；项目、区域与凭证路径只从 `.env` 读取；示例配置增加 Vertex 渠道与 Gemini 模型；服务端与 web 渠道表单接受新 API。
  验收：配置解析接受 `google-vertex` 与空 `apiKey`；渠道适配器按 API 选择 Vertex；未设置 Google 环境变量时不影响现有渠道；`DRAMATICER_VERTEX_LIVE=1` 时能用服务账号跑通渠道体检；`pnpm check` 通过。
