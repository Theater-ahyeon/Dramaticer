# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：63
- 任务：M3-T07 节奏状态机
- 结果：完成（`DONE`）。
  - core 新增 `director/pacing.ts`，机制名 `pacing`，注册在 `event_pool` 之后，优先级 5（低于事件池 10，有更具体的建议时让位）。
  - 张力优先读配置 `tensionPath` 的状态快照值：必须是 0 到 1 之间的数字，越界或类型不符直接抛错；路径不存在时回退推导。
  - 推导张力只看当前路径最近 3 个已确认助手楼层（`TENSION_WINDOW_FLOORS = 3`）：状态 diff 总数除以 `3 × tensionStateDiffsPerFloor`（默认 2）、新建笔记数除以 `3 × tensionNotesPerFloor`（默认 1）、这三个楼层里最后一个事件的重要度；权重 `tensionStateWeight = 0.4`、`tensionNoteWeight = 0.3`、`tensionEventWeight = 0.3`，三分量都截断到 0 到 1，加权和再截断。
  - 阶段转移：`setup` 在张力 ≥ 0.33 且持续 `max(1, ceil(minSetupFloors / pace))` 楼后进入 `escalate`；`escalate` 在张力 ≥ 0.67 且持续 `max(1, ceil(minEscalateFloors / pace))` 楼后进入 `climax`；`climax` 持续 7 楼后进入 `breathe`；`breathe` 持续 6 楼后回到 `setup`。`minSetupFloors` 与 `minEscalateFloors` 默认 2，`pace` 默认 1。
  - 只在阶段变化时触发建议，每个阶段一条固定指令（`setup` 在喘息结束后出现）；当前阶段、张力来源、分量、阈值、权重、`phaseStartNodeId` 与 `changed` 写入 `signals.pacing`。
  - 状态恢复：按当前路径的决策记录取最近一条 `signals.pacing`，已持续楼层数等于当前位置减去 `phaseStartNodeId` 的位置；起点不在当前路径时按没有历史处理；分支切换只读当前路径。
  - 配置新增 `tensionPath`（可选）、`tensionEscalate`、`tensionClimax`、三个张力权重、`tensionStateDiffsPerFloor`、`tensionNotesPerFloor`、`pace`、`minSetupFloors`、`minEscalateFloors`、`climaxFloors`、`breatheFloors`；非法路径、阈值、权重、`pace` 与楼层参数在评估时抛错。
  - 测试：新增 `packages/core/test/pacing.test.ts`（6 个：无历史、四类转移、`pace` 快慢、分支隔离、推导张力、非法配置）；三个既有机制列表断言补 `pacing`；门禁 `pnpm check` 通过（72 个测试文件，558 个测试通过，3 个 live 跳过）；ADR-0026。

## 当前状态
- M0、M1、M2、D-T01 至 D-T04、M3-T00 至 M3-T07 完成。
- 门禁：`pnpm check` 通过（558 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 16。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。

## 下一步
- **M3-T08**（下一个会话）：Director 开关对比评测。依赖已全部满足（T02、T04、T05、T06、T07、D-T04）。新增 `pnpm --filter @dramaticer/st-compat director-eval`：从 `eval-private/raw/` 读取评测对话，按固定间隔选分支点，用后续真实用户消息回放；同一分支点分别以导演开启与关闭生成，各运行 `pairs` 次（默认 3）。报告给出开启与关闭的相邻块 Jaccard、M3-T06 节拍余弦、线索回收率（新建与兑现笔记数、兑现时平均年龄）与每个机制的触发/被选中次数；单个分支点失败不中断整批；详细报告写 `eval-private/reports/m3-director.md`，统计版写 `docs/dev/reports/M3-director.md`（只含数字、模型别名与配置）。回放框架用注入的假生成器补单元测试，真实渠道运行记录写进报告与 HANDOFF。回放时注意 Director 只在阶段变化时输出节奏指令，`setup` 初始不输出。
- 然后 M3-T99（M3 验收），重点复核 I6、I7、I9 与 T08 的重复度、线索回收率门槛。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- 状态题 JSONL 必须带 `path`（非空字符串数组）；事件题不要带这个字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。
- 参照报告默认读取 `eval-private/reports/reference-cosine.json` 里的余弦校准；更换 embedding 模型或维度后要重新运行 `reference:cosine`。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。
