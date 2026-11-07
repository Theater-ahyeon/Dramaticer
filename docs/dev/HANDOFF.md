# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：39
- 任务：M2-T04 实体与别名表
- 结果：完成（`DONE`）。
  - 迁移 v6：新增 `entities(row_id, id, story_id, kind, name, normalized_name, description, source, created_at)` 与 `entity_aliases(entity_id, story_id, alias, normalized_alias)`。同一故事内 `normalized_name` 唯一；同一实体内 `normalized_alias` 唯一。别名的 `story_id` 由触发器校验必须与实体一致。
  - core 新增 `entity.ts`：`EntityKind`（`character`、`location`、`item`、`faction`、`lore`、`unknown`）、`Entity`、`NewEntityInput`、`normalizeEntityName`（NFKC、去标点符号与空白、再折叠大小写）。`normalizeEntityName` 由检索侧的 `normalizeRetrievalText` 加 `toLowerCase` 组成，名称与别名共用同一条路径。
  - `StoryStore` 新增 `upsertEntity`、`getEntity`、`findEntityByName`、`listEntities(storyId, {kind})`、`resolveEntities(alias, {storyId?})`、`addEntityAlias`。`upsertEntity` 按规范化名称合并，命中时只补别名，保留原有的类型、名称与描述；名称本身总登记为别名。
  - 别名不是故事内唯一：不同实体可以共用同一个别名，`resolveEntities` 返回全部命中并按实体创建顺序排列。这条取代了 TASKS 原文的“同一故事内 `normalized_alias` 唯一”，原因见 ADR-0017（角色名常同时是世界书词条的主关键词）。
  - st-compat 新增 `entity-import.ts`：`importCharacterCardEntity`（卡名 → `character`，昵称 → 别名，缺名称直接抛错）；`importWorldInfoEntities`（`comment` 或第一个可用主关键词 → `lore` 名称，全部主关键词 → 别名，只有标点或空白的关键词被丢弃，没有可用名称的条目计入 `skipped`）。返回 `{created, merged, aliases, skipped}`，别名数只统计显式别名，不含实体名称。
  - `dramaticer chat` 每次启动都执行一次角色卡实体导入，重复执行只合并；chat 的测试增加了实体断言。
  - 新增 15 个测试（core 7、st-compat 实体导入 7、chat 实体断言 1）。
  - 门禁：`pnpm check` 通过（46 个测试文件、370 个测试，2 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01、M2-T02、M2-T03、M2-T04 完成；下一会话执行 M2-T05（事件抽取）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 6（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`、`entities`、`entity_aliases`）。M2-T05 会迁移到 v7。
- 后台任务注册表目前默认为空：M2-T05、M2-T06、M2-T09 把各自的处理器登记进去即可。
- 实体表目前只在 chat 启动时由角色卡填充；世界书的实体导入函数已就位，等 M2-T13 导入 lore 条目时调用。卡内嵌世界书（`character_book`）尚未转换。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。M2 的记忆任务会强化提示词。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T05（事件抽取）：
  - 迁移 v7：`memory_events(id, story_id, source_node_id, ordinal, story_time, location, participants, importance, knowers, text, created_at)`，`UNIQUE(source_node_id, ordinal)`，`participants` 与 `knowers` 存 JSON 数组，触发器拒绝 UPDATE 与 DELETE。
  - 后台任务类型 `events`：窗口是已确认节点及其前面最多 8 楼，`background` 模型输出 JSON 数组。
  - 严格校验：字段类型、`importance` 范围、空字符串，任一非法整批不写入并记录原因。
  - `getEventsForPath(nodeId, options)` 按楼层顺序返回，支持分页与 limit。
  - 验收见 `docs/dev/TASKS.md` 的 M2-T05。
- 之后按 M2-T06 到 M2-T15 的顺序执行；摘要、向量索引也要通过 M2-T03 的注册表登记处理器。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli`、`runChatCli`、`runWorkCli` 的实现在 core，st-compat 的 `cli.ts` 只做分发。
- 状态快照只是缓存（不变量 I5）：只有 `getStateSnapshot` 写缓存，`appendStateDiffs` 在同一事务里失效该楼层与全部后代；不要另加减 diff 的接口。
- 后台任务只对已确认楼层入队；不要绕过注册表直接调用处理器，也不要让 `runChatTurn` 引入后台客户端（不变量 I6）。
- 实体按规范化名称合并是唯一入口；新增数据源请走 `upsertEntity`，不要直接写 `entities`。别名不跨故事唯一是 ADR-0017 的决定，不要加故事内唯一约束。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- M2 的向量索引要新增 `sqlite-vec`；安装前先查 `node_modules` 与包的类型定义，并登记依赖。
