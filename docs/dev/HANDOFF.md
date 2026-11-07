# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：80
- 任务：F0-T02.a 语料节奏与回复构成统计并入脚本
- 结果：完成（`DONE`），门禁通过（669 个测试，3 个 live 跳过）。
  - 新增 `scripts/f0-composition.mjs`：楼层深度分桶、会话段判定、生成耗时有效性、按类别统计开标签、标签名发现与块类型注册表、代码围栏字符数、回复构成（标签块 / 代码围栏 / 叙事正文）、编辑分类。`scripts/f0-composition.test.mjs` 20 个测试。
  - `scripts/f0-corpus.mjs` 增加两次扫描：先发现语料里出现至少 5 次的无属性开标签，建立 core 块解析器的注册表，再逐对话统计。报告新增六节：节奏与时间、重 roll 与楼层深度、回复构成、结构化块使用、生态功能覆盖、编辑信号，另加“与方案评审提案统计的差异”。
  - 关键数字（265 个去重对话、5,633 层）：生成耗时 P50 50 秒、P90 121.7；首字延迟 P50 4.5、P90 18；玩家思考间隙 P50 102.9、P90 409.2；重 roll 率 1–10 楼 24.9%、11–50 楼 9.3%；以重 roll 的助手回复结束的短对话 62/180（34.4%）。助手回复 token P50 2,338，第 50 楼以后 P50 2,528；玩家输入 P50 13。标签块与代码块字符占比合计 25.2%（P25/P50 都是 0%）。开标签：分析与摘要 2,739、变量更新 2,636、图片 2,615、选项 1,965、表格 1,572。生态：生图元数据 227/265、定时世界书 244、作者注释 259、变量插件 150、表格元数据 119；楼层级表格 1,784、剧情规划 759、EJS 标记 3,509、思考签名 2,512。编辑：405 层与 `swipes[swipe_id]` 不同（14.1%），只改标签块 155、正文大改 225、少量手改 11。
  - 与提案 0.1–0.6 的差异写在报告末尾：间隙口径、标签块占比（本文只用闭合的无属性标签块，带属性 HTML 按正文计，不能和提案的 65% 直接比较）、表格与工具调用的楼层口径、编辑分类门槛、对话规模 1–8 个。
  - 会话期间分拣 INBOX 的方案评审提案：新增 ADR-0041，A1 落成 F0-T02.a 与 F0-T02.b，A2–A10 改到 R1、R2、R3-T00 与 C-T01–C-T05，A11 的 DESIGN 取代标注已加、TASKS 归档落成 R0-T05，B 的路线顺序写进 F0-T100。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T06、R0-T01 至 R0-T03、R1-T01、R1-T01.a、F0-T01、F0-T02、F0-T02.a 完成。
- 人类已确认两条路线变更：ADR-0039（新增 F0-T100，F0-T99 不再请人类决定，人类试玩改为自动试玩加评测）与 ADR-0038（四个 ST 兼容插件取代兼容线 C-T00，落为 C-T01–C-T05）；ADR-0040 的共存规则写入 C-T01–C-T05 验收；ADR-0041 合并方案评审提案 A1–A11。
- TASKS 顶部的「F：取证」排在 R1 之前，F0 完成前不选 R1 及之后的任务；ADR-0037 记录插队、独立产品形态与固定模型。F0 全部模型调用用 magpie 网关（`http://127.0.0.1:3425/v1`）的 DeepSeek V4.1 Flash；三个 ST 数据目录的只读扫描已获授权。
- 数据库 schema 版本 18。迁移编号（ADR-0041 后）：v19 结算记录（R1-T02）、v20 实体候选与结算置信度（R1-T02）、v21 现场分析（R1-T02.a）、v22 父子分块（R1-T03.a）、v23 章节压缩（R1-T05）、v24 世界书预筛（R1-T06）、v25 变更卡（R1-T07.a）、v26 上下文包（R1-T08）。在已排定的任务之间插入新迁移时，后续编号要一起顺延。
- 台账只有结构与读取，**没有写入校验的强制点**：`appendStateDiffs` 不调用 `validateLedgerDiff`；R1-T02 的结算器负责在写入前校验（I12）。现有结构化输出 `state_update` 仍可写任意路径，来源记为 `model`。
- `readLedgerFacts` 不读取快照缓存，按 `getStateDiffsAlongPath` 回放，返回顺序是路径上首次出现的顺序。
- 已注册的槽位是九个（`packages/core/src/context/template.ts` 的 `CONTEXT_SLOT_NAMES`：lore、character、persona、summary、state、memory、history、director、protocol）；DESIGN §9 里的 `ledger` 对应实现的 `state`，`beat` 尚未注册。R1-T02.a 要新增 `scene` 槽位，R2-T01 的朴素模式要排除它。R1-T02 新增的 `block_format` 是模板里的可选静态段，不是槽位。
- `packages/server` 已提供故事、导入、设置、模板、SSE 回合与后台运行时缓存；`packages/protocol` 已提供 HTTP 与 SSE 类型；`packages/web` 尚未创建。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024（R1-T01.c 改为 4096 与渠道声明取小）、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；R1-T03 改为批量窗口后由 R1-T04.a/.b 回填。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。

