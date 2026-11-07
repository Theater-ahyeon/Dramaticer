# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：30
- 任务：M1-T03 渠道体检
- 结果：完成（`DONE`）。
  - 新增 `packages/core/src/llm/probe.ts`：`probeChannel` 对单个渠道依次检查流式、思考、用量、函数调用、预填充与缓存统计。流式按正文增量个数判定（不少于 2 个为 `streaming`，只有 1 个或正文只在结束时到达为 `buffered`）；缓存统计用同一个大前缀连续请求两次，看第二次的 `cachedTokens`。
  - `core/llm` 接口扩展：`LlmRequest`、`LlmProviderRequest` 增加可选 `tools`，`LlmResult`、`LlmProviderResult` 增加 `toolCalls`；pi 适配器映射工具定义并提取工具调用，路由层透传，缓存键只在带工具时把工具定义并入请求体（不带工具的旧缓存键不变）。
  - `channels.ts` 增加 `LlmModelProbe` 类型、`models.<alias>.probe` 的解析与 `writeModelProbe`。写回用 YAML Document，保留注释与 `${ENV}` 引用原文。
  - CLI：`packages/core/src/cli/index.ts`，命令 `dramaticer probe <channel> [--model <alias>]`；渠道被多个模型使用时必须指定 `--model`。根目录脚本 `pnpm dramaticer ...`，core 脚本 `pnpm --filter @dramaticer/core probe`，`package.json` 增加 `bin.dramaticer`。
  - 真实渠道（`main`，`opendesign/deepseek-v4.1-flash`）：流式、函数调用、思考、用量、缓存统计均支持；预填充不支持，模型忽略末尾助手消息并重新输出完整 JSON。流式请求 7 个正文增量，首个增量 2093 毫秒，2173 毫秒完成；第二次相同的大前缀请求命中缓存 5248 个 token。
  - 新增 9 个模拟提供方测试与 1 个 `llm-probe.live.test.ts`（默认跳过，`DRAMATICER_LIVE=1` 时运行）。门禁 `pnpm check` 通过（32 个测试文件、250 个测试）。

## 当前状态
- M1-T03 已完成；下一会话执行 M1-T04（原生上下文模板与组装器）。
- 门禁：`pnpm check` 通过（250 个测试）。
- `data/channels.yaml` 的 `models.main.probe` 已有本机体检结果；该文件被 git 忽略。新克隆仓库复制 `channels.example.yaml` 后，先运行 `pnpm dramaticer probe main --model main` 再使用体检结果。
- `probeChannel` 直接调用渠道适配器，不经过 `LlmRouter` 的限速、重试与缓存；单项失败会记为 `unknown` 并写入 `notes`。
- `packages/core` 的运行时依赖仍是 `@earendil-works/pi-ai@1.5.0`、`better-sqlite3`、`yaml`；`pi-agent-core` 仍在根目录 devDependencies，等 M1-T06 或 M1-T07 接入工具/单轮执行器时再移动。
- 工具调用只做到接口透传与探测，尚未实现工具执行循环；那是 M1-T06、M1-T07 的范围。

## 下一步
- 执行 M1-T04（原生上下文模板与组装器）：
  - 实现 DESIGN §9 的原生模板（静态段、条件段、槽位）、槽位提供者接口、按优先级的 token 预算裁剪、Trace 记录（每一段的来源与 token 数）。
  - 测试覆盖预算裁剪、条件段、缺失槽位。
- M1-T06 可以直接读取 `models.<alias>.probe.structuredOutput` 选择函数调用或文本标签模式。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `data/` 被 git 忽略；不要把 `data/channels.yaml` 加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
