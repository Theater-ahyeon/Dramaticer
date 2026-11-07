# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：48
- 任务：M2-T13 世界书与导演的被动注入槽位
- 结果：完成（`DONE`）。
  - 迁移 v12 新增 `lore_entries(row_id, id, story_id, entity_id, name, content, constant, keywords, source, created_at)`：`keywords` 存 JSON 数组，`(story_id, source)` 唯一，实体必须与故事一致（触发器）。
  - `StoryStore.insertLoreEntries` 用 `ON CONFLICT DO NOTHING` 幂等写入，返回值只含本次真正插入的行；`listLoreEntries(storyId)` 按 `row_id` 返回全部条目。
  - `core/src/memory/lore.ts` 定义 `LoreEntry`、`NewLoreEntryInput`、`loreEntryMatchScore`（关键词每个命中 1 分、实体名称或别名命中 2 分）与 `loreEntryContentKey`。
  - `createLoreSlotProvider(store, { tokenLimit?, tokenEstimator? })`：常驻条目始终注入；非恒常条目以当前楼层原文做规范化子串匹配（关键词与关联实体别名），按分数降序、同分保持导入顺序；同一 `entityId` 或同一规范化正文只保留一条。默认 token 上限 800，超预算时从后往前删除检索条目，全部删完才删常驻条目；结果渲染成一条 system 消息，来源写 `lore:常驻 N 条、检索 M 条`。
  - `createDirectorSlotProvider(store)`：取未兑现剧情笔记，只保留来源楼层在当前路径上的；按创建顺序一行一条 `- <正文>（距创建 N 楼）`，N 是当前楼层与来源楼层的路径位置差；来源写 `director:N 条未兑现`；没有笔记返回 `null`。
  - st-compat 新增 `worldInfoFromCharacterBook(book, name)`：把卡内嵌世界书的数组条目转换成与世界书文件相同的视图（`keys`→`key`、`enabled`→`disable`、`secondary_keys`→`keysecondary`，条目 id 或下标作为来源键）。
  - st-compat 新增 `importWorldInfoLore` 与 `importCharacterBookLore`：先导入实体，再写入 lore 条目并关联实体；来源分别是 `<前缀>:<世界书名称>:<条目键>` 与 `character-book:<卡名>:<条目 id 或下标>`；停用、无名称、空正文的条目计入 `skipped`。
  - `dramaticer chat` 新增可重复的 `--world <path>`，启动时导入卡内嵌世界书与每份世界书；默认模板的 `lore` 与 `director` 段接入两个提供者。
  - 测试：core `lore.test.ts` 8 个、st-compat `lore-import.test.ts` 3 个；`chat-cli.test.ts` 增加世界书导入与 Trace 来源用例；`vectors.test.ts` 的 schema 版本断言改为 `LATEST_SCHEMA_VERSION`。
  - 门禁 `pnpm check` 通过（55 个测试文件、442 个测试，3 个 live 测试默认跳过）。ADR-0021。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T13 完成；下一会话执行 M2-T14（读取工具与单轮执行器）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 12（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`、`summaries`、`plot_notes`、`chunks`、`chunks_fts`、`chunk_vectors`、`lore_entries`）。
- 运行时检索索引在 `StoryStore` 内：BM25 用 `searchChunks`，向量用 `searchVectors`；融合与知情者过滤在 `retrieveMemory`。`ChunkIndex` 只留给 st-compat 的 M0 基线评测。
- 上下文槽位提供者都在 `packages/core/src/chat/providers.ts`：`character` 用 `createStaticSlotProvider`，`history`、`state`、`summary`、`memory`、`lore`、`director` 各有一个工厂；默认模板的八个段全部有提供者。
- 世界书链路：`--world` 文件或卡内嵌 `character_book` → `importWorldInfoEntities` / `importWorldInfoLore` → `lore_entries` + `entities`。`lore_entries` 目前只追加，没有更新与删除接口。
- 后台任务注册表：`dramaticer work` 默认登记 `events`、`summary`，配置了 `embeddings.default` 时再登记 `embeddings`；其他类型由各任务自行登记进默认注册表。
- 实体表目前只在 chat 启动时由角色卡、世界书或卡内嵌世界书填充。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`sqlite-vec`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T14（读取工具与单轮执行器）：
  - 新增 `memory_search`、`lore_lookup`、`state_get` 三个读取工具的定义、JSON Schema 与执行函数；`memory_search` 调 `retrieveMemory`，`lore_lookup` 用 `listLoreEntries` 加实体匹配（可直接复用 `loreEntryMatchScore`），`state_get` 读快照或按路径取值。
  - 接入 pi-agent-core 的无状态单轮执行器：`prepareRequest` 注入已组装的上下文，`beforeToolCall` 只允许读取工具并校验参数，`finishTurn` 把工具往返限制在最多 2 轮，`identity` 设为 `{ attribution: null }`。无法与现有 `LlmStreamingClient` 共存时写 ADR，验收标准不变。
  - `runChatTurn` 在函数调用模式下执行读取工具循环；文本标签模式不暴露读取工具。`state_update` 与 `plot_note` 仍然只收集，不执行。Trace 增加工具轮数与每次调用的工具名。
- 之后按 M2-T15、M2-T99 的顺序执行；D-T01 至 D-T03 可以穿插，D-T04 被 HUMAN-07 阻塞。

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
- `lore_entries` 的 `source` 同时是幂等键（ADR-0021）：导入必须保证同一来源字符串稳定；重复导入跳过已有行，不会更新正文。世界书按只读处理。
- 非恒常 lore 条目只按关键词与实体别名做子串匹配，不走 embedding；不要让 lore 槽位引入额外模型调用。
- 导演槽位只处理当前分支路径上的未兑现笔记；年龄是路径位置差，不是时间差。
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
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install`（pnpm 10 不再接受 `--frozen-lockfile`）。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
