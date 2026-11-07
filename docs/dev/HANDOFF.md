# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：36
- 任务：M2-T01 楼层树操作与分支指针
- 结果：完成（`DONE`）。
  - 迁移 v3：`stories` 增加可空列 `head_node_id`（引用 `nodes(id)`），并加触发器 `stories_head_same_story`，裸连接不能把 head 指向其他故事的节点。
  - `appendNode` 在插入楼层与更新 head 的同一个事务里完成，嵌套在 `runInTransaction` 里时使用 savepoint。
  - 新增 `setHead`、`getHead`、`getPathToHead`、`swipeNode`、`editNode`、`isNodeConfirmed`；`getLatestNode` 已删除。
  - `runChatTurn` 不再接收 `parentNodeId`，父节点取自 `getHead`；`dramaticer chat` 同步去掉取最后插入楼层的逻辑。导入 ST 对话时，追加完兄弟 swipe 后把 head 设回主路径末端。
  - 新增 6 个测试（head 跟随追加并在重开后保持、swipe/edit 生成兄弟节点、切到旧分支、跨故事与缺失节点抛错、子节点确认父节点、裸连接改 head 被触发器拒绝），删除过期的 `getLatestNode` 测试。
  - 门禁：`pnpm check` 通过（41 个测试文件、333 个测试，2 个 live 测试默认跳过）。

## 当前状态
- M0、M1 完成；M2-T01 完成；下一会话执行 M2-T02（状态快照缓存）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 3（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`，`stories.head_node_id`）。M2-T02 会迁移到 v4。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。live 三轮没有主动调用写入工具；单次验收抽查调用了。提示词强化留到 M2 的记忆任务。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T02：
  - 迁移 v4：`state_snapshots(node_id PRIMARY KEY, story_id, state, computed_at)`。
  - `getStateSnapshot(nodeId)` 命中缓存直接返回，否则取父节点快照叠加本楼 diff 后写缓存；`getStateSnapshotAtHead(storyId)` 走同一逻辑。
  - `appendStateDiffs` 写入后删除该楼层及全部后代的快照缓存。
  - `createStateSlotProvider` 改用快照，输出格式不变。
  - 验收见 `docs/dev/TASKS.md` 的 M2-T02。
- 之后按 M2-T03 到 M2-T15 的顺序执行；后台任务框架（M2-T03）是事件抽取、摘要、向量索引的共同前提。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli` 与 `runChatCli` 的分工保持不变：core 提供实现，st-compat 提供统一入口。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- M2 的向量索引要新增 `sqlite-vec`；安装前先查 `node_modules` 与包的类型定义，并登记依赖。
