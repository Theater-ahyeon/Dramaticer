# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：38
- 任务：M2-T03 后台任务框架
- 结果：完成（`DONE`）。
  - 迁移 v5：新增 `background_jobs(id, story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at, UNIQUE(node_id, kind))` 与 `background_jobs_story_matches_node` 触发器，`status` 限定 `pending`、`running`、`done`、`failed`。
  - `StoryStore` 新增 `listStories`、`enqueueMissingBackgroundJobs`、`getBackgroundJob`、`listBackgroundJobs`、`startBackgroundJob`、`finishBackgroundJob`、`failBackgroundJob`。
  - core 新增 `background/`：`createBackgroundJobRegistry` 校验类型与处理器；`enqueueMissingJobs` 只扫描有子节点的已确认楼层，按创建顺序与类型顺序插入，唯一约束让重复调用不产生新行；`drainBackgroundJobs` 先补建再按 `created_at`、`id` 顺序执行，处理器收到 `{store, client, job}`。
  - 重试语义（ADR-0016）：`attempts` 在开始执行前加一；一次 drain 每个任务最多执行一次；失败记录 `last_error` 并退回 `pending`，第 3 次执行仍失败时标为 `failed` 并写 `finished_at`；成功清空错误。`running` 状态不会自动恢复，下一轮只处理 `pending`。
  - `dramaticer work --db <path> [--limit <n>] [--kind <kind>]`：单轮执行，遍历全部故事，`--limit` 是每个故事本轮的上限，`--kind` 同时限制补建与执行；后台客户端固定用 `background` 模型，数据库文件必须已经存在。
  - `dramaticer chat` 的测试确认每轮只创建正文客户端；`runChatTurn` 不接受后台客户端。
  - 新增 15 个测试（后台任务 11、work CLI 3、chat 客户端隔离 1）。
  - 门禁：`pnpm check` 通过（44 个测试文件、356 个测试，2 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01、M2-T02、M2-T03 完成；下一会话执行 M2-T04（实体与别名表）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 5（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`、`background_jobs`）。M2-T04 会迁移到 v6。
- 后台任务注册表目前默认为空：M2-T03 只提供框架，`dramaticer work` 在注册表为空时输出全零统计；M2-T05、M2-T06、M2-T09 把各自的处理器登记进去即可。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。live 三轮没有主动调用写入工具；单次验收抽查调用了。提示词强化留到 M2 的记忆任务。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T04（实体与别名表）：
  - 迁移 v6：`entities(id, story_id, kind, name, description, source, created_at)` 与 `entity_aliases(entity_id, alias, normalized_alias)`；同一故事内 `normalized_alias` 唯一。
  - core 定义 `EntityKind`（`character`、`location`、`item`、`faction`、`lore`、`unknown`）与读写接口；名称规范化复用 NFKC、大小写折叠、去空白与标点。
  - `upsertEntity` 合并同名实体与别名；`resolveEntities(alias)` 按规范化后的别名返回实体列表。
  - st-compat 导入角色卡与世界书的实体：卡名作为 `character`，世界书条目名或 `comment` 作为 `lore` 名称，主关键词作为别名；core 不出现世界书、角色卡等 ST 类型。
  - 验收见 `docs/dev/TASKS.md` 的 M2-T04。
- 之后按 M2-T05 到 M2-T15 的顺序执行；事件抽取、摘要与向量索引都要通过 M2-T03 的注册表登记处理器。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli`、`runChatCli`、`runWorkCli` 的实现在 core，st-compat 的 `cli.ts` 只做分发。
- 状态快照只是缓存（不变量 I5）：只有 `getStateSnapshot` 写缓存，`appendStateDiffs` 在同一事务里失效该楼层与全部后代；不要另加减 diff 的接口。
- 后台任务只对已确认楼层入队；不要绕过注册表直接调用处理器，也不要让 `runChatTurn` 引入后台客户端（不变量 I6）。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- M2 的向量索引要新增 `sqlite-vec`；安装前先查 `node_modules` 与包的类型定义，并登记依赖。
