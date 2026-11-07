# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：34
- 任务：M1-T07 单轮生成 CLI
- 结果：完成（`DONE`）。
  - core 新增 `chat` 模块：`createDefaultContextTemplate` 按结构化输出模式生成八段默认模板（character、lore、state、summary、memory、director、protocol、history）；`createHistorySlotProvider` 取路径上最近 20 楼并按块上下文策略渲染；`createStateSlotProvider` 回放状态 diff；`createStaticSlotProvider` 包装固定消息。
  - `runChatTurn` 追加用户楼层、组装上下文、把正文增量推给 `BlockParser`、按模式（函数调用或文本标签）收集结构化输出，然后在一个事务里写入助手楼层、状态 diff 与 Trace。流式增量拼接结果与 `LlmResult.text` 不一致时抛错并且不写助手楼层。
  - 顶层新增 `applyStateDiffs`（用 defineProperty 写自身属性，`__proto__` 段不会改原型链）与 `renderContextView`（drop / keep / keep-depth；compress 未实现直接抛错）。
  - 存储层迁移 v2 增加 `traces` 表（楼层 id 主键，一轮只写一次），新增 `saveTurnTrace`、`getTurnTrace`、`getLatestNode`。
  - st-compat 新增 `renderCharacterPrompt` 与 `chat/cli.ts`；统一入口 `src/cli.ts` 分发 `probe`（委托 core 的 `runProbeCli`）与 `chat`。root/包内脚本都改走新入口：`pnpm dramaticer probe …`、`pnpm dramaticer chat …`。core 的 `bin` 与 `probe` 脚本删除。
  - `dramaticer chat --story <id> --card <path> --user <text> [--db <path>] [--model <alias>] [--budget <tokens>] [--max-tokens <n>] [--temperature <x>]`：故事不存在时按卡名建故事并写入 `first_mes` 开场楼层；默认模型别名取 `main`；默认数据库 `data/dramaticer.db`。
  - 28 个新测试；真实渠道（`opendesign/deepseek-v4.1-flash`）连续 3 轮对话通过，首字 1855–2529 毫秒，每轮 Trace 都有上下文逐段状态、渠道、用量与耗时。ADR-0015 记录整个链路。

## 当前状态
- M1-T07 已完成；下一会话执行 M1-T99（M1 验收 + 拆解 M2）。
- 门禁：`pnpm check` 通过（328 个测试，另有 2 个 live 测试默认跳过）。
- 数据库 schema 版本 2（`stories`、`nodes`、`state_diffs`、`node_text`、`traces`）。
- `packages/core` 的运行时依赖仍是 `@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`；`pi-agent-core` 仍在根目录 devDependencies。
- 结构化输出在真实渠道的体检结果是 `function-call`，但 live 三轮里模型没有主动调用写入工具；文本标签模式与函数调用模式的模拟测试都覆盖了。

## 下一步
- 执行 M1-T99（M1 验收）：
  - 重跑全部门禁与 live 测试（`DRAMATICER_LIVE=1 pnpm vitest run`）。
  - 首字延迟对比：用 Trace 的 `timing.firstTokenMs`（live 三轮约 1.8–2.5 秒）对比直接调用渠道的首增量时间（参考 M1-T03 的体检记录，约 2.1 秒）。
  - 逐条核对 M1 任务验收标准，写 `docs/dev/reports/M1.md`，结果写 `MILESTONE_DONE`。
  - 拆解 M2：把 TASKS 里 M2 的粗粒度条目换成 `M2-T01…`，替掉 `M2-T00`。
- 后续可考虑（不在本任务范围）：`compress` 上下文策略、显示视图、函数调用模式下模型不调用写入工具的提示词强化。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `core` 不能 import `st-compat`；`runProbeCli` 从 core 的 index 导出，供 st-compat 的统一入口调用。
- `data/` 被 git 忽略；不要把 `data/channels.yaml` 或 `data/dramaticer.db` 加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
