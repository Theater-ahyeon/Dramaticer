# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：43
- 任务：M2-T08 运行时分块与 BM25 索引
- 结果：完成（`DONE`）。
  - 迁移 v10：新增 `chunks(id INTEGER PRIMARY KEY, story_id, node_id, ordinal, text)`，`UNIQUE (node_id, ordinal)`；`chunks_fts` 是 FTS5 trigram 表，`rowid` 对应 `chunks.id`；插入触发器要求块的 `story_id` 与楼层一致。
  - `chunks.text` 保存 `chunkText` 产出的原始块文本；写入 `chunks_fts` 的文本先经过 `normalizeRetrievalText`（NFKC、去标点/符号/空白）。规范化后为空的块只跳过索引，不写 `chunks` 行。
  - `appendNode` 在写楼层、移动 head 的同一个事务里调用 `#indexNodeChunks`，因此楼层与块一起提交或回滚。
  - `StoryStore.open` 在迁移之后回填：只处理还没有任何块的楼层，按 `rowid` 顺序逐楼写入；`ON CONFLICT (node_id, ordinal) DO NOTHING` 保证重复打开或重复调用不产生重复块。空文本楼层没有块，每次打开会重新尝试，但没有写入。
  - `countChunksForNode(nodeId)` 返回块数。
  - `searchChunks(query, {storyId, beforeNodeId, limit})`：`buildTrigramQuery` 生成查询；`beforeNodeId` 只保留递归祖先路径（从父节点开始，排除自身），不传时搜索整个故事；`limit` 默认 20，范围 1 到 1000。
  - SQL 先把 `bm25(chunks_fts)` 放在内层 `matches` CTE 里计算，外层 `ranked` CTE 再用 `ROW_NUMBER()` 按楼层去重并保留分数最好的块。直接把 `bm25` 写进窗口表达式会报 `unable to use function bm25 in the requested context`。
  - 新增 `packages/core/test/chunks.test.ts` 6 个测试：块数与 `chunkText` 一致、分支过滤、全角与标点查询、同楼层多块只占一位、v9 数据库回填与重复打开、参数与跨故事校验。
  - 门禁：`pnpm check` 通过（50 个测试文件、399 个测试，2 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T08 完成；下一会话执行 M2-T09（embedding 客户端与向量索引）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 10（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`、`summaries`、`plot_notes`、`chunks`、`chunks_fts`）。M2-T09 会迁移到 v11。
- 运行时检索索引在 `StoryStore` 内；`ChunkIndex` 只留给 st-compat 的 M0 基线评测，不要再把运行时检索接到它上面。
- 后台任务注册表：`dramaticer work` 默认登记 `events` 与 `summary`；其他类型由各任务自行登记进默认注册表。
- 实体表目前只在 chat 启动时由角色卡填充；世界书的实体导入函数已就位，等 M2-T13 导入 lore 条目时调用。卡内嵌世界书（`character_book`）尚未转换。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。M2 的记忆任务会强化提示词。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T09（embedding 客户端与向量索引）：
  - 先查 `node_modules` 与包的类型定义，确认 `sqlite-vec` 的加载方式，再登记到 `docs/dev/DEPENDENCIES.md`。
  - `StoryStore.open` 加载 `sqlite-vec` 扩展；迁移 v11 新增 `chunk_vectors` 的 vec0 表，行号对应 `chunks.id`，维度来自配置（bge-m3 为 1024）。
  - 新增 `EmbeddingClient`（OpenAI 兼容 `/embeddings`、批量、限速、重试、维度校验）；配置写进 `data/channels.yaml` 的 `embeddings` 段，`channels.example.yaml` 增加 `bge-m3` 示例，密钥只从 `.env` 读取。
  - 后台任务类型 `embeddings`：为已确认楼层里还没有向量的块调用 embedding 并写入；同一块不重复调用；`searchVectors(vector, {storyId, beforeNodeId, limit})` 返回最近块。
  - 向量查询的分支过滤复用 `searchChunks` 的祖先路径写法；单元测试用赠送的假客户端，默认零网络。
- 之后按 M2-T10 到 M2-T15 的顺序执行。

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
- 块只由 `appendNode` 或打开数据库时的回填写入；新增写入楼层的路径必须走 `appendNode`，否则会漏掉索引。修改块索引逻辑时保持 `chunks.id` 与 `chunks_fts.rowid` 一致。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- M2 的向量索引要新增 `sqlite-vec`；安装前先查 `node_modules` 与包的类型定义，并登记依赖。
