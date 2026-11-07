# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：73
- 任务：R0-T01 合并 v2 设计提案
- 结果：完成（`DONE`），只改文档，门禁通过。
  - `docs/dev/DECISIONS.md` 新增 ADR-0033：采纳 `docs/proposals/v2.md`，记录三个根本问题（90 个生成楼层里 `plot_note` 为 0；Director 重复度 0.0915 对 0.0940；事件表未建立、融合 @5 低于 BM25）、两项回合模式、台账与结算器、记忆分层、Director v2、评测基线 B0/B1/B2 与门槛规则、R1–R7 路线图，以及 M3/M2 旧的实现保留到对应阶段替换。
  - `docs/DESIGN.md` 升为 v0.2：§0 与 §3 改为台账优先、间隙算力与双模式原则；§4 的架构图改为 mermaid；§5 把 `state_diffs` 改为 `ledger_diffs` 并加入楼层摘要与 MVU 命名空间；§6 增加“结构化不是义务”；§7 改为台账（九个命名空间）、结算器与记忆分层（现场、楼层摘要、八段式压缩、主线、事件索引、原作资料包、玩家画像、世界书预筛）；§8 改为 Director v2 长线层与短线层、落拍与候选行动；§9 加入写作契约与预算取舍顺序；§10 改为快回合与深回合、文本协议兜底；§11 改为工具与结算；§14 改为矛盾率、对比胜率、重复度与推进度、首字延迟、深回合增益，基线 B0/B1/B2 与“没赢就改、最多三轮”的门槛；§15 改为 R1–R7；§16 与 §17 同步；附录 A 增加 Q29–Q36。
  - `docs/dev/TASKS.md`：M4 只保留已完成的 T00–T06，并标注 T07 起并入 R5；新增 R0（迁移）、R1（世界模型）、R2（评测底座）、R3（双模式回合）、R4（Director v2）、R5（能玩的界面）、R6（效果门槛）、R7（之后）。R1 细化为 T01 台账结构与 MVU 映射、T02 结算器、T03 批量事件抽取、T04.a 管线与断点续跑、T04.b 事件表回填与记忆评测重跑、T05 八段式压缩、T06 世界书预筛、T07 用户意志捕获、T99；R2 细化为 B0、回放驱动与试玩命令行、一致性探针、盲测两两对比、B1 历史回放、记分牌、T99。M4-T07 至 M4-T20 与 M4-T99 按原内容移入 R5-T01 至 R5-T14 与 R5-T99，并补上快深开关、台账面板与 Director v2 面板。
  - INBOX 的 v2 条目移入“已处理”。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T06、R0-T01 完成；R1-T01 待做。
- 数据库 schema 版本 17。
- `packages/core` 的现有模块（楼层树、快照、后台任务、事件、摘要、笔记、检索、Director v1、上下文组装、执行器）全部保留；v2 的台账、结算器、八段式压缩、世界书预筛与用户意志在 R1 新增或替换，届时删除被取代的实现与测试。
- `packages/server` 已提供故事、导入、设置、模板、SSE 回合与后台运行时缓存；R5 再补后台调度、分支与面板接口。
- `packages/protocol` 已提供 HTTP 与 SSE 类型；`packages/web` 尚未创建。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；R1 负责批量回填。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。

## 下一步
- **R1-T01 台账结构与 MVU 映射**：
  - 在 core 定义九个台账命名空间与 `validateLedgerDiff`，用现有 `StateDiff.path` 表达，不新增存储。
  - `readLedger(store, nodeId, prefix?)` 读快照子树；`listLedgerEntities` 列出人物、关系与未兑现线索。
  - st-compat 导入 MVU 快照时把路径改成 `["mvu", ...]`；评测数据库由 raw 重建，不迁移旧库。
  - 测试覆盖九个命名空间、非法路径与值、MVU 回放一致、分支隔离。
- 之后按 TASKS 顺序：R1-T02 结算器（迁移 v18 `ledger_settlements`）、R1-T03 批量事件抽取、R1-T04.a/.b 回填与记忆评测重跑、R1-T05 八段式压缩（v19）、R1-T06 世界书预筛（v20）、R1-T07 用户意志、R1-T99。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。v2 的不变量已由人类改好：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请。
- 服务端启动时提供 `channels` 就会加载渠道配置；配置缺失或环境变量没设置会让启动失败，这是有意的快速失败。测试里通过 `channels.load` 与 `createClient` 注入假客户端。
- SSE 测试的临时目录用 `packages/server/test/.tmp-server-*`，已忽略；假渠道的 baseUrl 用 `127.0.0.1`，I10 允许。
- 中止保存的部分正文会写 Trace，`stopReason` 为 `aborted`，`usage` 全为 `null`；不要把它当成正常完成。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟。R1 的批量窗口应显著减少请求数，仍然不要在单个会话里等待整轮回填跑完；用 `--resume` 与缓存续跑。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- `director-eval` 的 `workDir` 默认在 `eval-private/memory-cache/tmp/director-eval`，结束时整目录删除；主模型回复缓存关闭，embedding 内容缓存保留。
- 状态题 JSONL 必须带 `path`（非空字符串数组）；事件题不要带这个字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。`director-eval` 的统计版只用“对话 N”，不写实际故事 id。
- 参照报告默认读取 `eval-private/reports/reference-cosine.json` 里的余弦校准；更换 embedding 模型或维度后要重新运行 `reference:cosine`。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`；新增工作区包后需要 `--no-frozen-lockfile` 更新锁文件。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。R4 替换 Director v1 时删除被取代的机制与断言，不保留两套。
- 函数调用模式的读取工具列表会随 `READ_TOOLS` 变化；测试不要断言完整列表，只断言写入工具在前、包含用到的读取工具。
- Playwright 浏览器与 `pnpm e2e` 不进入 `pnpm check`；端到端失败产物写 `.devloop/scratch/e2e/`。
- 故事设置的更新时间由存储层用 `new Date().toISOString()` 写入；测试不要断言具体时间值。
- 导入接口的角色卡图片与 JSON 都在请求体内，25 MB 上限覆盖；PNG base64 目前只接受无前缀的 base64，测试里用 `node:zlib` 构造最小 PNG。
- 任务编号映射：M4-T07→R5-T01、T08→R5-T02、T09→R5-T03、T10→R5-T04、T11→R5-T05、T12→R5-T06、T13→R5-T07、T14→R5-T08、T15→R5-T09、T16→R5-T10、T17→R5-T11、T18→R5-T12、T19→R5-T13、T20→R5-T14、T99→R5-T99。
