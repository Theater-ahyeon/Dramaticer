# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：61
- 任务：M3-T05 NPC 议程后台任务
- 结果：完成（`DONE`）。
  - core 新增 `memory/npc-agenda.ts`：`NPC_AGENDA_JOB_KIND`、`parseNpcAgendaProgress`、`createNpcAgendaHandler`。章节边界沿用章节摘要的判定（当前路径已确认助手楼层数是 `chapterSize` 的整数倍，默认 20）；没有议程、没有到期议程、或同一楼层已经推进过时都不调用模型。
  - 到期判定：章序号从 1 开始，`chapterNumber % everyChapters === 0` 且 `lastAdvancedNodeId !== job.nodeId`。输入只包含到期议程；章节内容优先取终点正好是当前楼层的章节摘要，没有时取上一章节终点之后的楼层原文（与章节摘要窗口一致）。
  - 输出严格校验：JSON 数组，每项只有 `npc` 与 `progress`，都必须是非空字符串；按规范化名称/别名匹配议程，缺项、陌生名称、空进度、重复名称整批抛错，由后台框架按 M2-T03 重试。
  - `StoryStore` 新增 `advanceNpcAgendas({storyId, nodeId, advances})`：一个事务里更新 `progress` 与 `last_advanced_node_id`，并写入 `与此同时：<progress>` 的 `memory_events`（参与者与知情者都是 NPC 名称，importance 取议程配置，ordinal 接在该楼层已有事件之后）。非法条目整批回滚。
  - 迁移 v16 给 `memory_events` 增加 `source`（默认 `events`，NPC 议程写 `npc_agenda`）；`MemoryEvent`/`NewMemoryEventInput` 增加 `source`，`countEventsForNode(nodeId, source?)` 可按来源过滤。事件抽取的重复执行判定改为只看 `events` 来源，避免议程事件让抽取误判为已完成。
  - `memory/json-output.ts`（`parseJsonOutputArray`）与 `memory/window.ts`（`formatFloors`）抽出共用实现，事件抽取与章节摘要改为复用；`dramaticer work` 默认注册 `npc_agenda`。
  - 测试：新增 `packages/core/test/npc-agenda.test.ts`（11）与 `work-cli.test.ts` 的默认注册表用例（1）；门禁 `pnpm check` 通过（67 个测试文件、543 个测试）。

## 当前状态
- M0、M1、M2、D-T01 至 D-T04、M3-T00 至 M3-T05 完成。
- 门禁：`pnpm check` 通过（543 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 16。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。

## 下一步
- **M3-T06**（下一个会话）：重复检测（embedding 版）。`StoryStore` 增加 `listChunkVectorsForNode(nodeId)`；节拍取已确认助手楼层，楼层向量为块向量平均值；相邻节拍余弦，窗口与上升规则复用 `health/duplication.ts`，阈值取 ADR-0025（窗口 20、步长 10、`riseWindows` 5、`riseDelta` 0.02、`riseMinimum` 0.03、绝对阈值 P99 = 0.73）；场景序列从可配置 `scenePath` 取状态值，取不到时用最近事件 `location`，连续同场景超过 `sceneRepeatThreshold`（默认 7）触发；两类信号只输出一条；不调用 LLM，缺失向量跳过并在信号里计数。
- 然后依次 M3-T07（节奏状态机）→ M3-T08（开启与关闭导演的对比回放）。
- ADR-0025 里有现成的参照基线数字，M3-T06/T07 直接读它，不要重新从对话语料推导阈值。

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
