# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：74
- 任务：R1-T01 台账结构与 MVU 映射
- 结果：完成（`DONE`），门禁通过（629 个测试）。
  - `packages/core/src/ledger/schema.ts`：`LEDGER_NAMESPACES` 九个命名空间、`CHARACTER_TIERS`、`AFFECTION_LEVELS`（敌对/冷淡/平常/亲近/倾心）、`CLUE_STATUSES`（open/progress/fulfilled）、`USER_WILL_KINDS`、`validateLedgerDiff`（校验命名空间、路径段非空、set 值必须是 JSON 值、各字段类型与范围、线索状态；错误信息带完整路径）、`mvuLedgerPath`。实体级路径（`character.<id>`、`relation.<from>.<to>`、`item.<id>.log`、`scene.current` 等）只允许删除，字段必须逐项写入。
  - `packages/core/src/ledger/read.ts`：`readLedger(store, nodeId, prefix?)` 复用 `getStateSnapshot` 并按前缀返回子树；`listLedgerEntities` 返回按 id 排序的人物、关系与未兑现线索（`status === "fulfilled"` 的不进入列表）；台账前缀非法、楼层不存在时抛错。
  - `packages/st-compat/src/chat-import.ts`：MVU 快照 diff 统一改为 `["mvu", ...原路径]`；没有 MVU 的楼层不产生 `mvu` 命名空间。
  - 测试：`packages/core/test/ledger.test.ts` 6 个用例（九个命名空间各一条合法 diff、12 组非法路径/值、前缀读取、分支隔离、已兑现线索、前缀与楼层错误）；`chat-import.test.ts` 与 `state-questions.test.ts` 改为在 `mvu` 子树里核对，新增 `store-replay.ts` 的 `mvuSnapshotAt`。
  - 文档：ADR-0034 记录路径结构、枚举取值、删除规则与“不迁移旧库”；DESIGN §7.1 增加路径表。
  - 会话中人类追加 v2.1 补充提案（`docs/proposals/v2.1.md`），已分拣为 R0-T02（ADR-0035、A1–A9 合并、X1/X2 实验）与 R1-T01.a（台账事实补 `storyTime` 与 `source`）；R1-T02 的依赖已加上 R1-T01.a。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T06、R0-T01、R1-T01 完成；R0-T02 待做。
- 数据库 schema 版本 17。
- 台账现在只有结构与读取，**没有写入校验的强制点**：`appendStateDiffs` 不调用 `validateLedgerDiff`；R1-T02 的结算器负责在写入前校验（I12）。现有结构化输出 `state_update` 仍可写任意路径。
- `packages/core` 的现有模块（楼层树、快照、后台任务、事件、摘要、笔记、检索、Director v1、上下文组装、执行器）全部保留；v2 的结算器、八段式压缩、世界书预筛与用户意志在 R1 新增或替换，届时删除被取代的实现与测试。
- `packages/server` 已提供故事、导入、设置、模板、SSE 回合与后台运行时缓存；R5 再补后台调度、分支与面板接口。
- `packages/protocol` 已提供 HTTP 与 SSE 类型；`packages/web` 尚未创建。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；R1-T03 负责批量回填。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。

## 下一步
- **R0-T02 合并 v2.1 补充提案**（依赖 R1-T01）：写 ADR-0035，记录“直接采纳 / 用评测决定 / 暂缓”三分法；把 A1–A9 合并进 DESIGN 并转成任务，A4 父子分块与 A5 重排序必须排在 R1-T04.b 之前，A7/A8 写进 R3-T00 细化说明，A9 落到 R1-T02 或 R2 配置层；R2-T99 之后新增 X1（世界模型表示方式）与 X2（Director 组织方式），写清候选、指标与“只有显著胜出才切换”；第三节暂缓项写进 DESIGN 后续方向，不建任务。
- **R1-T01.a 台账事实补 storyTime 与 source**：按 v2.1 第二节，`storyTime`（起止都可空）与 `source`（model/settler/player/import）成为每条台账事实的元数据；`validateLedgerDiff` 校验类型与取值，导入 MVU 的来源为 import；读取能读回，R1-T01 的路径与快照语义不变。
- **R1-T02 台账结算器**：
  - 迁移 v18 新增 `ledger_settlements(node_id PRIMARY KEY, story_id, source, added_count, repairs, created_at)`；`repairs` 存 JSON 数组 `{path, action, reason}`，加同故事触发器。
  - 后台任务 `settle`：沿当前路径取最多 `settleWindowFloors`（默认 4）个已确认、尚未结算的助手楼层；一次请求返回 `{nodeId, diffs}` 数组。楼层内解析或校验失败时整条拒绝并记 `repairs`，其余楼层照常写入；整次请求失败按 M2-T03 规则重试。
  - 模型已写的路径优先，结算器只补缺失路径；修复动作限定为补值、删除非法条目、改写线索状态。所有 diff 在写入前调用 R1-T01 的 `validateLedgerDiff`，写入在一个事务里完成，重复结算不新增 diff，swipe 与编辑节点各自结算。
  - 结算在间隙执行，`generateAssistantTurn` 不等待；没有后台客户端时任务保持 pending。
  - 验收：模型路径不被覆盖、缺失路径补齐、非法条目拒绝并记录原因、重复执行不产生重复行、分支切换后另一分支结算不参与、回合内后台客户端零调用。
- 之后按 TASKS 顺序：R1-T03 批量事件抽取、R1-T04.a/.b 回填与记忆评测重跑、R1-T05 八段式压缩（v19）、R1-T06 世界书预筛（v20）、R1-T07 用户意志、R1-T99。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。v2 的不变量已由人类改好：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请。
- 服务端启动时提供 `channels` 就会加载渠道配置；配置缺失或环境变量没设置会让启动失败，这是有意的快速失败。测试里通过 `channels.load` 与 `createClient` 注入假客户端。
- SSE 测试的临时目录用 `packages/server/test/.tmp-server-*`，已忽略；假渠道的 baseUrl 用 `127.0.0.1`，I10 允许。
- 中止保存的部分正文会写 Trace，`stopReason` 为 `aborted`，`usage` 全为 `null`；不要把它当成正常完成。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟。R1 的批量窗口应显著减少请求数，仍然不要在单个会话里等待整轮回填跑完；用 `--resume` 与缓存续跑。
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
