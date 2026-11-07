# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：66
- 任务：M4-T00 细化 M4 任务
- 结果：完成（`DONE`）。
  - 把 M4 细化为 M4-T01 至 M4-T20 与 M4-T99，依赖关系与验收标准写入 `TASKS.md`。
  - ADR-0030 记录 server 与 web 的边界：`packages/protocol` 共享类型、server 使用 `node:http`、迁移 v17 的 `story_settings` 与 `context_templates`、重新生成的生成入口、渠道脱敏与原子写回、后台任务调度、Playwright 假渠道与真实试玩分离。
  - 读取工具与 `state_update`、`plot_note` 已在 M2-T14 与 M2-T07 接入主循环；M4 改为端到端核对，`illustrate` 留到 M6；ST 预设转换留在兼容线。
  - 兼容线段按 DESIGN §15 的表格移到 M4 之后；C-T00 仍待做，不阻塞 M4。
  - 门禁通过：invariants、`tsc -b`、biome、vitest 567 个测试；本次只改文档。

## 当前状态
- M0、M1、M2、M3 与 D-T01 至 D-T04 完成；M4-T00 完成，M4-T01 待做。
- 数据库 schema 版本 16；M4-T02 将升到 17。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；不要引用事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实，留给 M4-T20 的 50 轮试玩。
- 兼容线 C-T00 排在 M4 之后，与 M4 的沙箱渲染器衔接。

## 下一步
- **M4-T01 共享 API 类型包**，依赖无，可以直接执行。
  - 新增 `packages/protocol`（`@dramaticer/protocol`），只放 HTTP 与 SSE 的类型和常量：故事、楼层、路径、树、设置、模板、Trace、状态快照、事件、摘要、剧情笔记、导演决策、实体、lore、渠道脱敏视图、错误包装、SSE 事件联合类型与事件名。
  - 领域类型从 `@dramaticer/core` 只用 `import type` 引用，编译结果不包含 core 的运行时代码；根 `tsconfig.json` 增加项目引用。
  - 验收：`pnpm check` 通过；`packages/protocol/dist` 里没有 core 的运行时 import。
- 之后按 TASKS 顺序：M4-T02 故事设置与模板持久化（迁移 v17）、M4-T03 重新生成助手楼层、M4-T04 server 骨架与认证。

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
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。
- M4 新增 `packages/protocol`、`packages/server`、`packages/web`；server 使用 `node:http`，默认只监听 127.0.0.1，绑定非回环地址必须设置 `DRAMATICER_SERVER_PASSWORD`。
- Playwright 浏览器与 `pnpm e2e` 不进入 `pnpm check`；端到端失败产物写 `.devloop/scratch/e2e/`。
