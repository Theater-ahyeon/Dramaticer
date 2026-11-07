# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：41
- 任务：M2-T06 分层摘要
- 结果：完成（`DONE`）。
  - 迁移 v8：新增 `summaries(row_id, id, story_id, level, start_node_id, end_node_id, text, token_count, created_at)`；`level` 只取 `chapter` 或 `mainline`；`UNIQUE(story_id, level, start_node_id, end_node_id)`；`token_count` 由 CHECK 限制为正数；触发器拒绝起止楼层与 `story_id` 不一致的插入。
  - `StoryStore` 新增 `insertSummary`：校验故事、级别、起止楼层存在且属于同一故事，起点必须是终点的祖先并且起点在终点之前，正文去掉首尾空白后非空；`token_count` 在存储层用 `createTokenEstimator` 计算，调用方不能传入。重复区间由唯一约束拒绝。
  - `isSummaryValid(summary, headNodeId)` 与 `getValidSummaries(storyId, headNodeId)` 以调用方给的节点为当前路径：起止节点都在路径上且起点在终点之前才有效。`getValidSummaries` 先返回章节、再返回主线，各自从早到晚。
  - `countConfirmedAssistantNodesOnPath(nodeId)` 用一条递归 CTE 统计路径上已确认（有子节点）的助手楼层数。
  - core 新增 `memory/summary.ts`（`SummaryLevel`、`Summary`、`NewSummaryInput`、`DEFAULT_CHAPTER_SIZE = 20`、`DEFAULT_MAINLINE_SIZE = 5`、`isSummaryLevel`）与 `memory/summarize.ts`（`parseSummaryText`、`createSummaryHandler`）。
  - 章节摘要：已确认助手楼层数是 `chapterSize` 的整数倍时生成，窗口是当前路径上上一章节终点之后到任务楼层的全部原文（用户楼层也在内）；没有上一章节时从根楼层开始。上一章节已覆盖任务楼层时直接跳过，不调用模型。
  - 主线摘要：有效章节摘要数是 `mainlineSize` 的整数倍、且最后一条主线没有覆盖最新章节终点时生成，窗口是最近 `mainlineSize` 条有效章节摘要。`chapterSize` 与 `mainlineSize` 都可注入。
  - 模型输出只接受去掉首尾空白后的非空正文，否则抛错并由后台任务记录失败；重跑按已有摘要判断，不依赖任务状态，因此章节失败后重试只补缺失的一级。
  - `dramaticer work` 的默认注册表同时登记 `events` 与 `summary`。
  - 新增 10 个测试（存储 4、输出解析 1、章节 2、主线 1、边界 2），覆盖路径有效性、分支失效、唯一约束、token 计算、窗口范围、重跑不重复、空窗口不调用模型、非法窗口参数。
  - 门禁：`pnpm check` 通过（48 个测试文件、388 个测试，2 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T06 完成；下一会话执行 M2-T07（剧情笔记）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 8（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`、`summaries`）。M2-T07 会迁移到 v9。
- 后台任务注册表：`dramaticer work` 默认登记 `events` 与 `summary`；其他类型由各任务自行登记进默认注册表。
- 实体表目前只在 chat 启动时由角色卡填充；世界书的实体导入函数已就位，等 M2-T13 导入 lore 条目时调用。卡内嵌世界书（`character_book`）尚未转换。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。M2 的记忆任务会强化提示词。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T07（剧情笔记）：
  - 迁移 v9：`plot_notes(id, story_id, source_node_id, text, status, created_at, fulfilled_at)`，`status` 取 `open` 或 `fulfilled`。
  - `runChatTurn` 在写助手楼层的同一事务里保存 `structured.notes`；触发器只允许更新 `status` 与 `fulfilled_at`。
  - `fulfillPlotNote(noteId, at)` 只接受 `open` 笔记；`getOpenPlotNotes(storyId)` 按创建顺序返回；已兑现笔记再次兑现抛错。
  - 两种结构化输出模式共用同一条写入路径；事务失败时助手楼层与笔记一起回滚。
  - 验收见 `docs/dev/TASKS.md` 的 M2-T07。
- 之后按 M2-T08 到 M2-T15 的顺序执行；向量索引也要通过 M2-T03 的注册表登记处理器。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli`、`runChatCli`、`runWorkCli` 的实现在 core，st-compat 的 `cli.ts` 只做分发。
- 状态快照只是缓存（不变量 I5）：只有 `getStateSnapshot` 写缓存，`appendStateDiffs` 在同一事务里失效该楼层与全部后代；不要另加减 diff 的接口。
- 后台任务只对已确认楼层入队；不要绕过注册表直接调用处理器，也不要让 `runChatTurn` 引入后台客户端（不变量 I6）。
- 事件记忆只追加：不要新增更新或删除事件的接口；同一楼层重复抽取前用 `countEventsForNode` 判断。
- 摘要按闭区间记录起止楼层，起点必须是终点的祖先且不能等于终点；有效性只按调用方给的路径计算，切分支后不要删除摘要行。主线摘要的输入是章节摘要，不重新读原文（ADR-0018）。
- 实体按规范化名称合并是唯一入口；新增数据源请走 `upsertEntity`，不要直接写 `entities`。别名不跨故事唯一是 ADR-0017 的决定，不要加故事内唯一约束。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- M2 的向量索引要新增 `sqlite-vec`；安装前先查 `node_modules` 与包的类型定义，并登记依赖。
