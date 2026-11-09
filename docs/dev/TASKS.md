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
| R5 能玩的界面 | 当前阶段 | 本文件 |
| M6 生图第一批 | 待做 | 本文件 |
| R1 续 记忆增强 | 待做 | 本文件 |
| R3b 深回合 | 待做 | 本文件 |
| P 插件内核 | 待做 | 本文件 |
| 兼容插件线 | 待做 | 本文件 |
| H 应用内助手 | 待做 | 本文件 |
| X 对比实验 | 待做 | 本文件 |
| R6 效果门槛 | 待做 | 本文件 |
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
  完成：2026-11-08 把 R4 拆成 R4-T01 至 R4-T08 与 R4-T99：计划存储与玩家编辑、后台规划器、短线层节拍选择、并入玩家消息、透明与盲盒模式、落拍检测、候选行动、`extensions.dramaticer` 扩展；M3 已实现的线索、事件池、NPC 议程、重复检测、节奏与 O 的开局导演不重复建任务；迁移 v32 存计划与拍状态、v33 存候选行动，R1 续原计划的 v32–v35 顺延为 v34–v37；ADR-0077；门禁通过（118 个测试文件、1038 个测试通过，3 个 live 跳过，共 1041 个）
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

**R5-T14 真实 60 轮试玩与报告**（原 M4-T20，已拆成 R5-T14.a 与 R5-T14.b） | 依赖：R5-T13 | 使用 `.env` 里的真实渠道

- [~] **R5-T14.a 真实 60 轮试玩（分会话续跑）** | 依赖：R5-T13
  做什么：
  - 用专用渠道配置 `.devloop/scratch/R5-T14/channels.yaml`（`writer: main-fallback`、`settler/planner: background`；`rp` 仍返回 503）与专用数据库 `.devloop/scratch/R5-T14/live.db` 跑满 60 轮，包含两次重新生成、两次编辑与两次分支切换。
  - 启动 server：`pnpm --filter @dramaticer/server build && node packages/server/dist/cli.js --db .devloop/scratch/R5-T14/live.db --channels .devloop/scratch/R5-T14/channels.yaml --port 8787`。
  - 跑试玩：`PLAYTEST_LIVE=1 PLAYTEST_DB=.devloop/scratch/R5-T14/live.db PLAYTEST_CHANNELS=.devloop/scratch/R5-T14/channels.yaml PLAYTEST_ROUNDS=60 pnpm playtest`。命令在前台运行到进程退出；不要放后台后结束回合。
  - 每轮完成后写续跑文件 `eval-private/reports/r5-playtest.progress.json`；每次会话的默认时间预算 45 分钟，到预算会停在整轮边界。下一会话用同一命令继续。`PLAYTEST_RESUME=0` 强制新开一次试玩，`PLAYTEST_TIME_BUDGET_MS` 改预算。
  - 跑满 60 轮时自动写 `eval-private/reports/r5-playtest.md` 与 `docs/dev/reports/R5-playtest.md`；续跑文件记录的数据库、渠道、标题与排期必须与当前配置一致，不一致直接失败。
  验收：续跑文件有 60 条 round 记录、0 个失败；两份报告生成；统计版无私有信息；报告给出导演机制命中、线索兑现与四种偏好信号的数字。

- [ ] **R5-T14.b 试玩报告核对与文档** | 依赖：R5-T14.a
  做什么：核对统计版字段与 ADR-0033 口径，没有信号的指标保持「未证实」，不改口径；在 `docs/dev/reports/R5.md` 引用统计版并写明模型别名、轮数与操作次数；重跑 `pnpm check`。
  验收：统计版字段齐全并通过私有标识反向扫描；`docs/dev/reports/R5.md` 的引用与数字和统计版一致；`pnpm check` 通过。

