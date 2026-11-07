# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：79
- 任务：F0-T02 拒绝与接受回复对的归因
- 结果：完成（`DONE`），门禁通过（649 个测试，3 个 live 跳过）。
  - 新增 `scripts/f0-pairs.mjs`：从 ST 助手楼层抽取回复对（`swipe_id` 指向的算接受；被接受的是最后一条时取前一条，否则取后一条作为被拒绝的尝试）、按对话分层抽样、严格校验归因 JSON。新增 `scripts/f0-attribution.mjs`（根脚本 `pnpm f0:attribution`）与 `scripts/f0-pairs.test.mjs`（15 个测试）。
  - 扫描 265 个去重对话：168 个有可比较配对，384 个重 roll 楼层得到 332 个可用配对；跳过 52 个（被拒绝的 swipe 正文为空 50、缺少有效 `swipe_id` 1、两次文本相同 1）。按对话分层抽 200 对（覆盖全部 168 个对话），连同最近 8 条消息的上下文写入 `eval-private/f0/pairs.jsonl`（含原文，已被 git 忽略）。
  - 后台 DeepSeek V4.1 Flash 归因：197/200 成功，3 个失败（2 个次因写成「前后矛盾」，不在固定类别里；1 个重试后正文仍为空）。主因：不推进剧情 43（21.8%）、没听用户的指示 42（21.3%）、格式或状态栏 29（14.7%）、其他 24（12.2%）、截断 20（10.2%）、遗忘或前后矛盾 13（6.6%）、拒答或说教 10（5.1%）、文笔或文风 9（4.6%）、OOC 7（3.6%）。
  - 偏差：11 对（5.6%）被判为「另一种可行写法」；抽样里被接受的不是最后一条 swipe（玩家可能切回较早版本）占 94/200。被接受的是最后一条时主因最高项是「其他」21/105，不是最后一条时是「不推进剧情」25/92。置信度平均 0.79、P50 0.80。
  - 报告写入 `docs/dev/reports/F0.md` 的 F0-T02 章节（脚本用标记替换该章节，保留其他章节）。
  - `parseChatJsonl` / `parseChatJsonlFile` 增加 `ChatJsonlParseOptions.strictSwipeId`，默认仍然是抛错；只读分析传 `false`，把无法对应的 `swipe_id` 记为 `null`。真实语料里有 `swipes` 只有 1 条但 `swipe_id` 为 1 的楼层。
  - 会话期间分拣 INBOX 的共存规则：ADR-0040 记录七条规则，并把共存验收写进 C-T01–C-T05。

## 当前状态
- M0、M1、M2、M3、D-T01 至 D-T04、M4-T00 至 M4-T06、R0-T01 至 R0-T03、R1-T01、R1-T01.a、F0-T01、F0-T02 完成。
- 人类已确认两条路线变更：ADR-0039（新增 F0-T100，F0-T99 不再请人类决定，人类试玩改为自动试玩加评测）与 ADR-0038（四个 ST 兼容插件取代兼容线 C-T00，落为 C-T01–C-T05）；ADR-0040 把兼容插件与原生功能的共存规则落成 C-T01–C-T05 的验收标准；AGENTS.md 的 I15 不变。
- TASKS 顶部的「F：取证」排在 R1 之前，F0 完成前不选 R1 及之后的任务；ADR-0037 记录插队、独立产品形态与固定模型。F0 全部模型调用用 magpie 网关（`http://127.0.0.1:3425/v1`）的 DeepSeek V4.1 Flash；三个 ST 数据目录的只读扫描已获授权。
- 数据库 schema 版本 18。R1 的迁移编号已按执行顺序排好：v19 结算记录（R1-T02）、v20 现场分析（R1-T02.a）、v21 父子分块（R1-T03.a）、v22 章节压缩（R1-T05）、v23 世界书预筛（R1-T06）、v24 变更卡（R1-T07.a）、v25 上下文包（R1-T08）。在已排定的任务之间插入新迁移时，后续编号要一起顺延。
- 台账只有结构与读取，**没有写入校验的强制点**：`appendStateDiffs` 不调用 `validateLedgerDiff`；R1-T02 的结算器负责在写入前校验（I12）。现有结构化输出 `state_update` 仍可写任意路径，来源记为 `model`。
- `readLedgerFacts` 不读取快照缓存，按 `getStateDiffsAlongPath` 回放，返回顺序是路径上首次出现的顺序。
- 已注册的槽位是九个（`packages/core/src/context/template.ts` 的 `CONTEXT_SLOT_NAMES`：lore、character、persona、summary、state、memory、history、director、protocol）；DESIGN §9 里的 `ledger` 对应实现的 `state`，`beat` 尚未注册。R1-T02.a 要新增 `scene` 槽位，R2-T01 的朴素模式要排除它。
- `packages/server` 已提供故事、导入、设置、模板、SSE 回合与后台运行时缓存；`packages/protocol` 已提供 HTTP 与 SSE 类型；`packages/web` 尚未创建。
- `story_settings` 默认值：`budgetTokens` 12000、`structuredOutput` `text-tags`、`temperature` 0.8、`maxTokens` 1024、`reasoning` `low`、导演使用默认配置。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表已在 v7 建立，但真实回放里没有事件；R1-T03 改为批量窗口后由 R1-T04.a/.b 回填。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- M3 的两项效果目标按 ADR-0029 保留为未证实；v2 的门槛改由 R6 按 B0/B1 对比判定。

