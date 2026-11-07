# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：31
- 任务：M1-T04 原生上下文模板与组装器
- 结果：完成（`DONE`）。
  - 新增 `packages/core/src/context/template.ts`：`ContextTemplate` 是片段数组，片段只有 `static`（静态文本）与 `slot`（`lore`、`character`、`persona`、`summary`、`state`、`memory`、`history`、`director`、`protocol`）两种。条件段用片段上的 `when` 表达；条件本身是数据：`switch`（未设置按 false）、`state`（按路径 `exists` / `equals` / `truthy`）、`all` / `any` / `not`。
  - 新增 `packages/core/src/context/assembler.ts`：`assembleContext` 先求值条件（条件为假的槽位不调用提供者），再向 `ContextSlotProvider` 取 `ContextMessage[]` 与来源描述。没有提供者、返回 `null` 或空消息记 `missing-slot`；消息结构不合法直接抛错。
  - 预算按片段 `priority` 从高到低整体保留，同优先级保留模板里靠前的片段；选中后按模板顺序输出，保证前缀稳定。Trace 按模板顺序记录每个片段的 `status`（`included`、`condition-false`、`missing-slot`、`budget-dropped`）、`source`、`tokens`、`priority`，以及总 token 数。
  - `createTokenEstimator` 从 `packages/st-compat/src/health/token-estimate.ts` 移到 `packages/core/src/tokens.ts`，st-compat 的体检报告与测试改从 core 引用，旧文件删除。ADR-0012 记录数据模型。
  - 15 个组装器测试、5 个 token 测试；门禁 `pnpm check` 通过（33 个测试文件、265 个测试，另 1 个 live 跳过）。

## 当前状态
- M1-T04 已完成；下一会话执行 M1-T05（块解析器）。
- 门禁：`pnpm check` 通过（265 个测试）。
- `packages/core` 已导出 `assembleContext`、模板与条件类型、`createTokenEstimator`。
- 组装器只做片段级预算裁剪；片段内部截断、槽位自己的 top-K 留给 M2 的提供者实现。
- 还没有默认的原生模板内容；M1-T07 需要一份默认模板（槽位顺序与少量静态文本）。
- `packages/core` 的运行时依赖仍是 `@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`；`pi-agent-core` 仍在根目录 devDependencies，等 M1-T06 或 M1-T07 接入工具/单轮执行器时再移动。

## 下一步
- 执行 M1-T05（块解析器）：
  - 在 core 里实现增量（流式）标签块解析器：未闭合块、嵌套、可配置标签名、普通文本与块交错。
  - 块类型登记表里，每种类型声明显示、上下文、语义三类策略的接口（策略实现留到后面）。
  - 验收：随机切分输入后逐段喂入，结果与一次性解析一致。
- M1-T06 可以直接读取 `models.<alias>.probe.structuredOutput` 选择函数调用或文本标签模式。
- M1-T07 用 `assembleContext` 的 `messages` 直接构造 `LlmRequest`，把 `trace` 写进楼层节点。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `data/` 被 git 忽略；不要把 `data/channels.yaml` 加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