- [ ] **R5-T99 R5 验收** | 依赖：R5 全部任务（含 R5-T02.a、R5-T02.b、R5-T02.c、R5-T05.a、R5-T07.a、R5-T14.a、R5-T14.b）
  做什么：同 M0-T99；重跑 `pnpm check`、`pnpm e2e` 与 60 轮试玩报告；逐条核对 R5-T01 至 R5-T14 与全部子任务；复核 I6（模式只由玩家切换）、I9（导演实时选择零模型调用）、I11–I14，以及 server 不绕过 core 直接写库；检查默认回环监听与局域网密码；在 `docs/dev/reports/R5.md` 总结；确认 M6、R1 续与 R3b 任务。
  结果写 `MILESTONE_DONE`；报告缺失时写 `PARTIAL`。

## M6：生图第一批（ComfyUI 优先）

> v3 路线（ADR-0044）：第一批排在最小界面之后，不再排在所有阶段之后。

- [ ] **M6-T00 细化 M6 任务** | 依赖：R5-T99 | DESIGN §12
  做什么：把第一批（ComfyUI API 格式 workflow 导入与插槽识别、`illustrate` 工具、图片块显示、角色视觉档案初版、异步任务队列与结果挂楼层）与第二批（NovelAI、Grok、OpenAI 兼容图像接口）拆成任务，写清依赖与验收；第一批在 R1 续之前完成。
  验收：第一批任务可直接执行；第二批排在 R6 之后；`pnpm check` 通过。

- [ ] **M6-T99 M6 第一批验收** | 依赖：M6-T01 至第一批全部任务
  做什么：用真实 ComfyUI 跑通一张卡的开场图与一次剧情图，结果挂到楼层节点；核对失败重试、频率设置与图片块显示；写 `docs/dev/reports/M6.md`。
  结果写 `MILESTONE_DONE`。

## R1 续：记忆增强（由长对话评测与工程证据决定）

> v3 路线（ADR-0044）：全部任务保留，排在最小界面与 60 轮自动试玩之后。R2-T09 的长对话遗忘报告与 R5-T14 的试玩报告决定四项的先后与默认开关；任何一项都不删除。

- [ ] **R1-T03.a 父子分块** | 依赖：M2-T08、M2-T10、R5-T99 | DESIGN §7.3 | ADR-0044
  做什么：
  - 迁移 v34 给 `chunks` 增加父段字段（`parent_ordinal`、`parent_text`）：父段按段落边界切分，过长的段落退化为整楼；检索只匹配小块，命中后返回父段文本。
  - 打开数据库时按新规则重建块，旧块与对应向量一并删除；`embeddings` 任务随后补齐缺失向量。回填可重复执行，不产生重复块。
  - `searchChunks` 与 `searchVectors` 返回父段文本；多路融合按楼层去重时保留父段文本，Trace 记录注入的是整段还是整楼。先读 R2-T09 与 R5-T14 的报告，决定是否默认开启。
  验收：小块命中后返回父段；同一父段多个小块只占一个结果位次；回填重复运行后块数不变；旧向量被清理且不参与查询；开关关闭时与现状逐条一致；`pnpm check` 通过。

- [ ] **R1-T03.b 重排序** | 依赖：R1-T03.a、M2-T10 | DESIGN §7.3 | ADR-0044
  做什么：
  - 新增 `RerankClient`（OpenAI 兼容 `POST /rerank`，批量、限速、重试），渠道写在 `data/channels.yaml` 的 `reranker` 段（硅基流动 bge-reranker），密钥只从 `.env` 读取；`channels.example.yaml` 补示例。
  - `retrieveMemory` 融合后取前 `rerankCandidates`（默认 20）交给重排序，再取最终 top-K；`memory_search` 与 M2-T12 的槽位共用同一入口。
  - 开关默认关闭；用 R1-T04.b 的记忆评测决定，事件题与状态题都没有下降且有提升才在默认配置打开，结论写 ADR。
  验收：假重排序客户端下候选顺序按分数重排；开关关闭时与现在的融合顺序逐条一致；没有配置 `reranker` 时开关保持关闭且不发起请求；单元测试零网络；`pnpm check` 通过。

