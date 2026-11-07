# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：68
- 任务：M4-T02 故事运行配置与模板持久化
- 结果：完成（`DONE`）。
  - 迁移 v17：`story_settings`（每个故事一行，`template_id` 可空）与 `context_templates`（`name` 唯一）。
  - `packages/core/src/store/settings.ts`：`StorySettings`、`StorySettingsUpdate`、`ContextTemplateRecord`、创建与更新输入、默认值、校验函数。
  - `StoryStore`：`getStorySettings`（缺失返回默认值，不写库）、`updateStorySettings`（合并更新，`null` 清空）、`createContextTemplate`、`getContextTemplate`、`listContextTemplates`、`updateContextTemplate`、`deleteContextTemplate`。校验枚举、数值范围、模板结构（至少一个片段）、`director_config` 与未知字段；`template_id` 可以指向内置模板 id，被故事引用的模板拒绝删除。
  - core 新增 `createCharacterSlotProvider` 与 `createStandardChatProviders`；`DEFAULT_CONTEXT_TEMPLATE_ID` 移到 `context/template.ts`；`assertDirectorConfig` 从 `director/evaluate.ts` 导出。
  - st-compat：`importCardContent` 返回 `{characterPrompt, cardName}`；`createChatProviders` 委托 `createStandardChatProviders`；`dramaticer chat` 的 `--card` 变为可选（首次运行必需），导入后把卡名与提示词写入故事设置，之后优先使用库里的提示词，故事设置里的模板优先于内置模板。
  - protocol 的 `settings.ts` 改为从 core 复用类型，字段一致。
  - 12 个新测试：6 个设置与模板存储、3 个槽位工厂、3 个 CLI（无卡运行、缺少卡报错、故事模板优先）。
  - 门禁通过：invariants、`tsc -b`、biome、vitest 582 个测试。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T02 完成；M4-T03 待做。
- 数据库 schema 版本 17。
- `packages/server` 与 `packages/web` 尚未创建。server 应依赖 core、st-compat 与 protocol；web 只依赖 protocol 与浏览器 API。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；不要引用事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实，留给 M4-T20 的 50 轮试玩。
- 兼容线 C-T00 排在 M4 之后，与 M4 的沙箱渲染器衔接。

## 下一步
- **M4-T03 重新生成助手楼层**，依赖 M1-T07、M2-T01，可以直接执行。
  - 从 `runChatTurn` 抽出 `generateAssistantTurn`：接收现有用户楼层 id，不再追加用户楼层。
  - `regenerateAssistantTurn(assistantNodeId)` 找到父用户楼层，用父楼层 raw 作为本轮输入，在父节点下新建助手兄弟节点并把 head 移过去。
  - `runChatTurn` 改为先追加用户楼层再调用 `generateAssistantTurn`。
  - 验收：兄弟节点、旧节点与旧 Trace 不变、head 正确；父节点不是用户楼层时抛错；函数调用模式仍只有一次主调用与最多 2 轮读取；状态 diff、笔记与新 Trace 写在新楼层。
- 之后按 TASKS 顺序：M4-T04 server 骨架与认证、M4-T05 故事导入与设置接口。

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
- M4 新增 `packages/server`、`packages/web`；server 使用 `node:http`，默认只监听 127.0.0.1，绑定非回环地址必须设置 `DRAMATICER_SERVER_PASSWORD`。
- Playwright 浏览器与 `pnpm e2e` 不进入 `pnpm check`；端到端失败产物写 `.devloop/scratch/e2e/`。
- 故事设置的更新时间由存储层用 `new Date().toISOString()` 写入；测试不要断言具体时间值。
