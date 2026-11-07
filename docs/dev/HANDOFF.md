# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：71
- 任务：M4-T05 server 故事、导入与设置接口
- 结果：完成（`DONE`）。
  - 新增 `packages/server/src/routes.ts`，`startServer` 在会话校验后把 `/api` 请求交给 `handleApiRequest`；`/api/health` 与 `/api/login` 仍由 `server.ts` 直接处理。
  - 故事：`GET/POST /api/stories`、`GET/PATCH /api/stories/:id`。列表与详情返回 `StoryView`（含 head），创建返回 201；`PATCH` 只接受 `title`；重复 id 409；未知故事 404；空标题与未知字段 400，`details.path` 指向字段。
  - 导入：`POST /api/stories/:id/import`，请求形状 `{card:{format:"png"|"json",data:string}, worlds?:string[]}`，PNG 的 `data` 是不带前缀的 base64，JSON 卡与世界书是文本。解析在事务外完成；实体、卡内世界书、外部世界书、`extensions.dramaticer` 与故事设置（`cardName`、`characterPrompt`）在同一个事务里写入。重复导入幂等：实体只合并别名，lore 按来源跳过，事件池与 NPC 议程只更新。响应 `ImportStoryResult` 带各步计数。
  - 设置：`GET/PUT /api/stories/:id/settings`，PUT 是合并式更新，未知字段与非法枚举/数值 400，`details.path` 从 store 错误里推断（`directorConfig.*` 也覆盖）；未知 `templateId` 400。
  - 模板：`GET/POST /api/templates`、`GET/PUT/DELETE /api/templates/:id`。创建 201，删除 204；重名 409；仍被故事设置引用的模板 409 并返回 `{storyId}`；未知模板 404。
  - core：`StoryStore.updateStoryTitle`；`findStoryUsingContextTemplate`（`deleteContextTemplate` 复用同一查询）。
  - st-compat：`index.ts` 导出 `chat/session.js`；`importCardContent` 返回值增加 `entities`、`lore`、`events`、`npcAgendas` 计数，原调用方不受影响。
  - protocol：`story.ts` 新增 `PngCharacterCard`、`JsonCharacterCard`、`ImportCharacterCard`、`ImportStoryRequest`、`ImportStoryCounts`、`ImportStoryResult`。
  - `packages/server` 增加工作区依赖 `@dramaticer/st-compat`（不登记 DEPENDENCIES）与 tsconfig reference；锁文件已更新。
  - 新增 `packages/server/test/stories.test.ts` 的 9 个测试（故事 CRUD、两种卡格式导入与重复导入、非法卡与世界书、设置、模板 CRUD 与引用冲突）。原 `server.test.ts` 里 `/api/stories` 的 404 断言改为 200 空列表。门禁通过：615 个测试（新增 9 个）。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T05 完成；M4-T06 待做。
- 数据库 schema 版本 17。
- `packages/server`：`startServer` 返回 `{origin, store, close}`；`http.ts` 提供 `HttpError`、`sendJson`、`sendError`、`readJsonBody`；`auth.ts` 提供会话与 Origin 判断；`static-files.ts` 提供静态资源；`routes.ts` 提供故事、导入、设置、模板接口。`--channels` 已经解析并保存，路由还没使用它。
- `packages/server` 依赖 `@dramaticer/core`、`@dramaticer/protocol`、`@dramaticer/st-compat`。
- `packages/web` 尚未创建；`packages/web/dist` 不存在时静态请求返回 404 JSON。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；不要引用事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实，留给 M4-T20 的 50 轮试玩。
- 兼容线 C-T00 排在 M4 之后，与 M4 的沙箱渲染器衔接。

## 下一步
- **M4-T06 server 运行时与 SSE 对话**，依赖 M4-T05、M4-T03、M4-T02，可以直接执行。
  - `StoryRuntime`：按故事设置建正文客户端、embedding 客户端、模板与槽位提供者；设置或渠道配置变化后失效；正文与后台客户端分开。
  - `POST /api/stories/:id/turns` 返回 `text/event-stream`：`turn.started`、`text.delta`、`thinking.delta`、`blocks.replace`（节流 100 毫秒与结束时各一次）、`tool.call`、`turn.completed`（用户与助手楼层、状态 diff、笔记、用量、Trace 摘要、首字毫秒）、`turn.error`；每 15 秒心跳注释。
  - 每个故事同时只允许一个回合，冲突 409；客户端断开触发 `AbortController`，已生成内容写入助手楼层并记录中止；服务端关闭中止全部回合。
  - 运行时复用 `@dramaticer/protocol` 的 `TurnRequest` 与 SSE 事件类型；设置读取走 `store.getStorySettings`，模板走 `getContextTemplate`。
- 之后按 TASKS 顺序：M4-T07 server 后台任务调度。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
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
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`，工作区内部依赖不需要登记。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`；新增工作区包后需要 `--no-frozen-lockfile` 更新锁文件。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。
- 函数调用模式的读取工具列表会随 `READ_TOOLS` 变化；测试不要断言完整列表，只断言写入工具在前、包含用到的读取工具。
- server 测试使用 `packages/server/test/.tmp-server-*` 临时目录（已被 git 忽略），并且只监听 127.0.0.1 的随机端口；写测试时不要发送外部网络请求（I10 会扫描测试文件里的 URL 字面量）。
- Playwright 浏览器与 `pnpm e2e` 不进入 `pnpm check`；端到端失败产物写 `.devloop/scratch/e2e/`。
- 故事设置的更新时间由存储层用 `new Date().toISOString()` 写入；测试不要断言具体时间值。
- 导入接口的角色卡图片与 JSON 都在请求体内，25 MB 上限覆盖；PNG base64 目前只接受无前缀的 base64，测试里用 `node:zlib` 构造最小 PNG。
