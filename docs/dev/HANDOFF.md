# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：72
- 任务：M4-T06 server 运行时与 SSE 对话
- 结果：完成（`DONE`）。
  - 新增 `packages/server/src/runtime.ts`：`StoryRuntimeManager` 按故事缓存 `StoryRuntime`，包含正文客户端、后台客户端、embedding 客户端、上下文模板与槽位提供者。缓存键是故事设置的 `updatedAt` 与渠道配置的稳定指纹（渠道、模型、embedding 三段的 JSON）；渠道配置每回合重新读取，内容不变就复用。正文与后台客户端分别创建；没有 `background` 模型时后台客户端为 `null`；没有 `embeddings.default` 时 embedding 客户端为 `null`。
  - 新增 `packages/server/src/sse.ts`：`createSseStream` 写 `text/event-stream`、事件帧与注释心跳；`SSE_HEARTBEAT_MS` 为 15 秒，`startServer` 可用 `heartbeatMs` 覆盖。
  - 新增 `packages/server/src/turns.ts`：`TurnCoordinator` 按故事互斥，第二个回合返回 409；`handleTurnStream` 先追加用户楼层并发送 `turn.started`，再调用 `generateAssistantTurn`。`text.delta` 原样转发，`blocks.replace` 首次与每 100 毫秒最多一次，结束时再发最终块；`thinking.delta`、`tool.call` 转发；成功发 `turn.completed`，响应头发出后的错误发 `turn.error`。
  - 客户端断开时 `res` 的 `close` 触发 `AbortController`；`generateAssistantTurn` 捕获中止并把已经生成的正文、思考与首字时间保存成助手楼层，Trace 的 `stopReason` 为 `aborted`，状态变更与笔记为空；没有正文时不建楼层。服务端 `close()` 先 `turns.abortAll()` 并等待写入完成，再关闭连接与数据库。
  - core：执行器新增 `TurnAbortedError`（携带 `partialText`、`partialReasoning`、`firstTokenMs`，消息沿用中止原因）与 `onToolCall` 回调；`runModelTurns` 把整轮放在 try/catch 里，信号中止时统一转换。`createStandardChatProviders` 的 `characterPrompt` 允许为 `null`，空值时省略 character 槽位。新增 `pickDefaultModelAlias`，st-compat 的聊天 CLI 改用它。
  - server：`StartServerOptions` 新增 `channels?: {path?, load?, createClient?, createEmbedder?}`。提供 channels 时启动阶段先加载一次配置，用 `embeddings.default.dimensions` 打开 `StoryStore`；不提供时故事接口照常可用，但 `POST /turns` 返回 500。`dramaticer-serve` 现在把 `--channels` 的路径传给 `startServer`。
  - 测试：core 新增 1 个中止保存测试；server 新增 `test/turns.test.ts` 的 7 个测试（事件顺序与终态、并发 409、心跳、客户端断开保留部分正文、服务端关闭保留部分正文、函数调用工具轮次、设置与渠道配置失效）。门禁通过：623 个测试（新增 8 个）。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T06 完成；M4-T07 待做。
- 数据库 schema 版本 17。
- `packages/server`：`startServer` 返回 `{origin, store, close}`；`http.ts` 提供 `HttpError`、`sendJson`、`sendError`、`readJsonBody`；`auth.ts` 提供会话与 Origin 判断；`static-files.ts` 提供静态资源；`routes.ts` 提供故事、导入、设置、模板接口；`runtime.ts` 提供运行时缓存；`sse.ts` 提供 SSE 帧；`turns.ts` 提供回合互斥与流式对话。
- `packages/server` 依赖 `@dramaticer/core`、`@dramaticer/protocol`、`@dramaticer/st-compat`。
- `packages/web` 尚未创建；`packages/web/dist` 不存在时静态请求返回 404 JSON。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；不要引用事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实，留给 M4-T20 的 50 轮试玩。
- 兼容线 C-T00 排在 M4 之后，与 M4 的沙箱渲染器衔接。

## 下一步
- **先处理 INBOX 里的 v2 采纳指令**（本次会话中途由人类写入，`docs/proposals/v2.md`，AGENTS.md 的不变量已同步改好）：
  - 按 INBOX 的五个步骤写 ADR、把提案合并进 `docs/DESIGN.md`、把未开始的 M4-T04 之后任务移到 R5，并新建与细化 R1、R2。
  - 这一步会改变路线图与任务编号；在它完成前不要继续做 M4-T07。
  - 不要修改 AGENTS.md，它已经由人类改好；新不变量见 I6、I7、I9、I11–I14。
- **M4-T07 server 后台任务调度**（若 v2 合并后仍保留），依赖 M4-T06、M2-T03。
  - 回合成功后异步执行 `enqueueMissingJobs` 与 `drainBackgroundJobs`，不阻塞 SSE 的 `turn.completed`；服务端同一时间只跑一个后台任务。
  - 使用 `StoryRuntime.backgroundClient`（可能为 `null`，此时只入队不执行，或者直接跳过）与独立限速；处理器注册表沿用 `packages/core/src/background`。
  - `GET /api/stories/:id/jobs` 返回 pending/running/done/failed 计数与最近错误。
  - 服务端关闭中止正在执行的处理器，已有的 `turns.abortAll()` 是现成的模式。
- 之后按 TASKS 顺序：M4-T08 server 分支与面板接口。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 服务端启动时提供 `channels` 就会加载渠道配置；配置缺失或环境变量没设置会让启动失败，这是有意的快速失败。测试里通过 `channels.load` 与 `createClient` 注入假客户端。
- SSE 测试的临时目录用 `packages/server/test/.tmp-server-*`，已忽略；假渠道的 baseUrl 用 `127.0.0.1`，I10 允许。
- 中止保存的部分正文会写 Trace，`stopReason` 为 `aborted`，`usage` 全为 `null`；不要把它当成正常完成。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- `director-eval` 的 `workDir` 默认在 `eval-private/memory-cache/tmp/director-eval`，结束时整目录删除；主模型回复缓存关闭，embedding 内容缓存保留。
- 状态题 JSONL 必须带 `path`（非空字符串数组）；事件题不要带这个字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。`director-eval` 的统计版只用“对话 N”，不写实际故事 id。
- 参照报告默认读取 `eval-private/reports/reference-cosine.json` 里的余弦校准；更换 embedding 模型或维度后要重新运行 `reference:cosine`。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`，工作区内部依赖不需要登记。本任务没有新增依赖。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`；新增工作区包后需要 `--no-frozen-lockfile` 更新锁文件。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。
- 函数调用模式的读取工具列表会随 `READ_TOOLS` 变化；测试不要断言完整列表，只断言写入工具在前、包含用到的读取工具。
- Playwright 浏览器与 `pnpm e2e` 不进入 `pnpm check`；端到端失败产物写 `.devloop/scratch/e2e/`。
- 故事设置的更新时间由存储层用 `new Date().toISOString()` 写入；测试不要断言具体时间值。
- 导入接口的角色卡图片与 JSON 都在请求体内，25 MB 上限覆盖；PNG base64 目前只接受无前缀的 base64，测试里用 `node:zlib` 构造最小 PNG。
