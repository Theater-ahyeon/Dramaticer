# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：44
- 任务：M2-T09 embedding 客户端与向量索引
- 结果：完成（`DONE`）。
  - 安装 `sqlite-vec@0.1.9` 并在 `StoryStore.open` 里加载；迁移列表改为 `buildMigrations(embeddingDimensions)`，schema 版本 11 新增 `chunk_vectors USING vec0(chunk_id INTEGER PRIMARY KEY, story_id TEXT, node_id TEXT, embedding float[N])`，默认维度 1024。
  - `StoryStore.open(path, { embeddingDimensions })` 在迁移后从 `sqlite_master` 解析实际维度，与本次配置不一致时抛错；`work` 与 `chat` 都传入 `embeddings.default.dimensions`。
  - `chunk_vectors` 的 `story_id` 与 `node_id` 是 vec0 元数据列，KNN 查询直接按故事与祖先节点集合过滤，不需要超额取候选。`chunk_id` 必须用 BigInt 绑定（vec0 只接受整数类型的绑定值）。
  - 新增 `EmbeddingClient` 接口与 `OpenAiEmbeddingClient`：`/embeddings`、按 `batchSize` 拆分、每分钟请求数限速、429/5xx 与网络错误退避重试、超时、按 `index` 还原顺序，缺少条目、重复 index、非有限数字与维度不符都直接抛错。
  - `data/channels.yaml` 顶层新增 `embeddings` 段（与 `channels`、`models` 平级），`apiKey` 只能是 `${变量}` 引用；`channels.example.yaml` 增加 `bge-m3` 示例。`createEmbeddingClient(config, "default")` 创建客户端。
  - `StoryStore` 新增 `listChunksMissingVectors`、`insertChunkVectors`、`countChunkVectorsForNode`、`searchVectors(vector, {storyId, beforeNodeId, limit})`；向量使用原始块文本，距离是 L2，结果不去重楼层。
  - 后台任务类型 `embeddings`：只处理还没有向量的块，第二次执行不重复调用渠道；`dramaticer work` 只在配置了 `embeddings.default` 时把该类型加入默认注册表。
  - 新增 17 个单元测试与 1 个真实 bge-m3 live 测试（一次调用、1024 维），门禁 `pnpm check` 通过（52 个测试文件、416 个测试，3 个 live 测试默认跳过）；live 测试已用 `DRAMATICER_LIVE=1` 实际运行通过。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T09 完成；下一会话执行 M2-T10（多路融合检索）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 11（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`、`summaries`、`plot_notes`、`chunks`、`chunks_fts`、`chunk_vectors`）。
- 运行时检索索引在 `StoryStore` 内：BM25 用 `searchChunks`，向量用 `searchVectors`；`ChunkIndex` 只留给 st-compat 的 M0 基线评测。
- 后台任务注册表：`dramaticer work` 默认登记 `events`、`summary`，配置了 `embeddings.default` 时再登记 `embeddings`；其他类型由各任务自行登记进默认注册表。
- 实体表目前只在 chat 启动时由角色卡填充；世界书的实体导入函数已就位，等 M2-T13 导入 lore 条目时调用。卡内嵌世界书（`character_book`）尚未转换。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`sqlite-vec`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T10（多路融合检索）：
  - 新增 `packages/core/src/retrieval/hybrid.ts`：输入 `{store, embedder, storyId, query, beforeNodeId, viewpoint?, limit}`，同时取 BM25 块（`searchChunks`）、向量块（`searchVectors`）、实体命中（`resolveEntities` 与 `getEventsForPath`）与事件重要度/新近度。
  - 每一路先按自己的排序取前 K，再用 RRF（常数 60）融合；实体命中先用别名解析，再召回该实体参与的事件与包含别名的块。任意一路缺失时跳过该路。
  - `RetrievalHit` 带 `kind`（`chunk` 或 `event`）、`nodeId`、`score`、`sources`（每一路的排名）。`searchVectors` 返回块级结果，融合时要按楼层保留最高分。
  - `limit` 默认 8，限制在 1 到 50；空查询返回最近的高重要度事件与最近块。
- 之后按 M2-T11 到 M2-T15 的顺序执行。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。`SILICONFLOW_API_KEY` 已存在，`data/channels.yaml` 的 `embeddings.default` 引用它。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli`、`runChatCli`、`runWorkCli` 的实现在 core，st-compat 的 `cli.ts` 只做分发。
- 状态快照只是缓存（不变量 I5）：只有 `getStateSnapshot` 写缓存，`appendStateDiffs` 在同一事务里失效该楼层与全部后代；不要另加减 diff 的接口。
- 后台任务只对已确认楼层入队；不要绕过注册表直接调用处理器，也不要让 `runChatTurn` 引入后台客户端（不变量 I6）。
- 事件记忆只追加：不要新增更新或删除事件的接口；同一楼层重复抽取前用 `countEventsForNode` 判断。
- 摘要按闭区间记录起止楼层，起点必须是终点的祖先且不能等于终点；有效性只按调用方给的路径计算，切分支后不要删除摘要行。主线摘要的输入是章节摘要，不重新读原文（ADR-0018）。
- 剧情笔记只追加：正文与来源楼层写入后不可修改，唯一允许的变更是 `status` 与 `fulfilled_at`；兑现只能从未兑现状态出发。
- 实体按规范化名称合并是唯一入口；新增数据源请走 `upsertEntity`。别名不跨故事唯一是 ADR-0017 的决定，不要加故事内唯一约束。
- 块只由 `appendNode` 或打开数据库时的回填写入；修改块索引逻辑时保持 `chunks.id` 与 `chunks_fts.rowid` 一致。向量只由 `insertChunkVectors` 写入，`chunk_vectors.chunk_id` 对应 `chunks.id`。
- vec0 维度在创建后不能修改：更换 embedding 模型并改变维度时需要重建数据库或新增迁移，当前实现遇到维度不一致直接抛错。绑定 `chunk_vectors` 主键必须用 BigInt。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install`（pnpm 10 不再接受 `--no-frozen-lockfile`）。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
