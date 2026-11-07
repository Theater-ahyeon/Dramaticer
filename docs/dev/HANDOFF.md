# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：46
- 任务：M2-T11 知情者过滤
- 结果：完成（`DONE`）。
  - `packages/core/src/retrieval/hybrid.ts` 的 `retrieveMemory` 返回类型从 `RetrievalHit[]` 改为 `RetrievalResult`：`{ hits, filter }`。`filter` 是 `RetrievalFilterSummary`，字段为 `viewpoint`（`null` 表示全知）、`eventsBeforeFilter`、`eventsAfterFilter`、`chunksExcluded`。
  - `viewpoint` 未传或为 `null` 时，代码路径与 M2-T10 完全相同，块路照常启用。
  - 传入视角时，先 `collectViewpointAliases`：视角自身的规范化形式加上 `resolveEntities(viewpoint, {storyId})` 返回实体的名称与别名，全部走 `normalizeEntityName`。
  - 事件可见性 `isVisibleToViewpoint`：`knowers` 为空（公开）直接可见；任一 knower 去两端空白后等于 `"*"` 可见；任一 knower 规范化后命中视角别名集合可见；其余排除。过滤发生在 `getEventsForPath` 之后、排序与各路生成之前，实体路也只从过滤后的事件里召回，因此只含秘密事件的楼层不会进入结果。
  - 视角存在时 `chunksExcluded` 为 `true`：跳过 BM25 路、向量路（不调用 embedding 客户端）、实体路的块召回与空查询的最近块路，只保留事件来源。`RetrievalHit.kind` 在这种模式下只会是 `event`。
  - 视角为全标点（规范化后为空）时别名集合为空，只有公开与 `"*"` 事件可见，不抛错。
  - `hybrid-retrieval.test.ts` 原有 7 个用例改为解构 `{ hits }`，新增 2 个：公开/星号/知情者三种事件在视角下保留、秘密事件与全部原文块被排除且全知视图计数不变；视角与 knower 用全名、别名、带空格写法互相命中，陌生人只看到公开事件。
  - 门禁 `pnpm check` 通过（53 个测试文件、425 个测试，3 个 live 测试默认跳过）。
- INBOX 分拣：
  - 「用小说作为文笔与结构的参照」转成 `D-T03`（ADR 与统计脚本，可立即执行）与 `D-T04`（对 `eval-private/reference/` 跑基线定 Director 阈值，被 HUMAN-07 阻塞）；需要人类提供电子书写进 HUMAN-07。
  - 「评测与参照语料补入最新的聊天记录」转成 `D-T01`（快照脚本按修改时间取样最新对话）与 `D-T02`（体检、BM25、ACU 三项统计分栏）。
  - `M3-T00` 补了一句：重复检测与节奏阈值任务依赖 `D-T04`。
  - INBOX 已清空。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T11 完成；下一会话执行 M2-T12（记忆与摘要的被动注入槽位）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 11（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`、`summaries`、`plot_notes`、`chunks`、`chunks_fts`、`chunk_vectors`）。
- 运行时检索索引在 `StoryStore` 内：BM25 用 `searchChunks`，向量用 `searchVectors`；融合与知情者过滤在 `retrieveMemory`。`ChunkIndex` 只留给 st-compat 的 M0 基线评测。
- 后台任务注册表：`dramaticer work` 默认登记 `events`、`summary`，配置了 `embeddings.default` 时再登记 `embeddings`；其他类型由各任务自行登记进默认注册表。
- 实体表目前只在 chat 启动时由角色卡填充；世界书的实体导入函数已就位，等 M2-T13 导入 lore 条目时调用。卡内嵌世界书（`character_book`）尚未转换。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`sqlite-vec`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T12（记忆与摘要的被动注入槽位）：
  - `createMemorySlotProvider`：用当前用户楼层之前的路径调用 `retrieveMemory`，默认 6 条；注意返回值是 `RetrievalResult`，要取 `.hits`。每条的渲染带来源楼层 id 与类型；同一楼层只出现一次。没有结果返回 `null`，组装器记为 `missing-slot`。
  - `createSummarySlotProvider`：`getValidSummaries` 取当前 head 下有效的主线摘要与最近一条章节摘要，超 token 上限按新近程度裁剪；没有摘要返回 `null`。
  - 默认模板的 `memory` 与 `summary` 段接入两个提供者；Trace 来源写成 `memory:<条数>` 与 `summary:<级别>`。
  - 视角参数在该任务里不传（缺省为全知），知情者过滤留给后续需要视角的入口。
- 之后按 M2-T13、M2-T14、M2-T15、M2-T99 的顺序执行。

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
- 知情者过滤在事件层判定：`knowers` 为空或含 `"*"` 或规范化后命中视角别名；视角存在时原文块一律不返回，`filter.chunksExcluded` 为 `true`。不要让调用方绕过这条规则直接用 BM25 结果。
- 新任务 D-T01 至 D-T04 与 HUMAN-07 已登记；D-T04 未解除前不要开始 M3 的重复检测与节奏阈值实现。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install`（pnpm 10 不再接受 `--no-frozen-lockfile`）。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
