# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：33
- 任务：M1-T06 结构化输出双模式
- 结果：完成（`DONE`）。
  - 新增 `packages/core/src/structured`：`types.ts` 定义两种传输模式的收集结果（`stateUpdates`、`notes`、`issues`）；`schema.ts` 定义 `STATE_UPDATE_SCHEMA`、`PLOT_NOTE_SCHEMA` 与 `STRUCTURED_OUTPUT_TOOLS`，并提供 `resolveStructuredOutputMode(probe)`（无体检结果回退到 `text-tags`）；`validate.ts` 是两种模式共用的校验器；`collect.ts` 提供 `collectStructuredOutputFromToolCalls` 与 `collectStructuredOutputFromText`。
  - `state_update` 一次只承载一条变更：`path`（非空字符串数组，元素两端去空白）、`op`（`set` / `delete`）、`value`（`set` 必须有，可为 `null`；`delete` 不能出现）、`reason`（可选，空串归一化为 `null`）。`plot_note` 只有非空 `text`。未知字段、非法 `op`、空路径、非字符串路径段、`__proto__`/`constructor`/`prototype` 路径段都被拒绝，并给出具体原因。
  - 文本标签模式用 `BlockParser` 解析完整回复，只取 `complete` 的块；未闭合、空内容、非法 JSON 都记为拒绝并保留原文；嵌套在其他块里的写入块也会被收集。
  - `state_update` 与 `plot_note` 已登记进 `DEFAULT_BLOCK_TYPES`（显示 `hidden`、上下文 `drop`、语义 `none`），显示层与上下文层会自动忽略它们。
  - 21 个新测试，其中两种模式用同一组负载产出相同结构；ADR-0014 记录负载语义与拒绝策略。门禁 `pnpm check` 通过（35 个测试文件、300 个测试，另 1 个 live 跳过）。

## 当前状态
- M1-T06 已完成；下一会话执行 M1-T07（单轮生成 CLI）。
- 门禁：`pnpm check` 通过（300 个测试）。
- `packages/core` 已导出块解析器、上下文组装器、结构化输出三个模块；`LlmResult.toolCalls` 已由 pi 适配器和路由层提供。
- 还没有默认的原生上下文模板，也没有 protocol 槽位的提供者；结构化输出的提示词（告诉模型用哪种方式输出）尚未实现。
- `packages/core` 的运行时依赖仍是 `@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`；`pi-agent-core` 仍在根目录 devDependencies。

## 下一步
- 执行 M1-T07（单轮生成 CLI）：
  - 用 `resolveStructuredOutputMode` 决定模式：`function-call` 时把 `STRUCTURED_OUTPUT_TOOLS` 放进 `LlmRequest.tools`，`text-tags` 时在 protocol 槽位的提示词里说明标签写法。
  - 用 `collectStructuredOutputFromToolCalls` 或 `collectStructuredOutputFromText` 收集结果；`issues` 写进 Trace，`stateUpdates` 转成 `NewStateDiff`（`source` 建议写模型用的传输方式），`notes` 留给 M2 的剧情笔记存储。
  - 需要一个默认的原生模板（静态 protocol 段 + 槽位），以及 `chat` 槽位与 `history` 槽位的最小提供者。
  - 流式生成时把正文增量同时推给 `BlockParser.snapshot()` 供显示，结束后用 `finish()` 的结果。
- M1-T99 需要首字延迟对比（和直接调用渠道相比）。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `data/` 被 git 忽略；不要把 `data/channels.yaml` 加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