- [ ] **R1-T04.b 三对话事件表回填与记忆评测重跑** | 依赖：R1-T04.a、R1-T03.a、R1-T03.b、M2-T15 | ADR-0044
  做什么：
  - 对 3 个 legacy 评测对话运行 `events-backfill`，按窗口数量与实测速率安排运行，记录耗时与请求数；事件覆盖率按对话报告。
  - 重跑 `memory-eval`，分别给出 BM25、向量、实体、事件、融合五路的事件题命中@5、@10、@20 与分对话结果。
  - 权重调整采用留一对话交叉验证：在 2 个对话上从固定候选集（每路权重 0.5、1、2）选择融合参数，在第 3 个对话上报告；规则与结果写 ADR，默认值只在交叉验证得分高于当前默认时更新。
  - 重新生成私有报告与统计版 `docs/dev/reports/R1-retrieval.md`；统计版不含原文与对话名。
  验收：事件表覆盖 3 个对话并给出覆盖率；五路数字齐全；交叉验证规则与选择结果写入 ADR；报告可重复生成；`pnpm check` 通过。

- [ ] **R1-T05 八段式章节压缩** | 依赖：M2-T06、R1-T01、R1-T04.b | DESIGN §7.3 | ADR-0044
  做什么：
  - 迁移 v35 新增 `chapter_compressions(id, story_id, level, start_node_id, end_node_id, sections, token_count, created_at)`，`level` 取 `chapter` 或 `mainline`，同一故事、级别、起止节点唯一；`sections` 存 JSON，键固定为 `剧情脉络`、`人物档案`、`关系网`、`世界与设定`、`物品与资源`、`伏笔与约定`、`当前情况`、`用户意志`。
  - 后台任务 `compression`：每 `chapterSize`（默认 20）个已确认助手楼层生成一条章节压缩，输入为窗口原文与上一份压缩；每 5 条章节压缩生成一条主线压缩，输入为最近 5 条章节压缩。八个键必须齐全，值为字符串；缺键或类型不符整条拒绝并记录原因。
  - 有效性与 M2-T06 一致：起止节点都在当前路径上且起点在终点之前；重复执行不产生重复行；空窗口不调用模型。
  - 槽位提供者按预算注入主线与最近章节压缩，用户意志段永远保留；Trace 来源写 `compression:<level>`。
  验收：八段齐全且顺序固定；缺键、空正文、非字符串各抛错并指出字段；分支切换后旧压缩失效；重复执行不产生重复行；预算裁剪保留用户意志；`pnpm check` 通过。

- [ ] **R1-T06 后台预筛世界书** | 依赖：M2-T13、R1-T02、R1-T05 | DESIGN §7.3、§9 | ADR-0044
  做什么：
  - 迁移 v36 新增 `lore_prefilter(node_id PRIMARY KEY, story_id, entry_ids, created_at)`；`entry_ids` 存 JSON 数组。
  - 后台任务 `lore_prefilter`：回合落定后，用本轮用户消息、最近一条压缩摘要与下一拍方案构造查询；先用 BM25 取前 `prefilterLimit`（默认 20）条非恒常 lore，再由后台模型判断相关性并写入当前 head 楼层的预筛结果；恒常条目永远保留。
  - 下一轮组装时 `createLoreSlotProvider` 优先读当前 head 的预筛结果，没有记录时退回关键词与实体命中；回合内不调用模型。
  - 重复执行覆盖同一 `node_id`，不新增行；分支切换后只使用当前路径上的预筛结果。
  验收：回合内假客户端零调用；下一轮使用预筛结果；没有记录时回退正确；恒常条目始终注入；重复执行行数不变；分支隔离；`pnpm check` 通过。

