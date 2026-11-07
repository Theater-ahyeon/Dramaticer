# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：70
- 任务：M4-T04 server 骨架、认证与静态资源
- 结果：完成（`DONE`）。
  - 新增 `packages/server`（`@dramaticer/server`）：`node:http`，不引入 Web 框架；`dramaticer-serve` 入口与 `--db`、`--port`（默认 8787）、`--host`（默认 127.0.0.1）、`--channels`、`--web` 参数；根脚本为 `pnpm serve`。默认路径从仓库根目录解析：`data/dramaticer.db`、`data/channels.yaml`、`packages/web/dist`。
  - 认证：绑定非回环地址且没有 `DRAMATICER_SERVER_PASSWORD` 时 `startServer` 先抛错，不会创建数据库；`/api/login` 对双方各取 sha256 摘要后用 `timingSafeEqual` 比较，成功后发 `dramaticer_session` cookie（`HttpOnly; SameSite=Strict; Path=/`，内存会话表）。除 `/api/health` 与 `/api/login` 外全部要求会话；非读取方法校验 `Origin` 的 host 与请求 `Host` 一致，缺少 `Origin` 的命令行请求放行。
  - 请求与错误：JSON 请求体上限 25 MB（`MAX_JSON_BODY_BYTES`），超限部分不保留在内存，读完再返回 413；所有错误都是 `{error:{code,message,details?}}`；日志只有方法、路径、状态与耗时。
  - 静态资源：`--web` 目录按扩展名给 MIME；先 realpath 再做目录包含判断，拒绝编码后的 `..`、反斜杠、NUL 与逃出目录的符号链接；找不到文件时回退 `index.html`。web 目录不存在时 API 外的请求返回 404。
  - `startServer` 打开 `StoryStore`，健康检查返回核心版本与 `schemaVersion`；`close()` 先关闭 HTTP 连接再关闭数据库。
  - 新增 `packages/server/test` 的 21 个测试（参数解析与回环判定、密码与 cookie、Origin、413、静态 MIME 与回退、路径穿越与符号链接、日志脱敏）。CLI 冒烟确认回环启动、健康检查 200、无密码时登录 400、静态 index 200，以及 `--host 0.0.0.0` 无密码时退出码 1。
  - 门禁通过：606 个测试（新增 21 个）。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T04 完成；M4-T05 待做。
- 数据库 schema 版本 17。
- `packages/server` 已经有请求处理骨架：`src/server.ts` 的 `startServer` 返回 `{origin, store, close}`，`src/http.ts` 提供 `HttpError`、`sendJson`、`sendError`、`readJsonBody`，`src/auth.ts` 提供会话与 Origin 判断，`src/static-files.ts` 提供静态资源解析与发送。`--channels` 已经解析并保存，路由还没使用它。
- `packages/server` 的依赖是 `@dramaticer/core` 与 `@dramaticer/protocol`；M4-T05 导入接口需要再加 `@dramaticer/st-compat`（工作区依赖，不需要登记）。
- `packages/web` 尚未创建；`packages/web/dist` 不存在时 server 的静态请求返回 404 JSON。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；不要引用事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实，留给 M4-T20 的 50 轮试玩。
- 兼容线 C-T00 排在 M4 之后，与 M4 的沙箱渲染器衔接。

## 下一步
- **M4-T05 server 故事、导入与设置接口**，依赖 M4-T04、M4-T02，可以直接执行。
  - 故事：`GET/POST /api/stories`、`GET/PATCH /api/stories/:id`；导入 `POST /api/stories/:id/import`（角色卡 PNG base64 或 JSON，可选世界书；走 st-compat 的解析与导入，重复导入只补缺失内容）。
  - 设置与模板：`GET/PUT /api/stories/:id/settings`、模板 CRUD；删除仍被引用的模板 409；非法输入 400 带字段路径，未知故事 404。
  - 在 `src/server.ts` 的路由里注册；复用 `HttpError`、`readJsonBody`、`hasSession` 的判断方式。响应类型从 `@dramaticer/protocol` 取，需要新类型时先加在 protocol。
- 之后按 TASKS 顺序：M4-T06 server 运行时与 SSE 对话（用 `generateAssistantTurn` 与 `regenerateAssistantTurn`）。

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