## 下一步
- **F0-T03 裁判校准**（后台渠道，约 400 次调用）：直接读取 `eval-private/f0/pairs.jsonl` 的 200 对，隐去标签，以两种顺序交给裁判模型选择，统计选中玩家实际所选回复的比例、位置偏差与置信区间。注意 F0-T02 的 94 对「被接受的不是最后一条 swipe」与 11 对「另一种可行写法」都是噪声来源，统计时给出分组。
- 之后按 F0 顺序：F0-T04 全文基线与渠道上限探测（最多 30 次）、F0-T99 报告与路线建议、F0-T100 写 v3 并改写路线（ADR-0039，不再请人类决定）。F0 的全部模型调用固定用 magpie 网关的 DeepSeek V4.1 Flash；不调用本地 ST（I14）。
- F0-T100 合并 v3 之后，先做 **R0-T04 合并 v3 插件系统提案**（`docs/proposals/plugins.md`，人类已确认），再按新路线继续；**兼容插件线 C-T01–C-T05 排在插件内核改造 P2 之后**（ADR-0038：沙箱与一致性测试台，然后 `st-content` → `st-mvu` → `st-ejs` → `st-helper-host`）。
- 新路线确认之前仍按 TASKS 的 R1 顺序执行：R1-T01.b 渠道按岗位配置、R1-T02 台账结算器（v19）、R1-T02.a 现场分析（v20）、R1-T03 批量事件抽取、R1-T03.a 父子分块（v21）、R1-T03.b 重排序、R1-T04.a/.b 回填与记忆评测、R1-T05 八段式压缩（v22）、R1-T06 世界书预筛（v23）、R1-T07 用户意志、R1-T07.a 自然语言修订记忆（v24）、R1-T08 上下文包复用（v25）、R1-T99；再到 R2、E-T01、X1/X2、R3、R4、R5、H-T00、R6、R7。
- E-T01（`dramaticer explain`）排在 R2-T99 之后；H-T00（应用内助手）排在 R5-T99 之后并取代原 R7 的侧边 agent。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包、ST 语义只在兼容插件里实现。
- `pnpm f0:attribution` 需要先 `pnpm run typecheck` 构建 core 与 st-compat 的 `dist`，并读取 `eval-private/reports/f0-corpus-map.json`（由 `pnpm f0:corpus` 生成）。环境变量：`DRAMATICER_F0_PAIRS` 默认 200，`DRAMATICER_F0_CONCURRENCY` 默认 4，`DRAMATICER_F0_MAX_TOKENS` 默认 2500；归因模型输出为空或 `stopReason` 为 `length` 时用至少 4096 重试一次。结果按 pair id 续跑：`eval-private/f0/attribution.jsonl` 里已成功的配对不会再调用模型；router 缓存目录是 `eval-private/f0/llm-cache`。
- 归因输出必须原样使用固定类别；模型写成「前后矛盾」会被拒绝并计入失败，不要放宽校验。3 个失败配对的明细在 `eval-private/f0/attribution.jsonl`。
- `pnpm f0:corpus` 需要先设置 `DRAMATICER_ST_ROOTS`（Windows 上用分号分隔三个 ST 数据目录），并保证 `packages/core/dist` 已构建；脚本会覆盖 `docs/dev/reports/F0-corpus.md` 与 `eval-private/reports/f0-corpus-map.json`。
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
