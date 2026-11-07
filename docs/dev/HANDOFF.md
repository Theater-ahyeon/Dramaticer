# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：49
- 任务：M2-T14 读取工具与单轮执行器
- 结果：完成（`DONE`）。
  - `packages/core/src/tools/read-tools.ts` 新增三个只读工具，JSON Schema、参数校验与执行函数放在一起：
    - `memory_search`：调用 `retrieveMemory`，以当前用户楼层为 `beforeNodeId`，只检索祖先路径；`limit` 默认 8、上限 12；结果按 `RetrievalHit` 渲染成“楼层 + 事件/原文 + 片段”，单条片段最多 500 字。
    - `lore_lookup`：世界书条目用 `loreEntryMatchScore`（关键词 1 分、实体名称/别名 2 分）再加条目名称命中 3 分；同时按规范化子串返回命中的实体档案（名称、类型、别名、描述）；`limit` 默认 5、上限 20。
    - `state_get`：默认返回 `getStateSnapshot(beforeNodeId)` 的完整状态；给 `path` 时用 `Object.hasOwn` 逐段取值，缺失返回“路径不存在”，不抛错。
  - 参数校验独立于 schema：只接受对象、拒绝未知字段、`query` 非空、`limit` 为范围内的整数、`path` 为非空字符串数组；校验失败在循环里变成 `isError` 的工具结果，模型可以在下一轮修正。
  - `packages/core/src/chat/executor.ts` 新增 `runModelTurns`：主请求 + 最多 2 轮读取工具（`MAX_TOOL_ROUNDS`），直接在 `LlmStreamingClient` 上运行。它承担原先计划给 pi-agent-core 三个钩子的职责：组装好的上下文每次请求前原样注入；读取工具在参数校验通过后才执行；第 2 轮之后不再执行工具。写入类工具不执行，只把全部轮次的工具调用交给 `collectStructuredOutputFromToolCalls`。
  - 每轮流式正文单独用 `BlockParser` 解析并校验“增量拼接 == `LlmResult.text`”；最终 `blocks` 来自最后一个没有读取工具调用的轮次。`onTextDelta` 在各轮实时回调，工具轮次里的过渡文本会显示但不写进楼层原文。
  - 中止：每轮请求前、每个工具执行前检查 `signal`，中止时抛出 `signal.reason`，助手楼层不会写入。
  - `LlmMessage` 改为消息联合类型：助手消息可带 `toolCalls`，新增 `role:"tool"` 的工具结果消息（`toolCallId`、`toolName`、`isError`）；`LlmToolCall.arguments` 改为 `JsonObject`。pi-ai 适配器把助手工具调用映射为 `toolCall` 内容块，把工具结果映射为 `toolResult` 消息；缓存键并入工具调用与结果字段，普通消息的缓存键与旧版一致。
  - Trace 新增 `tools`：`rounds`（实际执行的读取工具轮数）与 `calls`（按顺序的工具名，含参数校验失败）。`llm.usage`、`attempts`、`rounds`、`cached` 现在跨所有模型请求汇总。
  - `runChatTurn` 新增 `embedder`、`viewpoint`、`maxToolRounds`；函数调用模式的请求带 `state_update`、`plot_note` 与三个读取工具，文本标签模式不发送工具定义。默认模板的函数调用协议段写明三个读取工具的用途。
  - `dramaticer chat` 把 embeddings 客户端交给 `runChatTurn`，日志增加读取工具轮数。
  - `StoryStore` 新增 `getEventsForNode(nodeId)`，按 `ordinal` 返回该楼层的全部事件，供 `memory_search` 渲染。
  - 测试：`read-tools.test.ts` 5 个、`chat-tool-loop.test.ts` 6 个；`chat-turn.test.ts` 的函数调用工具列表断言更新为 5 个工具。门禁 `pnpm check` 通过（57 个测试文件、453 个测试，3 个 live 测试默认跳过）。
  - 真实渠道冒烟（`main` / `opendesign/deepseek-v4.1-flash`）：模型第一轮调用 `memory_search` 时漏传 `query`，工具结果返回“必须是非空字符串”；第二轮重新调用并命中楼层原文，同时调用 `lore_lookup`；最终正文引用检索结果。冒烟脚本已删除。
  - ADR-0022 记录不把 pi-agent-core 接入运行时的理由；DESIGN §4、§10 与 `DEPENDENCIES.md` 同步更新。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T14 完成；下一会话执行 M2-T15（记忆引擎评测）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 12（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`、`memory_events`、`summaries`、`plot_notes`、`chunks`、`chunks_fts`、`chunk_vectors`、`lore_entries`）。
- 运行时检索索引在 `StoryStore` 内：BM25 用 `searchChunks`，向量用 `searchVectors`；融合与知情者过滤在 `retrieveMemory`。`ChunkIndex` 只留给 st-compat 的 M0 基线评测。
- 上下文槽位提供者都在 `packages/core/src/chat/providers.ts`；默认模板的八个段全部有提供者。
- 读取工具在 `packages/core/src/tools/read-tools.ts`，执行器在 `packages/core/src/chat/executor.ts`。`runChatTurn` 是唯一把这些接进楼层树的地方。
- `pi-agent-core` 仍只在根目录 devDependencies，只被 `spikes/pi/` 使用；运行时不再接入（ADR-0022）。
- 世界书链路：`--world` 文件或卡内嵌 `character_book` → `importWorldInfoLore` / `importCharacterBookLore` → `lore_entries` + `entities`。`lore_entries` 目前只追加，没有更新与删除接口。
- 后台任务注册表：`dramaticer work` 默认登记 `events`、`summary`，配置了 `embeddings.default` 时再登记 `embeddings`；其他类型由各任务自行登记进默认注册表。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`sqlite-vec`、`yaml`。
- 结构化输出在真实渠道的体检结果是 `function-call`。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T15（记忆引擎评测）：
  - 新增 `pnpm --filter @dramaticer/st-compat memory-eval`：把 3 个私有对话导入临时数据库，建立块索引、向量索引、实体表，按需要建立事件与摘要；对 386 道题用 `retrieveMemory` 计算命中@5、@10、@20，按题型与对话分别统计。
  - embedding 结果缓存到 `eval-private/memory-cache/`；详细报告写 `eval-private/reports/m2-retrieval.md`，统计版写 `docs/dev/reports/M2-retrieval.md`。
  - 报告列出 M0 的 BM25 与 ACU 基线、每一路的单独成绩、融合后的成绩与知情者过滤掉的数量；逐条核对 M2-T15 的分层门槛。
- 之后执行 M2-T99；D-T01 至 D-T03 可以穿插，D-T04 被 HUMAN-07 阻塞。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。`SILICONFLOW_API_KEY` 已存在，`data/channels.yaml` 的 `embeddings.default` 引用它。
- `dramaticer chat` 配置了 embeddings 时，记忆槽位与 `memory_search` 都可能对当前楼层原文做 embedding 调用；这是设计里的向量检索路，不属于主模型调用。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- 如果以后要让 `memory_search` 的向量路在 `runChatTurn` 里生效，必须把 `embedder` 传进来；不传时只走 BM25、实体、事件与最近块。
- 工具轮数的上限是 `MAX_TOOL_ROUNDS = 2`，`runModelTurns` 拒绝更大的值；不要为了让模型多查几次而放宽，I6 按这个上限复核。
- 读取工具参数校验失败会写回一个 `isError: true` 的工具结果，这是模型输入错误，不是程序异常；程序自身的存储或检索错误直接抛出，不做兜底。
- 写入类工具与未知工具不会执行；它们不会出现在下一轮请求的助手消息里，也不会产生工具结果。
- 工具轮次里模型先输出的过渡文本会经 `onTextDelta` 显示，但不写进楼层原文；保存的正文以最后一个没有读取工具调用的轮次为准。
- `core` 不能 import `st-compat`；`runProbeCli`、`runChatCli`、`runWorkCli` 的实现在 core，st-compat 的 `cli.ts` 只做分发。
- 状态快照只是缓存（不变量 I5）：只有 `getStateSnapshot` 写缓存，`appendStateDiffs` 在同一事务里失效该楼层与全部后代；不要另加减 diff 的接口。
- 后台任务只对已确认楼层入队；不要让 `runChatTurn` 引入后台客户端（不变量 I6）。
- 事件记忆只追加：不要新增更新或删除事件的接口。`getEventsForNode` 是新加的只读接口。
- 摘要按闭区间记录起止楼层，起点必须是终点的祖先且不能等于终点；窗口与有效性见 ADR-0018。
- `getValidSummaries` 的返回顺序是章节在前、主线在后，每一组按结束楼层从早到晚；需要“最近”时取最后一项。
- 剧情笔记只追加：正文与来源楼层写入后不可修改，唯一允许的变更是 `status` 与 `fulfilled_at`。
- 实体按规范化名称合并是唯一入口；新增数据源请走 `upsertEntity`。别名不跨故事唯一是 ADR-0017 的决定。
- `lore_entries.source` 同时是幂等键（ADR-0021）：重复导入跳过已有行，不会更新正文。
- 非恒常 lore 条目只按关键词与实体别名做子串匹配，不走 embedding；不要给 lore 槽位引入额外模型调用。
- 导演槽位只处理当前分支路径上的未兑现笔记；年龄是路径位置差。
- 块只由 `appendNode` 或打开数据库时的回填写入；修改块索引逻辑时保持 `chunks.id` 与 `chunks_fts.rowid` 一致。
- vec0 维度在创建后不能修改：更换 embedding 模型并改变维度时需要重建数据库或新增迁移。
- `retrieveMemory` 的实体匹配是规范化查询对名称与别名的子串包含；视角存在时原文块一律不返回。
- 检索的 `beforeNodeId` 语义是「该楼层之前」：块检索排除自身，事件与最近块也只使用去掉该楼层后的路径。
- 记忆槽位的块命中渲染的是该楼层的上下文视图，不是命中的那个块本身。
- 新任务 D-T01 至 D-T04 与 HUMAN-07 已登记；D-T04 未解除前不要开始 M3 的重复检测与节奏阈值实现。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install`（pnpm 10 不再接受 `--frozen-lockfile`）。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
