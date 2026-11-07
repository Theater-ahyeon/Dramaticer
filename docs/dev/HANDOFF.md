# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：65
- 任务：M3-T99 M3 验收
- 结果：完成（`MILESTONE_DONE`）。
  - `pnpm check` 通过：invariants、`tsc -b`、biome 217 个文件、vitest 70 个测试文件 / 567 个测试通过，3 个 live 测试跳过。
  - live 测试通过：`DRAMATICER_LIVE=1 pnpm test`，73 个测试文件 / 570 个测试，包含 bge-m3 1024 维、渠道体检与真实渠道 3 轮对话。
  - M3-T01 至 M3-T08 逐条核对，交付物、迁移版本（v13 至 v16）与测试文件齐全。
  - I1–I10 逐条审查通过。I6：`runChatTurn` 只调用一次 `runModelTurns`，`MAX_TOOL_ROUNDS = 2`；导演槽位在组装阶段同步执行，`packages/core/src/director` 没有 LLM 或网络调用；NPC 议程只由 `dramaticer work` 调用后台模型。I7：`pi-agent-core` 只出现在根目录 `spikes/`。I9：`evaluateDirector` 与全部机制是同步纯程序，`signals` 记录判定依据。
  - M3-T08 门槛按统计版报告核对：相邻块 Jaccard 均值开启 0.0915、关闭 0.0940；节拍余弦均值开启 0.9018、关闭 0.9053。分对话方向不一致（Jaccard 只有 1/3 个对话有利，余弦 2/3 个对话有利但差值不超过 0.0262），中位数与 P95/P99 没有一致方向。重复度“显著低于”判定为未证实。
  - 90 个生成楼层里模型没有输出 `plot_note`，新建与兑现都是 0，线索回收率判定为无法比较；不能把空样本当作 0%。
  - 二进制验收项通过：关闭导演 0 决策记录、0 导演消息；开启时 pacing 触发 9 次、选中 9 次；18 次回放全部成功。事件池、线索追踪与重复检测在真实回放中没有触发（种子库无事件表、legacy 卡无扩展事件、生成内容未命中重复窗口）。
  - 结论写入 `docs/dev/reports/M3.md`；ADR-0029 记录两项效果目标保留为未证实，M4 自动试玩报告增加 Director 机制命中、节奏阶段分布、线索新建与兑现数、兑现率与兑现平均年龄。
  - M4-T00 的条目确认可用，报告字段按 ADR-0029 扩展。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04 全部完成；M4-T00 待做。
- 门禁：`pnpm check` 通过（567 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 16。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的效果缺口留给 M4 的 50 轮自动试玩；M3 不追加调参。

## 下一步
- **M4-T00**：细化 M4。依赖无，可以直接执行。
  - 粗粒度条目：server（HTTP 加 SSE，默认只监听 127.0.0.1，局域网模式必须设密码）；web（移动端优先：聊天、分支、预设与模板编辑器、记忆面板、状态面板、导演面板、Trace 面板、渠道管理）；沙箱 iframe 渲染器；写入工具与读取工具接入主循环。
  - 试玩验收按 ADR-0028：Playwright 端到端加 LLM 模拟用户至少 50 轮，产出私有报告与统计版报告，作者看统计版确认；不新增 HUMAN 阻塞项。
  - 统计版报告按 ADR-0029 增加 Director 机制命中次数、节奏阶段分布、新建与兑现的剧情笔记数、线索兑现率与兑现平均年龄。
  - 细化时按一个会话一个可验证任务的粒度写进 TASKS.md，先做 `M4-T00.a`。

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
