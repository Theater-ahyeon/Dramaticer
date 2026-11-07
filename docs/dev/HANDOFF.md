# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：42
- 任务：M2-T07 剧情笔记
- 结果：完成（`DONE`）。
  - 迁移 v9：新增 `plot_notes(row_id, id, story_id, source_node_id, text, status, created_at, fulfilled_at)`；`status` 只取 `open` 或 `fulfilled`；表级 CHECK 要求未兑现的 `fulfilled_at` 为空、已兑现的不为空；`story_id` 必须与来源楼层一致。
  - 触发器 `plot_notes_immutable_fields` 只允许更新 `status` 与 `fulfilled_at`，修改 `id`、`story_id`、`source_node_id`、`text`、`created_at` 直接中止；`plot_notes_no_delete` 拒绝删除。
  - core 新增 `memory/plot-note.ts`（`PlotNoteStatus`、`PlotNote`、`NewPlotNoteInput`、`isPlotNoteStatus`）。
  - `StoryStore` 新增 `insertPlotNotes`：逐条校验故事、来源楼层与正文，正文去掉两端空白后非空，id 与创建时间可注入；整批在一个事务里写入，任一条非法全部回滚。
  - `getOpenPlotNotes(storyId)` 按插入顺序返回未兑现笔记；`fulfillPlotNote(noteId, at)` 只接受未兑现笔记，写入 `status = 'fulfilled'` 与 `fulfilled_at`，已兑现或不存在直接抛错。
  - `runChatTurn` 在写助手楼层的同一事务里调用 `insertPlotNotes`，文本标签模式与函数调用模式共用这一条路径；`ChatTurnResult` 新增 `plotNotes`。
  - 新增 5 个测试（存储 4、chat 回滚 1），并在两种结构化模式的 chat 测试里断言笔记落库与来源楼层。事务回滚测试用第二个连接给 `plot_notes` 装中止触发器，验证助手楼层与笔记一起回滚。
  - 门禁：`pnpm check` 通过（49 个测试文件、393 个测试，2 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T07 完成；下一会话执行 M2-T08（运行时分块与 BM25 索引）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 9（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`、`summaries`、`plot_notes`）。M2-T08 会迁移到 v10。
- 后台任务注册表：`dramaticer work` 默认登记 `events` 与 `summary`；其他类型由各任务自行登记进默认注册表。
- 实体表目前只在 chat 启动时由角色卡填充；世界书的实体导入函数已就位，等 M2-T13 导入 lore 条目时调用。卡内嵌世界书（`character_book`）尚未转换。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。M2 的记忆任务会强化提示词。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T08（运行时分块与 BM25 索引）：
  - 迁移 v10：新增 `chunks(id INTEGER PRIMARY KEY, story_id, node_id, ordinal, text)` 与 FTS5 trigram 的 `chunks_fts`。
  - `appendNode` 在同一事务里用现有 `chunkText` 与 `normalizeRetrievalText` 写入该楼层的块。
  - 迁移后回填已有楼层；回填可重复执行，不产生重复块。
  - `searchChunks(query, {storyId, beforeNodeId, limit})`：`beforeNodeId` 只搜索祖先路径、排除自身与其他分支；不传时搜索整个故事。
  - 离线 `ChunkIndex` 继续保留给 st-compat 的基线评测，运行时检索只读 `StoryStore`。
  - 验收见 `docs/dev/TASKS.md` 的 M2-T08。
- 之后按 M2-T09 到 M2-T15 的顺序执行；向量索引也要通过 M2-T03 的注册表登记处理器。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli`、`runChatCli`、`runWorkCli` 的实现在 core，st-compat 的 `cli.ts` 只做分发。
- 状态快照只是缓存（不变量 I5）：只有 `getStateSnapshot` 写缓存，`appendStateDiffs` 在同一事务里失效该楼层与全部后代；不要另加减 diff 的接口。
- 后台任务只对已确认楼层入队；不要绕过注册表直接调用处理器，也不要让 `runChatTurn` 引入后台客户端（不变量 I6）。
- 事件记忆只追加：不要新增更新或删除事件的接口；同一楼层重复抽取前用 `countEventsForNode` 判断。
- 摘要按闭区间记录起止楼层，起点必须是终点的祖先且不能等于终点；有效性只按调用方给的路径计算，切分支后不要删除摘要行。主线摘要的输入是章节摘要，不重新读原文（ADR-0018）。
- 剧情笔记只追加：正文与来源楼层写入后不可修改，唯一允许的变更是 `status` 与 `fulfilled_at`；兑现只能从未兑现状态出发，不要新增删除或改写正文的接口。
- 实体按规范化名称合并是唯一入口；新增数据源请走 `upsertEntity`，不要直接写 `entities`。别名不跨故事唯一是 ADR-0017 的决定，不要加故事内唯一约束。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- M2 的向量索引要新增 `sqlite-vec`；安装前先查 `node_modules` 与包的类型定义，并登记依赖。
