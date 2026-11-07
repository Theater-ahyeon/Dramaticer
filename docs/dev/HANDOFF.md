# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：54
- 任务：M3-T00 细化 M3 任务
- 结果：完成（`DONE`）。
  - `docs/dev/TASKS.md` 的 M3 段落从一条概略条目细化为 M3-T01 至 M3-T08 与 M3-T99，每个任务都写了依赖、做什么与验收。
  - M3-T01 `director_decisions`（迁移 v13）与纯程序决策框架：线索追踪读取当前分支的未兑现剧情笔记，按年龄与数量给出回收建议；启用时每次评估写一条记录（没有建议时 `directive` 为 null）。决策记录同时供 T04 冷却、T07 阶段恢复与 T08 回放读取。
  - M3-T02 导演槽位与 `dramaticer chat --director <on|off>`；后续机制只注册到同一个评估器。
  - M3-T03 卡扩展 `extensions.dramaticer`（事件池与 NPC 议程）与迁移 v14 的 `event_pool`、`npc_agendas`；M3-T04 停滞检测与事件选择；M3-T05 NPC 议程后台任务（章节边界推进、写入“与此同时”事件）。
  - M3-T06 重复检测（节拍 embedding 与场景序列）、M3-T07 节奏状态机、M3-T08 导演开关对比评测都依赖 D-T04；D-T04 仍被 HUMAN-07 阻塞，所以这三个任务排在后面。
  - 本次只改文档，没有改代码；门禁 `pnpm check` 通过（478 个测试，3 个 live 跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T15 完成；M2-T99 被 HUMAN-08 阻塞。D-T01、D-T02、D-T03 完成，D-T04 被 HUMAN-07 阻塞。
- M3 已细化：M3-T01 至 M3-T05 不依赖 D-T04，可以立即执行；M3-T06 至 M3-T08 依赖 D-T04；M3-T99 依赖 M3 全部任务。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 12；M3 计划使用 v13（`director_decisions`）与 v14（`event_pool`、`npc_agendas`）。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/evalset/summary.json` 包含 7 个对话的生成记录（337 道题，其中 1 个对话跳过）。
- HUMAN-07 待处理：把参照小说按 UTF-8 `.txt`/`.md` 每行一段放进 `eval-private/reference/`；这一步解除后才能执行 D-T04，之后才能执行 M3-T06 至 M3-T08。
- HUMAN-08 待人类确认：状态题是继续要求文本召回 45%，还是改用状态层答案正确率。确认前不要执行 M2-T99。
- 参照脚本已可用；`eval-private/reference/` 目前为空，报告里的私有作品数为 0。

## 下一步
- M3-T01 可做：先完成决策框架、迁移 v13 与线索追踪，再按 T02、T03、T04、T05 的顺序推进。
- D-T04 在 HUMAN-07 解除后执行：对 `eval-private/reference/` 运行 `pnpm --filter @dramaticer/st-compat reference`，用分布给出 Director 阈值并写 ADR；然后执行 M3-T06、M3-T07、M3-T08。
- HUMAN-08 解除后执行 M2-T99（口径见 ADR-0023）。
- 事件题在新增语料上尚未生成；体检报告给出的是窗口请求估算，实际出题需要调用后台渠道，不要在一个会话里等待跑完。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文，写入前先检查。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对，或直接用脚本里的同一套引用匹配规则。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