## 下一步
- **F0-T02.b 按楼层深度分层补样并补齐归因**：在现有 200 对基础上按 1–10 楼、11–50 楼、51 楼以上各约 67 对补样（某层不足时全取），对新增配对跑归因，报告按层给出主因分布，并单列“最后一楼被重 roll 后对话结束”的子集。上一轮的 200 对与归因结果在 `eval-private/f0/pairs.jsonl` 与 `attribution.jsonl`，按 pair id 续跑。
- 之后 F0-T03 裁判校准（约 400 次调用）：**先把门槛写进 `docs/dev/reports/F0.md`**（交换顺序后一致率 ≥ 65%、位置偏差 ≤ 10 个百分点），再运行；结论注明同模型自评。
- 再之后 F0-T04 全文基线（全文 token 先剔除标签块再估算，含标签与不含标签两个口径）、F0-T99 报告与路线建议、F0-T100 写 v3 并改写路线（ADR-0039，不再请人类决定；阶段顺序按 v3-review 第三节，已写入任务）。
- F0-T100 合并 v3 之后，先做 **R0-T04 合并 v3 插件系统提案**（`docs/proposals/plugins.md`），再按新路线继续；**兼容插件线 C-T01–C-T05 排在插件内核改造 P2 之后**。R0-T05（归档已完成任务）随时可以插入。
- V3 路线确认之前仍按 TASKS 的 R1 顺序执行：R1-T01.b 渠道按岗位配置（比较模型家族）、R1-T01.c 生成长度默认值、R1-T02 台账结算器（v19/v20）、R1-T02.a 现场分析（v21）、R1-T03 批量事件抽取、R1-T03.a 父子分块（v22）、R1-T03.b 重排序、R1-T04.a/.b 回填与记忆评测、R1-T05 八段式压缩（v23）、R1-T06 世界书预筛（v24）、R1-T07 用户意志、R1-T07.a 自然语言修订记忆（v25）、R1-T07.b `gap_pass`（间隙合并调用）、R1-T08 上下文包复用（v26）、R1-T99；再到 R2、E-T01、X1/X2、R3、R4、R5、H-T00、R6、R7。
- E-T01（`dramaticer explain`）排在 R2-T99 之后；H-T00（应用内助手）排在 R5-T99 之后并取代原 R7 的侧边 agent。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包、ST 语义只在兼容插件里实现。
- `pnpm f0:corpus` 需要 `DRAMATICER_ST_ROOTS`（Windows 上用分号分隔三个 ST 数据目录），并保证 `packages/core/dist` 已构建；脚本会覆盖 `docs/dev/reports/F0-corpus.md` 与 `eval-private/reports/f0-corpus-map.json`。脚本先扫一遍语料发现标签名再统计，全程约 6 秒。
- F0-corpus 的标签块占比是保守口径：只用闭合的无属性标签块，带属性的 HTML 按正文计，中位数 0%、合计 25.2%。**不要把它当成“历史里 2/3 是标签块”的证据**；F0-T99 若要引用标签占比，必须同时写明口径，或另做带属性标签的统计。
- 玩家思考间隙只统计相邻助手→用户对，间隔上限 30 分钟；生成耗时丢弃负值与超过 24 小时的值。
- 编辑分类的门槛是公共前缀 ≥ 80% 且长度差 ≤ 120 字符；`只改标签块` 包含状态栏与变量块被整体改写的情况。
- `pnpm f0:attribution` 需要先 `pnpm run typecheck` 构建 core 与 st-compat 的 `dist`，并读取 `eval-private/reports/f0-corpus-map.json`（由 `pnpm f0:corpus` 生成）。环境变量：`DRAMATICER_F0_PAIRS` 默认 200，`DRAMATICER_F0_CONCURRENCY` 默认 4，`DRAMATICER_F0_MAX_TOKENS` 默认 2500；归因模型输出为空或 `stopReason` 为 `length` 时用至少 4096 重试一次。结果按 pair id 续跑；router 缓存目录是 `eval-private/f0/llm-cache`。
- 归因输出必须原样使用固定类别；模型写成「前后矛盾」会被拒绝并计入失败，不要放宽校验。3 个失败配对的明细在 `eval-private/f0/attribution.jsonl`。
- 统计对话时按文件名去重，同名副本保留目录顺序靠前的那份（TauriTavern → data → luker）；报告只允许出现「对话 N」与数字，写完后用映射文件反向核对是否泄漏目录名。
- `parseChatJsonl` 默认在 `swipe_id` 越界或非整数时抛错（导入语义）；只读分析用 `{ strictSwipeId: false }`。不要把这个选项用在导入路径上。
- 服务端启动时提供 `channels` 就会加载渠道配置；配置缺失或环境变量没设置会让启动失败，这是有意的快速失败。测试里通过 `channels.load` 与 `createClient` 注入假客户端。
- SSE 测试的临时目录用 `packages/server/test/.tmp-server-*`，已忽略；假渠道的 baseUrl 用 `127.0.0.1`，I10 允许。
- 中止保存的部分正文会写 Trace，`stopReason` 为 `aborted`，`usage` 全为 `null`；不要把它当成正常完成。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟。R1-T03 的批量窗口应显著减少请求数；不要在单个会话里等待整轮回填跑完，用 `--resume` 与缓存续跑。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- `director-eval` 的 `workDir` 默认在 `eval-private/memory-cache/tmp/director-eval`，结束时整目录删除；主模型回复缓存关闭，embedding 内容缓存保留。
- 状态题 JSONL 的 `path` 是 MVU 原始快照里的路径（可能以 `stat_data` 开头）；用 store 核对应读 `mvu` 子树（`mvuSnapshotAt`）。事件题不要带 `path` 字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。`director-eval` 的统计版只用“对话 N”，不写实际故事 id。
- 参照报告默认读取 `eval-private/reports/reference-cosine.json` 里的余弦校准；更换 embedding 模型或维度后要重新运行 `reference:cosine`。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、`eval-private/f0/`、临时数据库、`eval-private/raw/`、`eval-private/reference/`、`eval-private/st-sandbox/` 加进提交。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`；新增工作区包后需要 `--no-frozen-lockfile` 更新锁文件。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。`reasoning:"low"` 时 2500 输出 token 仍可能被思考占满，归因脚本的 4096 重试就是为此。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。R4 替换 Director v1 时删除被取代的机制与断言，不保留两套。
- 函数调用模式的读取工具列表会随 `READ_TOOLS` 变化；测试不要断言完整列表，只断言写入工具在前、包含用到的读取工具。
- Playwright 浏览器与 `pnpm e2e` 不进入 `pnpm check`；端到端失败产物写 `.devloop/scratch/e2e/`。
- 故事设置的更新时间由存储层用 `new Date().toISOString()` 写入；测试不要断言具体时间值。
- 导入接口的角色卡图片与 JSON 都在请求体内，25 MB 上限覆盖；PNG base64 目前只接受无前缀的 base64，测试里用 `node:zlib` 构造最小 PNG。
- `packages/st-compat` 的测试通过 workspace 依赖解析到 `packages/core/dist`；改了 core 的公开代码后先 `pnpm run typecheck` 或 `pnpm --filter @dramaticer/core build`，再单独跑 st-compat 测试。`pnpm check` 会先构建。
- 任务编号映射：M4-T07→R5-T01、T08→R5-T02、T09→R5-T03、T10→R5-T04、T11→R5-T05、T12→R5-T06、T13→R5-T07、T14→R5-T08、T15→R5-T09、T16→R5-T10、T17→R5-T11、T18→R5-T12、T19→R5-T13、T20→R5-T14、T99→R5-T99。
