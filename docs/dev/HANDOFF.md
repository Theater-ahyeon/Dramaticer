# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：32
- 任务：M1-T05 块解析器
- 结果：完成（`DONE`）。
  - 新增 `packages/core/src/blocks/types.ts`：`BlockTypeDefinition` 在注册表里登记标签名与三类策略。显示策略是 `native`（组件名）/ `html`（模板）/ `hidden`；上下文策略是 `keep` / `drop` / `keep-depth`（正整数深度）/ `compress`；语义策略是 `none` 或 `handler`（接收已闭合块，返回 `state` 变更或 `note`）。`createBlockTypeRegistry` 在创建时拒绝重名、非法名称与非法策略。
  - 默认注册表 `DEFAULT_BLOCK_TYPES` 包含 DESIGN §6 的原生协议块：`thinking`（隐藏、不进入上下文）、`选项`、`页眉`、`悄悄话`、`旁白`、`备忘`。具体策略行为留到接入显示层与记忆引擎时实现。
  - 新增 `packages/core/src/blocks/parser.ts`：`BlockParser.push` 接受任意切分的文本，只在末尾构成标签前缀时缓冲；`snapshot()` 返回当前结果的深拷贝（不含未确定的标签前缀），`finish()` 把前缀当作文本并返回最终结果，结束后再推入抛错。`parseBlocks` 是一次性入口。
  - 解析结果是文本节点与块节点组成的有序树；`ParsedBlock.raw` 是块内原文，`complete=false` 表示输入结束时仍未闭合。未注册标签、不配对闭合标签都保留为原文。
  - 14 个测试，其中随机切分测试用 40 个种子按 1–4 字符切分，逐段推入的结果与一次性解析完全一致；门禁 `pnpm check` 通过（34 个测试文件、279 个测试，另 1 个 live 跳过）。ADR-0013 记录解析语义。

## 当前状态
- M1-T05 已完成；下一会话执行 M1-T06（结构化输出双模式）。
- 门禁：`pnpm check` 通过（279 个测试）。
- `packages/core` 已导出 `BlockParser`、`parseBlocks`、块类型与解析结果的类型、注册表与默认块类型。
- 块解析器只做结构解析；显示渲染、上下文裁剪、语义写入尚未实现。
- `packages/core` 的运行时依赖仍是 `@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`；`pi-agent-core` 仍在根目录 devDependencies，等 M1-T07 接入单轮执行器时再移动。

## 下一步
- 执行 M1-T06（结构化输出双模式）：
  - `state_update` 与 `plot_note` 的 schema；函数调用模式（`LlmRequest.tools` 与 `LlmResult.toolCalls` 已就绪）与文本标签模式（`BlockParser`）共用同一个校验器。
  - 校验失败时记录原因并拒绝非法值；文本标签模式下用 `finish()` 取得的 `complete` 块，未闭合块不进入校验。
  - 选择模式的依据是 `models.<alias>.probe.structuredOutput`（见 ADR-0011）。
- M1-T07 用 `assembleContext` 的 `messages` 构造 `LlmRequest`，把 `trace` 写进楼层节点，流式增量喂给 `BlockParser`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `data/` 被 git 忽略；不要把 `data/channels.yaml` 加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