- [ ] **R1-T08 上下文包复用** | 依赖：R1-T02.a、R1-T03.a、R1-T06、M2-T12 | DESIGN §7.3、§9 | ADR-0044
  做什么：
  - 迁移 v37 新增 `context_packs(node_id PRIMARY KEY, story_id, payload, created_at)`；`payload` 存检索结果、预筛世界书条目 id、现场分析引用与台账快照版本。
  - 第一次生成玩家楼层的回复时组装上下文并写入上下文包；swipe 与重新生成同一楼层直接读包，不重新检索、不重新调用 embedding 或预筛；包不存在时按现有路径组装并写入。
  - 玩家编辑输入产生新楼层，不继承旧包；包引用的条目被删或分析楼层不在当前路径时视为不存在，重新组装。
  - 包本身不触发模型调用；回合内只读，回合外只准备下一轮能提前准备的部分。
  验收：同一玩家楼层 swipe 两次只组装一次且结果一致；编辑输入后重新组装；引用失效时回退到重新组装；包不跨分支复用；`pnpm check` 通过。

- [ ] **R1-T99.a 记忆增强验收** | 依赖：R1-T03.a、R1-T03.b、R1-T04.b、R1-T05、R1-T06、R1-T08
  做什么：重跑门禁与 live 测试；逐条核对记忆增强的五项；对照 R1 最小集的数字给出检索与压缩的提升或下降，默认开关按证据设置并写 ADR；在 `docs/dev/reports/R1.md` 追加一节；复核 I5（快照只是缓存）、I11、I12。
  结果写 `MILESTONE_DONE`。

## R3b：深回合

- [ ] **R3b-T00 细化深回合任务** | 依赖：R3-T99、R5-T99 | DESIGN §10.1
  做什么：把 DESIGN §10.1 的深回合部分拆成可执行任务：单 agent 循环与防失控上限、故事级锁定与单轮开关、全部工具与权限、文本协议、进度事件、草稿与提交分开（草稿实时投影到界面，未提交不产生楼层）、导演手记挂在楼层树上按楼存修改并沿路径累加、运行日志只追加地并入 Trace、模板附带深回合配置、多轮工具调用原样回放原生元数据（尤其 Gemini 思考签名）并配工具循环测试与中转渠道实测、运行中追加要求。容忍协议漂移（ADR-0041 的 A9）：模型没有调用提交工具、直接输出了正文时按草稿接住，不判失败。验收指标：运行失败率明显低于 23%、漂移率、时长分布（以 TauriTavern 的 P50 66 秒、P90 147 秒为对照）与深回合相对快回合的增益。
  验收：任务清单可直接执行；`pnpm check` 通过。

- [ ] **R3b-T99 R3b 验收** | 依赖：R3b 全部任务
  做什么：逐条核对深回合循环、草稿与提交、手记、运行日志、原生元数据、追加要求与防失控上限；复核 I6（程序不自动切换）、I13；用真实渠道跑失败率与时长分布；写 `docs/dev/reports/R3b.md`；确认 P1 与 H 任务。
  结果写 `MILESTONE_DONE`。

## P：插件内核（DESIGN §19；ADR-0045）

> 位置与依赖由 ADR-0044 固定：P1 依赖 R5-T99；P2 依赖 P1 与 R5-T99；P3 依赖 P2；P4 依赖 P3；P5 依赖 P4 与 M5-T99；C 线依赖 P2。

- [ ] **P1 插件内核技术验证** | 依赖：R5-T99 | DESIGN §19.1、§19.6
  做什么：
  - 用两个最小原型各实现同一组扩展点（一个上下文槽位提供者、一个 Director 机制、一个块类型）：①直接依赖 Cordis 上游（MIT 版本）；②自研精简版（只做 Context、注册表、依赖解析、生命周期回收与五种分发模式）。
  - 比较类型体验（插件作者看到的是不是 Dramaticer 自己的类型）、热重载行为、依赖解析与循环检测、包体积与启动耗时、许可证与打包方式。
  - 写 ADR 决定采用哪一种，并登记依赖；无论选哪种，插件作者看到的 API 都由 `core` 定义。
  验收：两个原型都能通过门禁；比较表有数字与结论；ADR 入库并写清采用方式与依赖清单；`pnpm check` 通过。

