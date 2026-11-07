# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：58
- 任务：M3-T02 导演槽位与用户控制
- 结果：完成（`DONE`）。
  - `createDirectorSlotProvider(store, options)` 重写：接收 `{config?, mechanisms?}`，内部只调用 `evaluateDirector`；有建议时返回恰好一条以 `【导演】` 开头的 system 消息，`source` 为 `director:<mechanism>`；没有建议或 `enabled` 为 false 时返回 null，由组装器记为 `missing-slot`。
  - 评估发生在组装上下文的槽位阶段，节点取 `request.nodeId`（`runChatTurn` 里是刚追加的用户楼层）；开启时每次组装写一条 `director_decisions`，关闭时既不评估也不写记录。后续机制通过 `mechanisms` 注入同一个评估器。
  - `dramaticer chat` 新增 `--director <on|off>`（默认 on）：`parseDirector` 只接受这两个值，其他值抛错并带用法；`DirectorConfig` 由 `DEFAULT_DIRECTOR_CONFIG` 展开并只覆盖 `enabled`。
  - 测试：`packages/core/test/lore.test.ts` 的导演 provider 用例改为 4 条（到期出消息并写决策、未到阈值返回 null 但写空指令记录、关闭返回 null 且无记录、其他分支笔记不参与）；`packages/st-compat/test/chat-cli.test.ts` 新增 2 条（默认开启时线索到期进上下文并写决策、`--director off` 为 `missing-slot` 且无记录）并在参数错误用例里加了非法取值；门禁 `pnpm check` 通过（62 个测试文件、500 个测试）。

## 当前状态
- M0、M1、M2、D-T01 至 D-T04、M3-T00 至 M3-T02 完成。
- 门禁：`pnpm check` 通过（500 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 13；M3 计划继续使用 v14（`event_pool`、`npc_agendas`）。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。

## 下一步
- **M3-T03**（下一个会话）：core 定义 `DramaticerCardExtension`（`events`、`npcAgendas`）与严格校验的 `parseDramaticerCardExtension`；迁移 v14 新增 `event_pool` 与 `npc_agendas`；`StoryStore` 增加 `upsertEventPool`、`listEventPool`、`upsertNpcAgendas`、`listNpcAgendas`；st-compat 新增 `importDramaticerExtension`，角色卡导入后调用。
- 然后按顺序执行 M3-T04（事件池选择与停滞检测）→ M3-T05（NPC 议程后台任务）→ M3-T06（重复检测，阈值见 ADR-0025）→ M3-T07（节奏状态机）→ M3-T08（开关对比评测）。
- 参照基线数字已经就位，M3-T06/T07 直接读 ADR-0025，不要重新从对话语料推导阈值。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- 状态题 JSONL 必须带 `path`（非空字符串数组）；事件题不要带这个字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。
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
