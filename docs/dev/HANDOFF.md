# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：60
- 任务：M3-T04 事件池选择与停滞检测
- 结果：完成（`DONE`）。
  - `StoryStore` 新增 `countPlotNotesForNode(nodeId)`，统计来源楼层新建的剧情笔记数，已兑现的同样计入。
  - 迁移 v15 给 `event_pool` 增加 `enabled`（默认 1）；`EventPoolEntry` 与 `NewEventPoolEntryInput` 增加 `enabled`，重复导入会更新它；st-compat 的 `importDramaticerExtension` 把卡里的 `enabled` 写进事件池。
  - core 新增 `director/event-pool.ts`：`createEventPoolMechanism()` 与 `stableUnitHash`。停滞判定为当前路径最近 `stallFloors`（默认 3）个已确认助手楼层都没有状态 diff、也没有新建笔记；楼层不足或事件池为空直接跳过。
  - 事件选择：条件用当前楼层的 `getStateSnapshot` 与 `evaluateContextCondition`（switches 为空）；冷却读取当前路径 `director_decisions` 的 `signals.eventPool.selectedSourceId`，当前楼层自己的旧记录不算，距离小于等于 `cooldown` 视为仍在冷却；合格事件按上次使用位置升序、`source_id` 升序排序，再用 `(storyId, nodeId, sourceId)` 的 FNV-1a 哈希与 `surprise` 比较（0 永不触发，1 停滞即触发）；指令直接使用事件正文。
  - `DirectorConfig` 增加 `stallFloors` 与 `surprise`（默认 3、1），`DEFAULT_DIRECTOR_MECHANISMS` 注册 `event_pool`，优先级 10（低于线索的 20/30）。决策 signals 以 `eventPool` 键记录检查过的楼层、候选、跳过原因与选中事件，不修改 `event_pool` 表，不调用模型。
  - 测试：新增 `packages/core/test/director-event-pool.test.ts`（7）、`plot-notes.test.ts` 与 `event-pool.test.ts` 各 1 个存储用例、`dramaticer-extension.test.ts` 的停用事件用例（1），另有默认机制列表相关的既有断言更新；门禁 `pnpm check` 通过（66 个测试文件、531 个测试）。

## 当前状态
- M0、M1、M2、D-T01 至 D-T04、M3-T00 至 M3-T04 完成。
- 门禁：`pnpm check` 通过（531 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 15。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。

## 下一步
- **M3-T05**（下一个会话）：新增后台任务类型 `npc_agenda`，只在章节边界执行（当前路径已确认助手楼层数是 `chapterSize` 的整数倍，默认 20）；没有议程时不调用模型；输入为该章节摘要或同窗口原文加全部 NPC 目标与上次进度，输出 `{npc, progress}` JSON 数组；严格校验后在一个事务里更新 `progress` 与 `last_advanced_node_id`，并写入 `与此同时：<progress>` 的 `memory_events`；按 `last_advanced_node_id` 跳过重复执行；`everyChapters` 决定推进的章节边界；`dramaticer work` 注册处理器。
- 然后依次 M3-T06（重复检测）→ M3-T07（节奏状态机）→ M3-T08（开启与关闭导演的对比回放）。
- 参照基线数字已经就位，M3-T06/T07 直接读 ADR-0025，不要重新从对话语料推导阈值。

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