- [ ] **P2 插件内核改造** | 依赖：P1、R5-T99 | DESIGN §19.1、§19.2
  做什么：
  - 引入 Context 与插件注册表：启动时解析 `inject` 与 `provide`，依赖缺失的插件不加载并记录原因，同名服务冲突启动失败，卸载时回收钩子、定时器与后台任务，支持热重载。
  - 把内置模块逐个改成插件：上下文槽位提供者、Director 机制、块类型、后台任务类型、工具，每个模块单独提交一次。
  - 实现五种分发模式与回合内钩子的时间预算：超时跳过并写入 Trace，`dramaticer explain` 能读出被跳过的扩展点与原因。
  - 每改一个内置模块都保持门禁与评测数字不退化；退化的模块回退成直接调用并记录原因。
  验收：每个内置模块都有注册表条目与对应测试；测试覆盖依赖缺失跳过、服务冲突、卸载回收、热重载、五种分发模式与超时跳过；每次改造后门禁通过且 R2 的基准数字不退化；`core` 不依赖任何插件（I15）。

- [ ] **P3 声明式插件格式与卡片打包** | 依赖：P2 | DESIGN §19.3、§19.4
  做什么：
  - 定稿声明式插件格式：台账 schema、剧情小品、原生模板、块渲染器（沙箱 HTML 模板）、`SKILL.md` 技能、导演配置、事件池。每种都有 schema 校验与版本字段。
  - 卡片可以在 `extensions.dramaticer` 里打包声明式插件与依赖声明；导入时提示缺少的插件与玩法包，给出安装建议，不静默降级。
  - 玩法包按有序补丁层叠加，用户覆盖不修改包文件；按故事启用插件与覆盖配置，同一故事的各条分支共享。
  - 提供示例声明式插件与格式文档。
  验收：声明式插件只含数据、不执行代码；卡片打包、导入提示与依赖缺失提示有测试；玩法包叠加与用户覆盖的优先级有测试；按故事的开关与覆盖有测试；示例插件通过 schema 校验；`pnpm check` 通过。

- [ ] **P4 代码插件：权限清单、worker 隔离、安装与更新** | 依赖：P3 | DESIGN §19.3、§19.4、§19.7
  做什么：
  - 代码插件清单：名称、版本、兼容的 Dramaticer 版本范围、`inject` 与 `provide`、配置 schema、权限（网络、文件、模型调用、台账写入等）、档位。
  - 安装时展示权限清单并等待确认；运行在 worker 隔离环境里，未声明的调用直接拒绝并写入 Trace，不做静默放行。
  - 从 npm、git、zip 安装与更新，卸载时回收全部副作用；权限变化时重新确认。
  - 插件开发文档与示例代码插件。
  验收：未声明权限的调用被拒绝并有 Trace；安装与更新的权限展示有测试；worker 崩溃不影响主进程并有测试；卸载回收副作用有测试；示例代码插件在沙箱里运行通过；`pnpm check` 通过。

- [ ] **P5 应用内插件市场** | 依赖：P4、M5-T99 | DESIGN §19.5
  做什么：
  - 在应用内浏览、搜索、安装与更新插件；显示权限与档位；支持从 git 地址安装。
  - 更新检查与版本兼容提示（兼容范围与本机版本不匹配时给出说明）。
  - 发布与上架由人类执行，市场只做浏览与安装。
  验收：市场界面能完成安装与更新；权限展示与 P4 的清单一致；版本不兼容时给提示不安装；发布操作不自动化；`pnpm check` 通过。

## 兼容插件线（DESIGN §6、§9、§19；ADR-0038，取代 C-T00）——依赖 P2，排在内核改造之后

