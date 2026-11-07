# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：45
- 任务：M2-T10 多路融合检索
- 结果：完成（`DONE`）。
  - 新增 `packages/core/src/retrieval/hybrid.ts`，导出 `retrieveMemory(options)`、`RetrievalHit`、`RetrievalSource`、`RetrievalRoute`（`bm25`、`vector`、`entity`、`event`、`recent`）与 `RetrievalKind`（`chunk`、`event`）。`packages/core/src/index.ts` 一并导出。
  - BM25 路：`store.searchChunks(query, {storyId, beforeNodeId?, limit})`，每个楼层只占一个位次。
  - 向量路：只在传了 `embedder` 且查询非空时启用；查询向量由 `embedder.embed([query])` 生成，调用 `store.searchVectors` 时按 `limit × 4`（上限 1000）取块，再按楼层去重保留最近的块，截到 `limit`。
  - 实体路：`matchEntities` 用 `listEntities` 的规范化名称与别名在规范化查询里做包含匹配，命中的实体按最长别名长度、实体 id 排序；随后召回 `participants` 命中这些实体别名集合的事件，以及用实体名称与别名调用 `searchChunks` 找到的块。事件先按重要度、路径位置、楼层内序号排序，块排在事件之后。
  - 事件路：沿路径读取事件（`getEventsForPath`，最多 1000 条），按重要度降序、路径位置降序、ordinal 降序、id 升序排序，按楼层去重后取前 K。
  - 最近块路：只在空查询启用；从路径末端往前找有块的楼层（`countChunksForNode`），取前 K。
  - 融合：每一路先按自己的顺序去重取前 K，再用 RRF（常数 60，`1 / (60 + rank)`）累加分数；`sources` 记录每一路的名次并按固定路线顺序输出；最终排序依次比较分数降序、最好名次升序、事件优先、节点 id 字典序。
  - 输入校验：故事不存在、`beforeNodeId` 不存在或属于其他故事、`limit` 不是 1 到 50 的整数、`viewpoint` 是空字符串都直接抛错。`limit` 默认 8。
  - `beforeNodeId` 只检索它的祖先路径并排除自身；事件与最近块使用去掉 `beforeNodeId` 之后的路径（`getPathToNode(beforeNodeId).slice(0, -1)`），与 `searchChunks` 的「之前」语义一致。
  - 空查询（规范化后没有可检索字符）跳过 BM25、向量、实体三路，只返回事件路与最近块路。
  - `viewpoint` 目前只做参数校验，知情者过滤留给 M2-T11。
  - 新增 7 个测试：多路来源与分数、实体别名把相关事件排到前面、向量距离排序与同楼层去重、分支过滤、空查询的稳定结果、`limit` 边界、错误路径。门禁 `pnpm check` 通过（53 个测试文件、423 个测试，3 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T10 完成；下一会话执行 M2-T11（知情者过滤）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 11（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`、`summaries`、`plot_notes`、`chunks`、`chunks_fts`、`chunk_vectors`）。
- 运行时检索索引在 `StoryStore` 内：BM25 用 `searchChunks`，向量用 `searchVectors`；融合在 `retrieveMemory`。`ChunkIndex` 只留给 st-compat 的 M0 基线评测。
- 后台任务注册表：`dramaticer work` 默认登记 `events`、`summary`，配置了 `embeddings.default` 时再登记 `embeddings`；其他类型由各任务自行登记进默认注册表。
- 实体表目前只在 chat 启动时由角色卡填充；世界书的实体导入函数已就位，等 M2-T13 导入 lore 条目时调用。卡内嵌世界书（`character_book`）尚未转换。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`sqlite-vec`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T11（知情者过滤）：
  - 在 `retrieveMemory` 里启用已经接受的 `viewpoint` 参数：没有视角时保持现在的全知结果不变。
  - 有视角时，事件只在 `knowers` 为空（公开）、包含 `"*"`、或经别名归一化后命中视角实体时保留；块在缺少块级知情者信息时全部不返回。
  - 视角与 `knowers`、`participants` 都先过 `normalizeEntityName`，再与实体的名称和别名集合比较。
  - 返回结果需要带过滤前的计数供 Trace 观察；现有调用方（M2-T12 之前没有别的调用方）要一起改。
- 之后按 M2-T12 到 M2-T15 的顺序执行。

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
- `retrieveMemory` 的实体匹配是规范化查询对名称与别名的子串包含；别名越长越优先。事件路不按查询文本过滤，只按重要度与新近度，这是设计里的独立一路。
- RRF 名次在每一路内部去重之后重新编号，同一楼层多个块只保留最好的一块，不会占两个位次。
- 检索的 `beforeNodeId` 语义是「该楼层之前」：块检索排除自身，事件与最近块也只使用去掉该楼层后的路径。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install`（pnpm 10 不再接受 `--no-frozen-lockfile`）。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
