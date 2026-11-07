# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：29
- 任务：M1-T02 core/llm 接口与渠道
- 结果：完成（`DONE`）。
  - 新增 `packages/core/src/llm/`：`types.ts`（请求、流式事件、结果、用量、中止、渠道接口）、`router.ts`（按优先级切换、重试、截断续写、限速、缓存）、`pi-channel.ts`（pi-ai 适配器，支持 `openai-completions` 与 `google-generative-ai`）、`channels.ts`（YAML 解析与 `${ENV}` 引用）、`truncation.ts`、`cache.ts`、`event-stream.ts`、`configure.ts`。
  - 渠道配置：`data/channels.yaml`（被 git 忽略，本机已创建）提供 `background` 与 `main` 两个模型别名；提交 `channels.example.yaml`。密钥必须写成 `${ENV}`，缺失变量直接抛错。
  - 事件题生成器迁移到新接口；`packages/core/src/llm/client.ts` 与其 522 行测试删除；`loadDotEnv` 移到 core，并改为覆盖 `process.env` 的同名变量（`.env` 是渠道配置的唯一来源）。
  - 真实渠道（`http://127.0.0.1:3425/v1`，`opendesign/deepseek-v4.1-flash`）：流式回答 `7`，第一个正文增量 1.57 秒，用量 input 47 / output 39 / reasoning 37；中止后保留 23 字符正文与 1585 字符思考，带部分内容续写得到 2187 字符，续写轮次 2；`maxTokens: 24` 时两轮都因 `length` 结束，截断检测为 `length`。
  - 门禁 `pnpm check` 通过（31 个测试文件、241 个测试）。

## 当前状态
- M1-T02 已完成；下一会话执行 M1-T03（渠道体检）。
- 门禁：`pnpm check` 通过（241 个测试）。
- `packages/core` 的运行时依赖新增 `@earendil-works/pi-ai@1.5.0` 与 `yaml`；`pi-agent-core` 仍在根目录 devDependencies，等 M1-T06 或 M1-T07 接入工具/单轮执行器时再移动。
- 缓存格式与 M0 客户端一致：`requestCacheKey` 的请求体仍是 `{model, messages, stream:false, temperature?, max_tokens?, reasoning_effort?}`，旧缓存结构可读取。但已有 `eval-private/llm-cache` 的条目分别由 `antigravity/gemini-3.8-flash` 与 `auto/deepseek-v4.1-flash` 生成，当前 `.env` 的模型是 `opendesign/deepseek-v4.1-flash`，所以这些条目按模型不同不会命中；新请求会按当前模型写入新条目。
- 本会话验证缓存时对“仙侠雌竞”跑过 `evalset:events`，因模型不同需要真实请求，运行约 20 分钟后手动终止；事件题 JSONL 与抽查文件在整次运行结束才写出，所以没有被覆盖；已完成窗口的缓存条目保留。
- `data/channels.yaml` 本机内容是 `bg`/`main` 两个渠道和同名两个模型别名；新克隆仓库需要复制 `channels.example.yaml` 到 `data/channels.yaml`。事件题 CLI 缺这个文件会报错并提示复制。

## 下一步
- 执行 M1-T03（渠道体检）：
  - CLI 命令 `dramaticer probe <channel>`，检测真流式/假流式、函数调用、思考输出、预填充、用量与缓存统计，结果写回渠道配置。
  - 单元测试用模拟提供方；真实渠道测试放进 `*.live.test.ts`。
  - 不能依赖注入 `fetch` 抓请求地址（Google 适配器拒绝自定义 fetch，见 ADR-0009）；用 `onResponse`、错误信息或服务端日志。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`loadDotEnv` 现在会覆盖进程里已有的同名变量，这是有意行为（ADR-0010）。
- 只有 `spikes/` 下的脚本与 `packages/core/src/llm/pi-channel.ts` 直接依赖 pi 包；领域层不要出现 pi 类型（不变量 I1）。
- `data/` 被 git 忽略；不要把 `data/channels.yaml` 加进提交。`channels.example.yaml` 只放变量引用，不放密钥。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；本会话的三个脚本已经删除。
- 安装依赖时环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:7890`，该代理当前没有运行；pnpm 安装需要 `HTTP_PROXY= HTTPS_PROXY= pnpm install --no-frozen-lockfile`。
- 渠道行为（ADR-0009）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下。
