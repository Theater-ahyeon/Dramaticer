# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：59
- 任务：M3-T03 卡扩展 extensions.dramaticer 与事件池存储
- 结果：完成（`DONE`）。
  - core 新增 `context/condition.ts` 的 `parseContextCondition`（`switch` 可关闭，`state` 的 `op` 与 `value` 严格校验），`json.ts` 新增 `assertJsonValue`、`assertPlainObject`、`rejectUnknownKeys`；`store/json-value.ts` 改为复用同一个 JSON 校验。
  - core 新增 `director/card-extension.ts` 的 `DramaticerCardExtension` 与 `parseDramaticerCardExtension`：没有 `extensions.dramaticer` 时返回空扩展；有值时拒绝未知字段、空字符串、重复 `id`、负冷却、非正整数 `everyChapters`、越界 `importance` 与 `switch` 条件，错误信息带条目下标与字段路径。
  - core 新增 `director/pool.ts` 的类型；迁移 v14 新增 `event_pool`（`PRIMARY KEY(story_id, source_id)`）与 `npc_agendas`（`PRIMARY KEY(story_id, entity_id)`，`progress` 默认空字符串），触发器拒绝跨故事实体与推进楼层，并禁止修改议程的故事与实体。
  - `StoryStore` 新增 `upsertEventPool`（重复导入更新文本、条件、冷却与来源，保留 `created_at`）、`listEventPool`、`upsertNpcAgendas`（更新目标、章节间隔、重要度，保留 `progress` 与 `last_advanced_node_id`）、`listNpcAgendas`。
  - st-compat 新增 `importDramaticerExtension(store, storyId, card)`：NPC 名称或别名解析为 `character` 实体，找不到或对应多个都抛错并指出条目；`dramaticer chat` 在导入卡与世界书之后调用它。
  - 测试：新增 `packages/core/test/card-extension.test.ts`（7）、`event-pool.test.ts`（7）、`packages/st-compat/test/dramaticer-extension.test.ts`（6）与 `chat-cli.test.ts` 的扩展导入用例（1），共 21 个；门禁 `pnpm check` 通过（65 个测试文件、521 个测试）。

## 当前状态
- M0、M1、M2、D-T01 至 D-T04、M3-T00 至 M3-T03 完成。
- 门禁：`pnpm check` 通过（521 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 14。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。

## 下一步
- **M3-T04**（下一个会话）：`StoryStore` 增加 `countPlotNotesForNode(nodeId)`；core 新增事件池机制，停滞判定为当前路径最近 `stallFloors`（默认 3）个已确认助手楼层既没有状态 diff、也没有新建剧情笔记；条件用当前楼层的 `getStateSnapshot` 与 `evaluateContextCondition`；冷却读取当前路径的 `director_decisions`；合格事件按“上次使用位置升序、`source_id` 升序”取第一条；`surprise` 用 `(storyId, nodeId, source_id)` 稳定哈希做门槛。
- 然后依次 M3-T05（NPC 议程后台任务，按 `everyChapters` 在章节边界推进并写 `memory_events`）→ M3-T06（重复检测）→ M3-T07（节奏状态机）→ M3-T08（开启与关闭导演的对比回放）。
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