- [ ] **C-T01 ST 沙箱与 prompt 一致性测试台** | 依赖：P2 | DESIGN §6、§9
  做什么：
  - 把 `D:\SillyTavern\` 的程序与数据复制到 `eval-private/st-sandbox/` 运行；原安装目录只读，不得修改、不得调用任何模型（I14）。
  - 启动本地录制服务，把沙箱里 ST 的 API 地址指向它；录制服务只记录请求，不调用模型。
  - 用 58 个预设 × 卡片 × 对话片段驱动 ST 生成，录下 ST 实际组装的请求；实现逐条比对工具，输出受支持功能的覆盖率与不一致清单（不一致逐条列出原因）。
  - 两种模式（ADR-0041 的 A10）：忠实模式关闭全部原生功能，用于一致性比对，目标是 100% 一致；共存模式按 ADR-0040 执行，不做一致性比对，只做开关对照评测。
  - 净室规则：ST 是 AGPL-3.0，只以录制下来的行为与测试作为规格，不移植或改写 ST 源码；其他上游项目（酒馆助手、MVU 等）逐个确认许可证并写进 `docs/dev/DEPENDENCIES.md`，许可证不允许的直接排除并记录。
  - 沙箱副本、录制结果与比对产物只留在 `eval-private/`，不进入提交。
  验收：录制服务在零模型调用下产出请求记录；比对工具对同一输入输出 100% 一致或逐条差异；原安装目录没有被写入；副本与录制数据没有被 git 跟踪；测试台提供「同一批卡开启与关闭兼容插件」的评测入口与原生指标（矛盾率、编造回忆率、盲测胜率、首字延迟）报告，供其余兼容插件共用（ADR-0040 共存验收）。

- [ ] **C-T02 P-A `st-content` 内容与 prompt 组装** | 依赖：C-T01、P2
  做什么：
  - 先搭一致性测试并让它变红，再实现：角色卡 V1/V2/V3（PNG/JSON）、群聊卡、人设、作者注释；世界书完整激活语义（主次关键词与逻辑、正则关键词、递归、sticky/cooldown/delay、分组与组内权重、概率、扫描深度、位置/深度/角色、outlet）；预设（`prompt_order`、深度注入、角色、预填充、续写预填充、squash、format 字段、采样参数）；完整宏引擎；完整正则语义；对话 jsonl 的导入导出。
  - 内容转换成原生模板与槽位，原生模型表达不了的按 ST 语义在插件里处理。
  验收：一致性测试覆盖的世界书、预设、宏、正则、卡片与对话导入用例全部通过；导入不丢字段；`core` 不出现 ST 概念（I1）；ST 内容按槽位进入原生预算分配器，Trace 分开显示 ST 与原生内容的 token 占比；写作契约保持在离生成最近的位置，导入时识别预设里的总结类与规划类条目；ST 正则、宏与 EJS 只作用于 ST 内容，不碰 harness 槽位；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [ ] **C-T03 P-C `st-mvu` MVU 兼容** | 依赖：C-T02
  做什么：
  - 先搭一致性测试并让它变红，再实现：`initvar`、`<UpdateVariable>`、JSONPatch、`[值, 说明]`、`$meta`（strictSet、extensible、模板）、zod schema 校验。
  - 变量映射为台账的一个命名空间；更新指令交给结算器校验和修复（I12）。
  - 脚本写变量后立刻读取要读到待结算的值：这一层是插件内的临时视图，结算后以台账为准（ADR-0041 的 A10）。
  - 修改消息分两类：改正文一律生成新 swipe（I4）；只改显示或元数据（状态栏刷新这类）写进插件自己的显示状态，不新建节点。
  验收：一致性测试的 MVU 用例全部通过；非法更新经结算器修复或拒绝并留 Trace；原楼层原文不可修改（I4）；MVU 变量与台账是同一套数据，没有第二份事实，读取路径与结算路径的测试证明这一点；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [ ] **C-T04 P-B `st-ejs` Prompt Template 兼容** | 依赖：C-T03
  做什么：
  - 先搭一致性测试并让它变红，再实现：世界书条目与预设里的 EJS 模板，包括 `getvar`/`setvar` 等函数、装饰器、激活正则与世界书条目的能力；模板在沙箱里执行。
  - 执行隔离（ADR-0041 的 A10）：EJS 在 worker 里执行，`node:vm` 不作为安全边界；模板发起的生成按卡限流并计入后台预算。
  - 作用范围：ST 正则、宏与 EJS 只作用于 history 槽位里的 ST 内容，不碰记忆、台账、导演与写作契约等 harness 槽位。
  验收：EJS 模板的一致性用例全部通过；沙箱逃逸测试通过；模板执行不影响台账事实（I12）；EJS 只作用于来自 ST 的内容，不修改 harness 槽位；模板执行与世界书递归激活计入回合内时间预算，超时写入 Trace；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [ ] **C-T05 P-D `st-helper-host` 酒馆助手宿主** | 依赖：C-T04
  做什么：
  - 先搭一致性测试并让它变红，再实现：执行酒馆助手脚本、角色卡内脚本、HTML 状态栏与开场页；运行在沙箱 iframe 里，提供与酒馆助手 API 对齐的变量读写、事件监听、`triggerSlash`/STscript、生成、读消息、改消息。
  - 修改消息一律映射成新建楼层或新的 swipe，不修改原文（I4）；只改显示或元数据的写进插件显示状态，不新建节点。
  - 执行隔离（ADR-0041 的 A10）：脚本在沙箱 iframe 里运行，`node:vm` 不作为安全边界；脚本发起的生成按卡限流并计入后台预算。
  验收：酒馆助手 API 覆盖率与一致性测试达到提案口径；修改消息不触碰原文；脚本在沙箱里运行；脚本发起的生成一律作为后台任务执行并在 Trace 里单独计数，走后台渠道、不进入回合内；脚本与正则的变量写入经过结算器；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

## H：应用内助手（排在 R5 与 R3b 之后，取代原侧边 agent）

- [ ] **H-T00 细化应用内助手** | 依赖：R5-T99、R3b-T99、E-T01 | DESIGN §10.3
  做什么：把抽屉界面与全部技能（排障、台账修订、参谋、资料员、卡片工坊、设置向导、使用指南）、类型化 server 接口、三级权限（只读、修改前确认、自动执行）、对话保存与搜索、关掉抽屉后任务继续运行与状态提示、上下文自动与手动压缩、用量环拆成任务；复用深回合的 agent 运行时，与正剧隔离：不写楼层，不进入剧情上下文；影响剧情的修改一律走变更卡并由结算器校验。写清依赖与验收。
  验收：任务清单可直接执行；应用内助手不写楼层、不进入剧情上下文；影响剧情的修改全部经过变更卡；`pnpm check` 通过。

## X：对比实验（排在 H 之后）

- [ ] **X1 世界模型表示方式对比** | 依赖：R1-T99.a、R2-T99 | DESIGN §14.4
  做什么：
  - 候选：① 现有台账（硬事实）；② 台账加实体 Wiki 页（软知识：性格变化、关系史，带出处楼层与版本历史）；③ 时序知识图谱（事实标记失效而不删除，支持按时间点查询）。三个候选通过同一个读写接口切换，用配置选择，不改调用方。
  - 在 3 个对话、固定轮数、同一批记忆题与探针上比较矛盾率、编造回忆率、盲测胜率与每轮成本；每种候选至少重复 3 次。
  - 判定：主要指标不劣于候选 ①，且盲测胜率明显高于 ① 才切换；否则保留 ①。设计与结论写 ADR，未切换的候选代码删除或留在开关后面。
  验收：三种候选各自可运行并产出同一格式的指标表；判定按规则执行；ADR 入库；`pnpm check` 通过。

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
