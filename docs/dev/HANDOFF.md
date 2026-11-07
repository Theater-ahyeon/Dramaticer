# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：40
- 任务：M2-T05 事件抽取
- 结果：完成（`DONE`）。
  - 迁移 v7：新增 `memory_events(row_id, id, story_id, source_node_id, ordinal, story_time, location, participants, importance, knowers, text, created_at)`。`UNIQUE(source_node_id, ordinal)`；`participants` 与 `knowers` 存 JSON 数组；`importance` 由 CHECK 限制在 0 到 1；触发器拒绝 `story_id` 与来源楼层不一致的插入，拒绝 UPDATE 与 DELETE。
  - `StoryStore` 新增 `insertMemoryEvents`：先逐条校验（楼层存在且属于同一故事、`ordinal` 非负整数、`text` 非空、`importance` 在 0 到 1、数组元素非空字符串、可选字段非空），再在单个事务里写入；任一条非法时整批回滚。`getEventsForPath(nodeId, {limit, offset})` 用递归 CTE 取根到该节点的路径，按楼层顺序、楼层内 `ordinal` 返回事件，默认 100 条、上限 1000。`countEventsForNode(nodeId)` 供重复执行判断。
  - core 新增 `memory/event.ts`（`MemoryEvent`、`NewMemoryEventInput`、`GetEventsForPathOptions`、`EVENT_WINDOW_FLOORS = 8`）与 `memory/extract.ts`（`parseEventExtraction`、`createEventExtractionHandler`）。
  - 抽取窗口是任务楼层及其沿路径往前最多 8 楼（总计最多 9 楼）；提示词要求只输出 JSON 数组，每项 `text`、`participants`、`knowers`、`importance`、可选 `storyTime` 与 `location`。解析容忍外层代码块，其余一律严格：根必须是数组、未知字段、类型不符、空字符串、`importance` 越界都抛错，不写入任何事件。
  - 同一楼层已有事件时处理器直接返回，不再调用模型；`dramaticer work` 的默认注册表登记了 `events` 处理器，后台客户端仍由 `background` 别名创建。
  - 新增 8 个测试（解析 2、存储 3、任务 3），覆盖合法批量写入、分页与分支隔离、整批回滚、触发器拒绝修改删除、非法输出记失败并保留原因、重跑不重复、窗口边界。
  - 门禁：`pnpm check` 通过（47 个测试文件、378 个测试，2 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T05 完成；下一会话执行 M2-T06（分层摘要）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 7（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`）。M2-T06 会迁移到 v8。
- 后台任务注册表：`dramaticer work` 默认只登记 `events`；摘要等其他类型由各任务自行登记进默认注册表。
- 实体表目前只在 chat 启动时由角色卡填充；世界书的实体导入函数已就位，等 M2-T13 导入 lore 条目时调用。卡内嵌世界书（`character_book`）尚未转换。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。M2 的记忆任务会强化提示词。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T06（分层摘要）：
  - 迁移 v8：`summaries(id, story_id, level, start_node_id, end_node_id, text, token_count, created_at)`，`level` 取 `chapter` 或 `mainline`，同一故事、级别、起止节点唯一。
  - `isSummaryValid(summary, headNodeId)` 要求起止节点都在 head 的路径上且起点在终点之前；`getValidSummaries(storyId, headNodeId)` 只返回有效摘要。
  - 后台任务类型 `summary`：每 20 个已确认的助手楼层生成一条章节摘要，覆盖上一章节结束之后的楼层；每 5 条章节摘要生成一条主线摘要；窗口大小做成可注入参数。
  - 摘要请求只使用窗口内的楼层原文；写入前校验 `text` 非空，`token_count` 用现有 `createTokenEstimator` 重新计算。
  - 验收见 `docs/dev/TASKS.md` 的 M2-T06。
- 之后按 M2-T07 到 M2-T15 的顺序执行；向量索引也要通过 M2-T03 的注册表登记处理器。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli`、`runChatCli`、`runWorkCli` 的实现在 core，st-compat 的 `cli.ts` 只做分发。
- 状态快照只是缓存（不变量 I5）：只有 `getStateSnapshot` 写缓存，`appendStateDiffs` 在同一事务里失效该楼层与全部后代；不要另加减 diff 的接口。
- 后台任务只对已确认楼层入队；不要绕过注册表直接调用处理器，也不要让 `runChatTurn` 引入后台客户端（不变量 I6）。
- 事件记忆只追加：不要新增更新或删除事件的接口；同一楼层重复抽取前用 `countEventsForNode` 判断。
- 实体按规范化名称合并是唯一入口；新增数据源请走 `upsertEntity`，不要直接写 `entities`。别名不跨故事唯一是 ADR-0017 的决定，不要加故事内唯一约束。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- M2 的向量索引要新增 `sqlite-vec`；安装前先查 `node_modules` 与包的类型定义，并登记依赖。
