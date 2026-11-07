# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：47
- 任务：M2-T12 记忆与摘要的被动注入槽位
- 结果：完成（`DONE`）。
  - `packages/core/src/chat/providers.ts` 新增 `createMemorySlotProvider(store, { limit?, embedder? })`：
    - 以当前楼层（`request.nodeId`）的原文作为检索语句，`beforeNodeId` 设为该楼层，只使用它之前的祖先路径；没有祖先楼层或 `nodeId` 为空时返回 `null`。
    - 调用 `retrieveMemory`，默认 6 条（`DEFAULT_MEMORY_SLOT_LIMIT`）；`embedder` 传入时启用向量路，否则只走 BM25、实体、事件与最近块。
    - 结果按 `RetrievalHit` 顺序渲染成一条 system 消息，每行 `- 楼层 <id>（事件|原文块）：<正文>`；同一 `nodeId` 即使同时命中事件与块也只保留第一条。事件正文来自沿祖先路径一次读取后按 `sourceNodeId` 分组；块正文用 `renderContextView(parseBlocks(raw))`，深度按祖先路径位置计算。
    - 来源写成 `memory:<实际渲染条数>`；渲染后为空返回 `null`，组装器记为 `missing-slot`。
  - 新增 `createSummarySlotProvider(store, { tokenLimit?, tokenEstimator? })`：
    - 分支点为 `request.nodeId ?? getHead(storyId)`；`getValidSummaries` 取有效摘要，章节按结束楼层从早到晚排列，因此最近一条章节取章节列表的最后一项。
    - 选中全部有效主线摘要加最近一条章节摘要；按结束楼层的路径位置从新到旧贪心装入 `tokenLimit`（默认 800，头部 `故事摘要：` 也计入），装不下的跳过；一条都装不下返回 `null`。
    - 渲染顺序为主线从早到晚、章节在最后；来源写成 `summary:<级别>`，级别用 `mainline`、`chapter` 以 `+` 连接。
  - `packages/st-compat/src/chat/cli.ts` 在默认模板的 `summary` 与 `memory` 段接入两个提供者；`channels.yaml` 配置了 `embeddings.default` 时用 `createEmbeddingClient` 创建向量路的客户端，否则传 `null`。
  - `chat-providers.test.ts` 新增 5 个用例：路径过滤与同楼层去重、无前置楼层或无命中返回 `null`、主线加最近章节与 token 裁剪、切分支后失效、默认模板组装后的 Trace 来源与 `missing-slot`。
  - 门禁 `pnpm check` 通过（53 个测试文件、430 个测试，3 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T12 完成；下一会话执行 M2-T13（世界书与导演的被动注入槽位）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 11（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`、`summaries`、`plot_notes`、`chunks`、`chunks_fts`、`chunk_vectors`）。
- 运行时检索索引在 `StoryStore` 内：BM25 用 `searchChunks`，向量用 `searchVectors`；融合与知情者过滤在 `retrieveMemory`。`ChunkIndex` 只留给 st-compat 的 M0 基线评测。
- 上下文槽位提供者都在 `packages/core/src/chat/providers.ts`：`character` 用 `createStaticSlotProvider`，`history`、`state`、`summary`、`memory` 各有一个工厂；`lore` 与 `director` 仍是 `missing-slot`，等 M2-T13。
- 后台任务注册表：`dramaticer work` 默认登记 `events`、`summary`，配置了 `embeddings.default` 时再登记 `embeddings`；其他类型由各任务自行登记进默认注册表。
- 实体表目前只在 chat 启动时由角色卡填充；世界书的实体导入函数已就位，等 M2-T13 导入 lore 条目时调用。卡内嵌世界书（`character_book`）尚未转换。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`sqlite-vec`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T13（世界书与导演的被动注入槽位）：
  - 迁移 v12 新增 `lore_entries`，`keywords` 存 JSON 数组；st-compat 把世界书条目导入为 lore 条目，`constant` 与主关键词保留，实体走 `upsertEntity`。
  - `createLoreSlotProvider`：常驻条目始终注入，非恒常条目按当前对话做混合检索；同一实体或同一内容只出现一次；超预算时先删靠后的非恒常条目，常驻条目最后裁剪。Trace 来源要能看出常驻与检索的条数。
  - `createDirectorSlotProvider`：未兑现剧情笔记按创建顺序一行一条，带“距创建经过的楼层数”；没有笔记返回 `null`。不调用模型。
  - `dramaticer chat` 接入这两个提供者。
- 之后按 M2-T14、M2-T15、M2-T99 的顺序执行；D-T01 至 D-T03 可以穿插，D-T04 被 HUMAN-07 阻塞。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。`SILICONFLOW_API_KEY` 已存在，`data/channels.yaml` 的 `embeddings.default` 引用它。
- `dramaticer chat` 配置了 embeddings 时，每轮记忆槽位会对当前楼层原文做一次 embedding 调用；这是设计里的向量检索路，不属于主模型调用。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli`、`runChatCli`、`runWorkCli` 的实现在 core，st-compat 的 `cli.ts` 只做分发。
- 状态快照只是缓存（不变量 I5）：只有 `getStateSnapshot` 写缓存，`appendStateDiffs` 在同一事务里失效该楼层与全部后代；不要另加减 diff 的接口。
- 后台任务只对已确认楼层入队；不要绕过注册表直接调用处理器，也不要让 `runChatTurn` 引入后台客户端（不变量 I6）。
- 事件记忆只追加：不要新增更新或删除事件的接口；同一楼层重复抽取前用 `countEventsForNode` 判断。
- 摘要按闭区间记录起止楼层，起点必须是终点的祖先且不能等于终点；有效性只按调用方给的路径计算，切分支后不要删除摘要行。主线摘要的输入是章节摘要，不重新读原文（ADR-0018）。
- `getValidSummaries` 的返回顺序是章节在前、主线在后，每一组按结束楼层从早到晚；需要“最近”时取最后一项，不要取第一项。
- 剧情笔记只追加：正文与来源楼层写入后不可修改，唯一允许的变更是 `status` 与 `fulfilled_at`；兑现只能从未兑现状态出发。
- 实体按规范化名称合并是唯一入口；新增数据源请走 `upsertEntity`。别名不跨故事唯一是 ADR-0017 的决定，不要加故事内唯一约束。
- 块只由 `appendNode` 或打开数据库时的回填写入；修改块索引逻辑时保持 `chunks.id` 与 `chunks_fts.rowid` 一致。向量只由 `insertChunkVectors` 写入，`chunk_vectors.chunk_id` 对应 `chunks.id`。
- vec0 维度在创建后不能修改：更换 embedding 模型并改变维度时需要重建数据库或新增迁移，当前实现遇到维度不一致直接抛错。绑定 `chunk_vectors` 主键必须用 BigInt。
- `retrieveMemory` 的实体匹配是规范化查询对名称与别名的子串包含；别名越长越优先。事件路不按查询文本过滤，只按重要度与新近度，这是设计里的独立一路。
- RRF 名次在每一路内部去重之后重新编号，同一楼层多个块只保留最好的一块，不会占两个位次。
- 检索的 `beforeNodeId` 语义是「该楼层之前」：块检索排除自身，事件与最近块也只使用去掉该楼层后的路径。
- 知情者过滤在事件层判定：`knowers` 为空或含 `"*"` 或规范化后命中视角别名；视角存在时原文块一律不返回，`filter.chunksExcluded` 为 `true`。不要让调用方绕过这条规则直接用 BM25 结果。
- 记忆槽位的块命中只拿到 `RetrievalHit` 的楼层信息，渲染的是该楼层的上下文视图，不是命中的那个块本身；不要假定槽位里的正文片段等于 BM25 命中的块。
- 新任务 D-T01 至 D-T04 与 HUMAN-07 已登记；D-T04 未解除前不要开始 M3 的重复检测与节奏阈值实现。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install`（pnpm 10 不再接受 `--no-frozen-lockfile`）。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
