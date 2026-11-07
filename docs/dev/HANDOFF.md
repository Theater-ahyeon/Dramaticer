# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：12
- 任务：M0-T11 LLM 最小客户端与事件类题目
- 结果：完成。core 新增 `src/llm/client.ts`（OpenAI 兼容 Chat Completions、每分钟请求数限速、指数退避重试、按请求 hash 做文件缓存、解析思考内容和思考 token）；st-compat 新增 `evalset/event-questions.ts` 与 `evalset/event-cli.ts`。`pnpm --filter @dramaticer/st-compat evalset:events` 生成 `eval-private/evalset/event-<故事>.jsonl`、`event-summary.json` 和 `spotcheck.md`。3 个对话各 50 题（候选 70/75/105，请求 16/17/24，失败窗口 8/7/0，思考 token 4809/10876/52621），结构核对全部一致；抽查文件 30 题。15 个新测试，`pnpm check` 通过（invariants → typecheck → lint → 134 个测试）。
- 渠道变化：`antigravity/gemini-3.8-flash` 在生成第三个对话时被上游停用（HTTP 403，违反服务条款），第三个对话改用环境变量 `DRAMATICER_BG_MODEL=auto/deepseek-v4.1-flash` 完成；已记入 HUMAN-05。

## 当前状态
- 门禁：`pnpm check` 通过（134 个测试）。
- core/llm（`packages/core/src/llm/client.ts`，从 `index.ts` 导出）：
  - `OpenAiCompatibleClient` 实现 `LlmClient.complete(request)`；非流式，请求体默认 `{model, messages, stream:false}`，支持 `temperature`、`maxTokens`、`reasoningEffort` 和 `extraBody`。
  - 限速：实例内串行排队，相邻请求起点至少间隔 `60000 / requestsPerMinute` 毫秒；0 表示不限速。
  - 重试：429、5xx、网络错误、超时和非法 JSON 按指数退避重试；优先使用 `Retry-After`；调用方 abort 不重试。
  - 缓存：key 是 `baseUrl` 加稳定序列化请求体的 sha256，不含 api key；缓存目录由调用方指定，命中时 `cached:true`、`attempts:0`。
  - 结果字段：`text`、`reasoning`、`finishReason`、`model`、`usage`（含 `reasoningTokens`、`cachedTokens`）、`raw`、`cached`、`attempts`。
- 事件题（`packages/st-compat/src/evalset/event-questions.ts`，从 `index.ts` 导出）：
  - `buildEventQuestions(entries, client, options)` / `buildEventQuestionsFromFile`；`verifyEventQuestions` / `verifyEventQuestionsFromFile` 重新解析聊天核对。
  - 窗口：排除 system 和空正文楼层，按字符预算切连续窗口，沿故事均匀取样最多 `maxWindows` 个；每个窗口的最后一楼是提问楼层，模型只能引用窗口内、且比提问楼层至少早 `minEvidenceGap` 楼的证据。
  - 模型输出支持纯数组、`{"questions":[...]}`、代码块包裹；逐条校验字段、楼层存在性、窗口范围和间隔，按去标点文本去重，最后按窗口轮转选 `maxQuestions` 道。
  - 题目字段：`{id, story, askAtNode, question, answer, evidenceNodes, kind:"event"}`，id 是 `event:<故事>:<提问楼层号>:<序号>`。
  - 自动核对只验证结构和楼层顺序；答案质量靠 `eval-private/evalset/spotcheck.md` 的人工抽查（HUMAN-03，可选）。
- 事件题 CLI：`pnpm --filter @dramaticer/st-compat evalset:events`。
  - 渠道从 `.env` 读取 `DRAMATICER_BG_BASE_URL`、`DRAMATICER_BG_API_KEY`、`DRAMATICER_BG_MODEL`；缓存目录是 `eval-private/llm-cache`。
  - 可选环境变量：`DRAMATICER_BG_REQUESTS_PER_MINUTE`（默认 20）、`DRAMATICER_BG_TIMEOUT_MS`（默认 300000）、`DRAMATICER_BG_MAX_RETRIES`（默认 1）、`DRAMATICER_BG_REASONING_EFFORT`（默认不发送）、`DRAMATICER_EVAL_QUESTIONS_PER_WINDOW`（5）、`DRAMATICER_EVAL_MAX_WINDOWS`（24）、`DRAMATICER_EVAL_MAX_WINDOW_CHARS`（24000）、`DRAMATICER_EVAL_MAX_TOKENS`（4096）。
  - `--story <名字>` 只重跑一个对话；会覆盖该对话的 JSONL 以及整体 summary/spotcheck，之后要再跑一遍不带参数的命令或重新汇总。
- 评测集（私有，未提交）：
  - 状态题 236 题（仙侠 71、欲望世界 65、银麒赎世 100）。
  - 事件题 150 题（各 50），`eval-private/evalset/event-*.jsonl`。
  - `eval-private/evalset/spotcheck.md` 从 150 题里每个故事随机抽 10 题，共 30 题。
  - `event-summary.json` 记录每题的来源文件、题目数、提问楼层数、证据数量，以及两个故事用 antigravity、第三个故事用 deepseek 的模型说明。
- ADR-0007 记录了后台客户端和事件题出题方式。依赖没有变化；core 仍然不出现 ST 概念（I1）。
- `scripts/` 与 `tools/` 未修改。

## 下一步
- 执行 M0-T12（朴素 BM25 检索）。它只依赖 M0-T10，不需要 LLM；用现有 SQLite FTS5 `node_text` 表做基线，把结果追加到 `eval-private/reports/health.md` 和 `docs/dev/reports/M0-health.md`。
- 之后是 M0-T13（ACU 对照组），最后 M0-T99（M0 验收）。
- M1 之前处理 HUMAN-05：更换后台渠道账号或模型。第三个对话使用的 `auto/deepseek-v4.1-flash` 可以作为临时替代；改模型会让现有缓存全部失效（缓存 key 包含模型名）。
- HUMAN-01 里的 antigravity 账号被停用属于上游封禁，不是代码问题，不要反复重试。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- 当前 `.env` 仍指向已停用的 `antigravity/gemini-3.8-flash`。临时换模型用命令行环境变量覆盖，例如 `DRAMATICER_BG_MODEL=auto/deepseek-v4.1-flash pnpm --filter @dramaticer/st-compat evalset:events`。
- 缓存按模型区分；换模型不会命中旧缓存。删除 `eval-private/llm-cache` 可以强制重新生成。缓存和评测集都包含私有正文，只能留在被 git 忽略的目录。
- `pnpm check` 之前会先跑 `tsc -b`；改了 CLI 或生成器后直接跑脚本即可，`evalset:events` 自身也会先编译。
- 状态题核对依赖“空对象表示没有更新”的语义（ADR-0006）；改动 `readSnapshot` 或快照展开规则时，必须同时重新跑 `evalset`。
- 分类器对正则做静态分析，不执行正则；新增判定规则时先补合成用例。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
