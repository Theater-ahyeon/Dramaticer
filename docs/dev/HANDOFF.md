# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：57
- 任务：M3-T01 Director 决策框架与线索追踪
- 结果：完成（`DONE`）。
  - 迁移 v13 新增 `director_decisions(node_id PRIMARY KEY, story_id, directive, mechanisms, signals, created_at)`：每个楼层最多一行；`saveDirectorDecision` 用 upsert 覆盖旧记录；触发器拒绝跨故事的楼层/故事组合，并禁止修改 `node_id` 与 `story_id`。
  - `StoryStore` 新增 `saveDirectorDecision`、`getDirectorDecision`、`getDirectorDecisionsAlongPath`（按根到给定楼层的顺序，其他分支不参与）；读取时校验 `mechanisms` 与 `signals` 的 JSON 结构。
  - core 新增 `director/`：`DirectorConfig`（`enabled` 默认 true、`clueAgeWarning` 12、`maxOpenClues` 5，`pace` 与 `surprise` 为后续机制保留）、`DirectorSuggestion {mechanism, priority, directive, signals}`、`DirectorMechanismResult`、`DirectorMechanism {name, evaluate}`、`DirectorDecision` 与存储输入类型。
  - `evaluateDirector({store, storyId, nodeId, config, mechanisms?})` 按注册顺序评估全部机制，取优先级最高的一条建议；每次评估写入一条决策记录，没有建议时 `directive` 为 null；`enabled=false` 时不评估也不写记录；全程不调用模型。
  - 线索追踪机制只统计当前分支上的未兑现笔记，年龄等于当前位置减去来源楼层位置；最老年龄超过 `clueAgeWarning` 时给出回收建议（优先级 30），未兑现数量达到 `maxOpenClues` 时建议先回收最老一条（优先级 20）；两者同时满足只输出年龄建议；指令为单行，不带 `【导演】` 前缀，由 M3-T02 的槽位添加。
  - 决策的 `signals` 当前包含 `openClues`、`oldestAge`、`selectedNoteId`、`clueAgeWarning`、`maxOpenClues`；`mechanisms` 记录每个机制的 `name`、`triggered`、`reason`。
  - 新增 11 个测试（`packages/core/test/director.test.ts`），门禁 `pnpm check` 通过（62 个测试文件、497 个测试）。

## 当前状态
- M0、M1、M2、D-T01 至 D-T04、M3-T00、M3-T01 完成。
- 门禁：`pnpm check` 通过（497 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 13；M3 计划继续使用 v14（`event_pool`、`npc_agendas`）。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。

## 下一步
- **M3-T02**（下一个会话）：重写 `createDirectorSlotProvider`，调用 `evaluateDirector`，有建议时返回一条以 `【导演】` 开头的 system 消息，`source` 写 `director:<mechanism>`；`dramaticer chat` 增加 `--director <on|off>`（默认 on），关闭时槽位为 `missing-slot` 且没有决策记录。
- 然后按顺序执行 M3-T03（卡扩展与事件池存储）→ M3-T04（事件池选择与停滞检测）→ M3-T05（NPC 议程后台任务）→ M3-T06（重复检测，阈值见 ADR-0025）→ M3-T07（节奏状态机）→ M3-T08（开关对比评测）。
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
