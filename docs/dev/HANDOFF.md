# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：35
- 任务：M1-T99 M1 验收
- 结果：完成（`MILESTONE_DONE`）。
  - 门禁重跑：`pnpm check` 通过（41 个测试文件、328 个测试，另有 2 个 live 测试默认跳过）。
  - live 门禁：`DRAMATICER_LIVE=1 pnpm vitest run` 通过（43 个文件、330 个测试）。真实渠道连续 3 轮对话：首字 1731、2202、1857 毫秒，总耗时 1989、2984、2653 毫秒；渠道体检首个正文增量 2045 毫秒。
  - Trace 完整性抽查：模板、8 个上下文段的状态与 token、模型与渠道、结束原因、用量、结构化输出计数与问题、首字与总耗时全部存在。单次抽查接受 2 条状态变更与 1 条剧情笔记。
  - 首字延迟对比与逐任务验收结论写入 `docs/dev/reports/M1.md`。结论：M1 的原生链路可用，没有违反 I1–I10。
  - M2 的条目已细化为 `M2-T01` 至 `M2-T15` 与 `M2-T99`，替换掉原来的 `M2-T00`。

## 当前状态
- M1 全部完成；下一会话执行 M2-T01（楼层树操作与分支指针）。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 2（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`）。M2-T01 会迁移到 v3。
- `packages/core` 的运行时依赖：`@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`。
- `pi-agent-core` 仍只在根目录 devDependencies，运行时接入放在 M2-T14。
- 结构化输出在真实渠道的体检结果是 `function-call`。live 三轮没有主动调用写入工具；单次验收抽查调用了。提示词强化留到 M2 的记忆任务。
- M2 的分层过关门槛写在 `M2-T15` 与 `M2-T99`：状态题命中@20 ≥ 45%；事件题命中@5 ≥ 88%、命中@20 ≥ 97%；每个对话的同一题型不低于各自 BM25 基线的 2 个百分点以内。

## 下一步
- 执行 M2-T01：
  - 迁移 v3 给 `stories` 增加 `head_node_id`，`appendNode` 在同一事务里把 head 指向新节点。
  - 增加 `setHead`、`getHead`、`getPathToHead`、`swipeNode`、`editNode`、`isNodeConfirmed`。
  - `runChatTurn` 与 `dramaticer chat` 改用 head 作为父节点。
  - 验收见 `docs/dev/TASKS.md` 的 M2-T01：兄弟节点、旧原文不变、分支切换、跨故事抛错、父节点确认、裸连接 UPDATE 被拒绝。
- 之后按 M2-T02 到 M2-T15 的顺序执行；后台任务框架（M2-T03）是事件抽取、摘要、向量索引的共同前提。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli` 与 `runChatCli` 的分工保持不变：core 提供实现，st-compat 提供统一入口。
- `data/` 被 git 忽略；不要把 `data/channels.yaml`、`data/dramaticer.db`、`data/` 下的任何文件加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。本会话的验收数据库与脚本已删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- M2 的向量索引要新增 `sqlite-vec`；安装前先查 `node_modules` 与包的类型定义，并登记依赖。
