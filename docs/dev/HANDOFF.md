# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：28
- 任务：M1-T01 pi 技术验证
- 结果：完成（`DONE`）。
  - 在根目录 devDependencies 安装并锁定 `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core` 为 `1.5.0`，登记到 `DEPENDENCIES.md`。
  - `spikes/pi/` 共 5 个脚本：`channel.mjs`（读 `.env`、包装单模型 provider）、`openai-stream.mjs`、`abort-continue.mjs`、`agent-hooks.mjs`、`gemini-baseurl.mjs`。
  - 真实渠道（`http://127.0.0.1:3425/v1`，`opendesign/deepseek-v4.1-flash`）结果：流式 96 个思考增量加 24 个正文增量，第一个事件 1.65 秒、第一个正文 3.54 秒；强制函数调用返回 `get_time({"timezone":"Asia/Shanghai"})`；中止后保留 21 字符部分正文，带部分消息续写 2569 字符；`prepareRequest` 注入的上下文进入请求，`beforeToolCall` 收到校验后参数并成功拦截，`finishTurn` 的 `{action:"end"}` 把请求数限制为 1。
  - Gemini 原生适配器确认把 `model.baseUrl` 作为根路径（请求地址 `http://127.0.0.1:7861/models/gemini-2.5-flash:streamGenerateContent?alt=sse`）；gcli2api 未运行，端到端跳过。
  - ADR-0009 记录采用范围与四个渠道行为差异；门禁 `pnpm check` 通过（27 个测试文件、225 个测试）。

## 当前状态
- M1-T01 已完成；下一会话执行 M1-T02。
- 门禁：`pnpm check` 通过（225 个测试）。
- pi 版本：两个包都锁定 `1.5.0`；当前在根目录 devDependencies，M1-T02 采用后移到 `packages/core` 的运行时依赖。
- 安装依赖时注意：环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`（直接连 `registry.npmmirror.com` 可用）。
- 渠道行为（ADR-0009）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；Google 适配器拒绝注入的 `fetch`（错误信息 “Custom fetch is not supported by the Google Generative AI adapter”），渠道体检不要依赖注入 fetch；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下。
- `spikes/pi/` 的脚本会访问真实渠道并消耗额度；运行前提是 `.env` 已填写、magpie 网关（`127.0.0.1:3425`）正在运行。`gemini-baseurl.mjs` 在 gcli2api 未运行时自动跳过端到端验证。
- 旧的最小客户端 `packages/core/src/llm/client.ts` 仍在使用（事件题生成器），M1-T02 迁移后删除。

## 下一步
- 执行 M1-T02（core/llm 接口与渠道）：
  - 定义薄接口：流式事件、用量、中止；渠道配置 `data/channels.yaml`，密钥用 `${ENV}` 引用 `.env`；同一模型多渠道按优先级切换；重试；截断检测（`stopReason: "length"`、标签未闭合、内容突然中断）；续写。
  - 用 pi 实现该接口（ADR-0009 已决定采用 pi-ai；agent-core 只作为无状态单轮执行器，`identity` 设为 `{ attribution: null }`）。
  - 迁移 `evalset/event-questions.ts` 到新接口，保留 `eval-private/llm-cache` 读取避免重复调用渠道，然后删除 `packages/core/src/llm/client.ts`。
  - 验收：模拟提供方测试切换、重试、续写；事件题测试改用新接口的假客户端；`pnpm check` 通过。

## 注意事项
- 只有 `spikes/` 下的脚本直接依赖 pi 包；`packages/core/src` 不能出现 ST 概念（不变量 I1），也不要把 pi 的类型泄漏进领域模型。
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以文件与符号为准。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 7 秒。
- `health/cli.ts` 的入口判断是 `import.meta.url === pathToFileURL(process.argv[1]).href`；测试导入它不会执行 `main`。
- `openSnapshot.resolveFile` 会对每个文件重新计算一次 sha256；不要在调用侧绕过入口。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`spikes/pi/` 属于可提交的验证脚本。
