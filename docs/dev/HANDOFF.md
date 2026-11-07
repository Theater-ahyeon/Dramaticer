# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：37
- 任务：M2-T02 状态快照缓存
- 结果：完成（`DONE`）。
  - 迁移 v4：新增 `state_snapshots(node_id PRIMARY KEY, story_id, state, computed_at)` 与 `state_snapshots_story_matches_node` 触发器，快照不能跨故事。
  - `state.ts` 新增 `applyStateDiffsTo(base, diffs)`：深拷贝已有状态后累加 diff；`applyStateDiffs` 变成它的空状态特例。
  - `getStateSnapshot(nodeId)`：命中缓存直接返回；否则递归取父节点快照，叠加本楼层 diff 后在同一连接里写入缓存。`getStateSnapshotAtHead(storyId)` 复用该入口，故事没有楼层时返回 `null`。
  - `appendStateDiffs` 在同一事务里用递归查询删除该楼层及全部后代的缓存；祖先与兄弟分支的缓存保留。
  - `createStateSlotProvider` 改用 `getStateSnapshot`，不再从根节点回放；`countStateDiffsAlongPath` 只统计条数，Trace 来源仍是 `state:<n> 条 diff`，输出格式不变。
  - 新增 8 个测试（随机分支树快照与回放一致、缓存命中时 `computed_at` 不变、失效范围、分支隔离、删除型 diff 与 `__proto__`、head 入口与切换分支、缺失楼层与故事抛错）。
  - 门禁：`pnpm check` 通过（42 个测试文件、341 个测试，2 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01、M2-T02 完成；下一会话执行 M2-T03（后台任务框架）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 4（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`、`stories.head_node_id`、`state_snapshots`）。M2-T03 会迁移到 v5。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。live 三轮没有主动调用写入工具；单次验收抽查调用了。提示词强化留到 M2 的记忆任务。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T03（后台任务框架）：
  - 迁移 v5：`background_jobs(id, story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at, UNIQUE(node_id, kind))`，状态取 `pending`、`running`、`done`、`failed`。
  - 任务类型注册表；`enqueueMissingJobs(storyId)` 扫描已确认节点，重复调用不产生重复行。
  - `drainBackgroundJobs({storyId, client, kinds, limit, now})`：先补齐任务，再按创建顺序执行；处理器通过注入的注册表获得 `{store, client, job}`；失败按最多 3 次重试，超过后标为 `failed` 并保留最后错误。
  - `dramaticer work --db <path> [--limit <n>] [--kind <kind>]`：单次执行一轮任务并打印统计，不启动长期进程。
  - `runChatTurn` 不调用后台模型；主循环与后台任务的客户端分开创建。
  - 验收见 `docs/dev/TASKS.md` 的 M2-T03。
- 之后按 M2-T04 到 M2-T15 的顺序执行；后台任务框架（M2-T03）是事件抽取、摘要、向量索引的共同前提。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli` 与 `runChatCli` 的分工保持不变：core 提供实现，st-compat 提供统一入口。
- 状态快照只是缓存（不变量 I5）：只有 `getStateSnapshot` 写缓存，`appendStateDiffs` 在同一事务里失效该楼层与全部后代；不要另加减 diff 的接口。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- M2 的向量索引要新增 `sqlite-vec`；安装前先查 `node_modules` 与包的类型定义，并登记依赖。
