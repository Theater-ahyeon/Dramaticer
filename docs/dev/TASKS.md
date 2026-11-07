# 任务清单

状态标记：`[ ]` 待做 · `[~]` 进行中 · `[x]` 完成 · `[!]` 被阻塞（括号里写阻塞它的 HUMAN 编号）

规则：从上往下选第一个可以做的任务；一个会话只做一个任务；任务太大就拆成子任务（`.a`、`.b`……）。每个里程碑最后都有一个 `T99` 验收任务。后面的里程碑只写了粗粒度条目，**由它的 `T00` 拆解任务细化**。

---

## F：取证（先于 R1，人类 2026-11-07 指定）

> 背景与决定见 ADR-0037。F0 的结论出来之前，不选 R1 及之后的任务。F0 的全部模型调用一律用 magpie 网关（`http://127.0.0.1:3425/v1`）上的 **DeepSeek V4.1 Flash**；`.env` 的后台与正文渠道已经是 `opendesign/deepseek-v4.1-flash`，不要改用其他模型。

- [x] **F0-T01 全量对话统计（不调用模型）** | 依赖：无
  完成：2026-11-07 只读扫描 3 个目录共 406 个 jsonl、按文件名去重后 265 个对话（5,633 楼层、7,967,163 正文 token）；报告写入 `docs/dev/reports/F0-corpus.md`，扫描器 `scripts/f0-corpus.mjs`（`pnpm f0:corpus`，目录从 `DRAMATICER_ST_ROOTS` 传入），对话编号到文件路径的映射写到 `eval-private/reports/f0-corpus-map.json`
  做什么：
  - 只读扫描三个目录的 `chats/`：`D:\SillyTavern\TauriTavern\default-user\`、`D:\SillyTavern\data\default-user\`、`D:\SillyTavern\luker\Luker\data\default-user\`（人类已授权只读）。按文件名去重（约 230 个对话），流式处理，不把整个文件读进上下文。
  - 统计：每个对话的楼层数分布（P50、P75、P90、最大值）、当前 swipe 正文的 token 估算、能整个放进 128K、200K、1M 上下文的对话各占多少、重 roll 率（swipe 数大于 1 的助手楼层占比）、按修改时间划分的近期与早期对比。
  验收：统计数字写进 `docs/dev/reports/F0-corpus.md`；用“对话 N”代替角色名，不写原文、角色名或绝对路径以外的私有标识。

- [x] **F0-T02 拒绝与接受回复对的归因（后台渠道，约 200 次调用）** | 依赖：F0-T01
  完成：2026-11-07 新增 `scripts/f0-pairs.mjs`（配对抽取、按对话分层抽样、归因输出校验）与 `scripts/f0-attribution.mjs`（`pnpm f0:attribution`）；168 个对话有可比较配对，384 个重 roll 楼层得到 332 个可用配对，抽样 200 对写入 `eval-private/f0/pairs.jsonl`；后台 DeepSeek V4.1 Flash 归因 197/200 成功，主因前三为不推进剧情 43（21.8%）、没听用户的指示 42（21.3%）、格式或状态栏 29（14.7%）；11 对（5.6%）判为另一种可行写法，抽样里被接受的不是最后一条 swipe 的占 94/200；报告写入 `docs/dev/reports/F0.md`；`parseChatJsonl` 增加 `strictSwipeId: false` 只读模式以读取 swipe_id 越界的真实语料，门禁通过（649 个测试）
  做什么：
  - 从有重 roll 的助手楼层里抽取回复对（`swipe_id` 指向的那个算接受，其余算拒绝），按对话分层抽样约 200 对，复制到 `eval-private/f0/`。
  - 让后台模型对比每一对，判断被拒绝的回复主要差在哪里，从这些类别里选一个主因加最多两个次因：遗忘或前后矛盾、OOC、重复或原地打转、不推进剧情、没听用户的指示、文笔或文风、拒答或说教、截断、格式或状态栏、其他。
  - 记录归因模型自己的置信度。处理两个偏差：玩家有时会切回早先的 swipe；有时重 roll 只是想看看别的写法。
  验收：得到失败原因分布并写进 `docs/dev/reports/F0.md` 的对应章节；抽样与调用次数有记录；不写原文与角色名。

- [x] **F0-T02.a 语料节奏与回复构成统计并入脚本** | 依赖：F0-T02 | ADR-0041（A1）
  完成：2026-11-07 `scripts/f0-corpus.mjs` 新增六组统计（节奏与时间、按楼层深度的重 roll、回复构成、结构化块、生态功能覆盖、编辑信号），块占比用 core 块解析器；新增 `scripts/f0-composition.mjs` 与 20 个测试；`docs/dev/reports/F0-corpus.md` 重新生成，门禁通过（669 个测试）
  做什么：
  - 把 `docs/proposals/v3-review.md` 的 0.1–0.6 六组统计并入 `scripts/f0-corpus.mjs`，重新生成 `docs/dev/reports/F0-corpus.md`：助手生成耗时、首字延迟、玩家思考间隙、会话段数（相邻楼层间隔超过 30 分钟算新段）与对话跨度；按楼层深度分桶的重 roll 率（全部对话与楼层 ≥ 50 的子集两个口径）、“最后一楼是重 roll 后的助手回复”的对话数；助手与玩家回复的 token 分布（第 50 楼以后单列）、回复里标签块与代码块的字符占比（用 core 的块解析器统计，不用正则估算）、思考内容 token；按类别统计的开标签次数；生态字段与插件的覆盖（对话级插件标记、表格、剧情规划、EJS 标记、定时世界书、作者注释、变量插件、思考签名、原生工具调用）；`mes` 与 `swipes[swipe_id]` 不一致的楼层及其分类（少量手改、正文大改、末尾追加、只差空白、新增标签块）。
  - 报告只含数字与字段名；每一节写清口径，缺失生成时间或发送时间的楼层如何处理要写明。
  验收：报告新增六节，数字与提案 0.1–0.6 同口径（差异写明原因）；块占比用 core 块解析器；`pnpm check` 通过。

- [x] **F0-T02.b 按楼层深度分层补样并补齐归因** | 依赖：F0-T02、F0-T02.a | ADR-0041（A1）
  完成：2026-11-07 抽样改为按楼层深度分三层补样（1–10 楼、11–50 楼、51 楼以上，每层目标 67 对，已有样本保留），归因配对从 200 增至 290，成功 285、失败 5；报告新增分层抽样表、按层主因矩阵与“最后一楼被重 roll 后对话结束”子集（70 对，主因最高项为没听用户的指示 17/24.3%），门禁通过（676 个测试）
  做什么：
  - 抽样改为按被拒绝回复所在的楼层深度分三层：1–10 楼、11–50 楼、51 楼以上，各约三分之一；已完成的样本保留，按层补齐到每层约 67 对（某层可用配对不足时全取）。
  - 对新增配对跑归因（同一模型、同一校验、同一续跑规则），报告按层给出主因分布，并单列“最后一楼被重 roll 后对话结束”的子集统计。
  验收：三层各自的样本数与原因分布写进 `docs/dev/reports/F0.md`；总调用次数与失败数有记录；不写原文与角色名。

- [x] **F0-T03 裁判校准（后台渠道，约 400 次调用）** | 依赖：F0-T02.b
  完成：2026-11-07 新增 `scripts/f0-judge.mjs` 与 `scripts/f0-judge-lib.mjs`（`pnpm f0:judge`，两种顺序、按 key 续跑、失败判断绕过缓存重试）与 17 个测试；门槛在运行前写入报告；从 285 个已归因配对里分层抽 195 对，390 次判断全部成功；一致率 73.3%（95% 置信区间 68.7%–77.5%）、位置偏差 4.1 个百分点、换序一致率 81.5%，两项门槛都达到；`opendesign/deepseek-v4.1-flash` 返回 membership entitlement 错误，按 ADR-0042 改用 `auto/deepseek-v4.1-flash` 并在报告注明；门禁通过（693 个测试）
  做什么：
  - 运行前先把判定规则写进 `docs/dev/reports/F0.md`：交换顺序后裁判与玩家选择的一致率 ≥ 65%、且位置偏差 ≤ 10 个百分点，才把 LLM 裁判用于偏好判断；达不到时 R2 的裁判只用于有台账可对照的矛盾与遗忘判定，偏好改用玩家的选择数据。
  - 把同一批回复对隐去标签，以两种顺序分别交给裁判模型，统计裁判选中玩家实际所选回复的比例、位置偏差，并给出置信区间；按“被接受的是否是最后一条 swipe”与“另一种可行写法”分组。
  - 结论注明是同模型自评（F0 固定一个模型），不能当作 R2 的裁判口径。
  验收：门槛在运行前已写入报告；一致率、位置偏差与置信区间齐全；结论写明 R2 的 LLM 裁判能不能代表玩家的喜好。

- [x] **F0-T04 全文基线小样本与渠道上限探测（正文渠道，最多 30 次调用）** | 依赖：F0-T01
  完成：2026-11-07 新增 `scripts/f0-fulltext.mjs`（`pnpm f0:fulltext`，分 probe、generate、judge、report 四个阶段，结果按 key 续跑）与 `scripts/f0-fulltext-lib.mjs` 及 19 个测试；`main` 别名的模型持续返回 membership entitlement 错误，按 ADR-0042 改用 `main-fallback`；请求长度探测从 32K 到 1M 全部被接受（1M 级别渠道报告输入 873,850 token，首字 9.7 秒），没有探测到上限，而配置里的 contextWindow 仍是 131072；从 4 个对话各选一个分支点（此前 48–143 楼、原文 64,535–82,751 token），全文组与记忆引擎组各生成一次，8 次生成全部正常结束；裁判两种顺序共 8 次判断，全文组胜 6 次、记忆引擎组胜 2 次，结论一致的分支 2/4，平均置信度 0.69；对话 95 的两组因提供方内容过滤被替换为对话 128；正文渠道合计 27 次调用，报告写入 `docs/dev/reports/F0.md`；门禁通过（712 个测试）
  做什么：
  - 先探测正文渠道能接受的最大请求长度（从 32K 开始逐级增加到 1M，记录成功与否、首字延迟、是否被截断）。
  - 挑 3 到 5 个能整个放进上下文的分支点，分别用“全部正文 + 原生模板”和“当前记忆引擎”各生成一次，交给裁判比较矛盾和遗忘。
  - 全文 token 先剔除标签块（用 core 的块解析器）再估算，“全部正文”组同时报告含标签与不含标签两种口径；F0 固定只用一个模型，结论注明是同模型自评。
  - 不调用本地 ST（I14）。
  验收：上限探测与两组生成的结果写进 `docs/dev/reports/F0.md`。

- [x] **F0-T99 取证报告与路线建议** | 依赖：F0-T01、F0-T02.b、F0-T03、F0-T04
  完成：2026-11-07 `docs/dev/reports/F0.md` 新增 F0-T99 节，逐条回答 P1、P3、P4 并给出四条路线建议；ADR-0043 记录结论与中间层只作可选方式的决定；主菜排序为开局与方向 → 输出形态 → 记忆与台账最小集 → 生图
  做什么：
  - 汇总成 `docs/dev/reports/F0.md`，逐条回答：P1 玩家不满意的主因是不是上下文或方向能解决的问题；P3 全文直接塞进上下文够不够用；P4 裁判能不能信。
  - 在“Dramaticer 是独立产品”的前提下给出建议：①主菜按失败原因分布怎样排序；②ST 兼容按 `docs/proposals/st-compat-plugins.md` 全部做进可选插件，不出放弃清单（ADR-0038）；③最小可玩版本怎样提前；④怎样把玩家的重 roll、编辑、选择收集为偏好信号，用来校准评测。
  - “中间层接入”最多作为可选方式，不做可行性论证；为这个决定写一条 ADR。按 ADR-0039 不再在 HUMAN.md 请人类决定。结果写 `MILESTONE_DONE`。
  验收：报告章节齐全，每条建议都有对应数字或调用记录。

- [ ] **F0-T100 写 v3 并改写路线** | 依赖：F0-T99
  做什么：
  - 根据 `docs/dev/reports/F0.md`，在“Dramaticer 是独立产品”的前提下写 `docs/proposals/v3.md` 与对应 ADR：①按失败原因分布排序的主菜（别人做不到的体验）；②ST 兼容按 `docs/proposals/st-compat-plugins.md` 全部做进可选插件，不放弃任何生态功能；③插件系统按 `docs/proposals/plugins.md`；④偏好信号（重 roll、编辑、选择、变更卡的批准）的收集与在评测里的用法；⑤原路线里“人类试玩”的环节全部换成自动试玩加评测。
  - 合并进 `docs/DESIGN.md`，重写 F 之后的全部阶段：细化最近两个阶段，其余阶段的条目由各自的 T00 细化。
  - 按 `docs/proposals/v3-review.md` 第三节决定阶段顺序（只调整顺序，不缩小范围，全部范围保留）：①纵向切片提前——先做 R1 的最小集（结算器、`gap_pass`、块的 prompt 视图、生成长度默认值），再是 R3 快回合、R5 的最小界面（聊天、swipe、台账只读面板、图片与选项块显示），再接自动试玩；父子分块、重排序、八段式压缩与世界书预筛等 B0 对 native 的长对话评测显示确有遗忘问题后再做；②开局质量作为主菜候选（开场导演、首楼多候选、前 10 楼的导演强度），是否列为主菜由 F0-T02.b 的分层结果决定；③生图的第一批（ComfyUI 与 `illustrate` 块显示）排到最小界面之后；④插件内核 P2 排在 R5 之后，P1 技术验证可以提前；⑤兼容插件按使用频度排子集：P-A（世界书含定时、预设、宏、正则）先做，P-C 与 P-A 同期（台账导入依赖 MVU），EJS 与酒馆助手宿主随后，全部范围保留；⑥公开合成基准提前到 R2。
  - 范围不得小于 DESIGN 与已确认的提案；之后的会话按新路线继续开发。
  验收：提案与 ADR 入库；DESIGN 与提案一致；F 之后的阶段都有任务、依赖与验收标准；HUMAN.md 不新增需要人类决定的路线问题；`pnpm check` 通过。结果写 `MILESTONE_DONE`。

---

## M0：数据与度量（DESIGN §2、§14、§15）

- [x] **M0-T01 仓库与工程骨架** | 依赖：无
  完成：2026-11-06 `pnpm install` 与 `pnpm check` 通过（2 个测试），`setvar` 探针让 invariants 报 I1 后已删除
  做什么：
  - 如果还不是 git 仓库就执行 `git init -b main`
  - 根目录：`package.json`（`"type": "module"`，`engines.node >= 22.19`，`packageManager` 写成当前的 pnpm 版本）、`pnpm-workspace.yaml`、`tsconfig.base.json`（strict 模式，`NodeNext` 模块解析）、`biome.json`、`.gitignore`（忽略 `node_modules/ dist/ data/ eval-private/ .env .devloop/ *.log`）、`.env.example`（渠道相关的变量名，值留空）
  - 建 `packages/core` 和 `packages/st-compat` 两个包（各自有 `package.json`、`tsconfig.json`、`src/index.ts`，再加一个 vitest 示例测试）；st-compat 依赖 `"@dramaticer/core": "workspace:*"`
  - 根脚本：`typecheck`（`tsc -b` 或者逐个包执行）、`lint`（`biome check .`）、`test`（`vitest run`）、`invariants`（`node scripts/check-invariants.mjs`）、`check`（依次运行 invariants、typecheck、lint、test，任何一步失败就整体失败）
  - 新建 `docs/dev/DEPENDENCIES.md`，登记所有依赖：包名用反引号括起来，并写一句理由
  验收：`pnpm install && pnpm check` 通过；`git status` 干净；故意在 core 里写一个 `setvar` 能让 invariants 失败（验证完删掉）。

- [x] **M0-T02 私有数据快照脚本** | 依赖：M0-T01
  完成：2026-11-06 脚本复制 67 个文件（3 对话、3 卡、3 世界书、58 预设）到 `eval-private/raw`，manifest 的 sha256 与源文件、目标文件逐一核对一致
  做什么：写 `scripts/snapshot-private-data.mjs`。它从 `D:\SillyTavern\TauriTavern\default-user\` **只读地复制**以下内容到 `eval-private/raw/`：
  - `chats/` 下 3 个角色目录里各自**最大的**那个 jsonl：目录名以「仙侠雌竞」开头的、「银麒赎世」、「欲望世界-1600」
  - 这 3 个角色对应的角色卡（`characters/` 下同名的 png 或 json）
  - 这 3 个角色引用的世界书（从卡的 `extensions.world` 或者 `character_book` 推断；推断不出来就按名字匹配 `worlds/`）
  - `OpenAI Settings/` 下全部预设
  然后生成 `eval-private/raw/manifest.json`，记录源路径、大小、sha256。源路径通过环境变量 `DRAMATICER_ST_ROOT` 指定，默认值就是上面这个目录。
  验收：执行脚本后文件齐全，manifest 完整；脚本**只读**源目录；`git status` 里看不到 eval-private。

- [x] **M0-T03 st-compat：聊天 jsonl 解析** | 依赖：M0-T01
  完成：2026-11-06 `packages/st-compat/src/chat-jsonl.ts` 流式逐行解析，覆盖 swipe、system 消息、缺失字段、超长行；真实快照 3 个对话 1222 条消息全部解析通过
  做什么：实现**流式逐行**解析（单个文件可能有 35 MB，每行可能超过 100 KB）。解析出：头部信息（character_name、user_name、chat_metadata 原样保留）；每条消息的 `name`、`is_user`、`is_system`、`send_date`、`mes`（当前 swipe 的正文）、`swipes`、`swipe_id`、`extra.reasoning`、`variables`（MVU 变量）。不认识的字段放进 `raw` 里原样保留。
  验收：用合成的测试数据覆盖：swipe、system 消息、缺字段、超长行；类型完整。

- [x] **M0-T04 st-compat：角色卡解析** | 依赖：M0-T01
  完成：2026-11-06 `packages/st-compat/src/character-card.ts` 解析 PNG（ccv3 优先，回退 chara）与 JSON 卡，兼容 V1/V2/V3，保留内嵌世界书与 extensions；13 个测试，真实快照 3 张卡解析通过
  做什么：解析 PNG（`tEXt` 块里的 `chara` 或 `ccv3`，base64 编码的 JSON）和 JSON 格式的卡；兼容 V2 和 V3；提取内嵌的 `character_book`；`extensions` 原样保留。
  验收：合成的 PNG 测试数据（在测试里用代码生成最小的 PNG）、V2 和 V3 的 JSON 测试数据都能解析通过。

- [x] **M0-T05 st-compat：世界书与预设解析** | 依赖：M0-T01
  完成：2026-11-06 `packages/st-compat/src/world-info.ts` 与 `preset.ts` 解析 ST 世界书条目和 OpenAI 预设（prompts、prompt_order、采样参数、预填充、正则脚本），保留 raw；21 个测试，真实快照 3 个世界书与 58 个预设解析并逐文件结构往返通过
  做什么：
  - 世界书条目：主关键词、次关键词、constant、selective、position、depth、order、probability、禁用状态等
  - 预设：`prompts`、`prompt_order`、采样参数、`assistant_prefill`、`extensions.regex_scripts`；不认识的字段原样保留
  - 解析结果用明确的 TS 类型表达
  验收：合成测试数据覆盖主要字段；解析之后再序列化，和原文件在结构上等价。

- [x] **M0-T06 core：原生领域模型与存储（M0 子集）** | 依赖：M0-T01 | DESIGN §5、§7
  完成：2026-11-06 `packages/core/src/timeline.ts` 定义 Story、TimelineNode、StateDiff、NewStateDiff；`store/` 用 better-sqlite3 建 stories/nodes/state_diffs 与 FTS5 node_text（trigram），schema 用 `PRAGMA user_version` 迁移，数据库触发器禁止修改楼层原文；13 个测试，门禁通过
  做什么：定义这些类型：Story、TimelineNode（含 parentId 和不可修改的 raw）、StateDiff；用 better-sqlite3 建表（nodes、state_diffs、带 FTS5 的 node_text）；写一个数据库迁移机制（schema 版本号）。**存储层不提供修改 raw 的接口**（不变量 I4），并写一个测试确保这一点。
  验收：能建库；能插入节点和 diff；能按路径（从根到某个节点）读出数据；FTS5 查询可用。

- [x] **M0-T07 st-compat：ST 对话导入为原生楼层树** | 依赖：M0-T03、M0-T06
  完成：2026-11-06 `packages/st-compat/src/chat-import.ts`：当前 swipe 连成主路径、其他 swipe 建为兄弟节点，相邻楼层 MVU 快照生成 StateDiff；11 个测试，真实快照 1222 层往返零差异，门禁通过
  做什么：ST 对话 → 一条线性路径（当前 swipe 作为主路径上的节点，其余 swipe 作为兄弟节点）；**把相邻楼层的 MVU 变量做 diff，转成 StateDiff**，并验证按路径把 diff 依次累加之后能还原出原来的快照。
  验收：合成测试数据通过往返测试（快照 → diff → 快照）。

- [x] **M0-T08 体检报告** | 依赖：M0-T02、M0-T05、M0-T07
  完成：2026-11-06 `pnpm --filter @dramaticer/st-compat report` 生成私有报告与统计版 `docs/dev/reports/M0-health.md`；3 个对话 1222 层、diff/快照 20.8%、58 个预设的宏与正则统计；26 个新测试，门禁通过
  做什么：CLI 命令 `pnpm --filter @dramaticer/st-compat report`。对 eval-private 里的每个对话统计：楼层数；正文、变量、其他字段各占多少字节；估算的 token 数（估算函数做成可替换的，中文约 1.5 个字符算 1 个 token）；**原生 diff 存储和 ST 快照存储的体积比**；从卡和世界书里提取的实体数量；**重复度曲线**（相邻 AI 回复的字符 n-gram Jaccard 相似度，按楼层分窗口统计，标出从第几楼开始持续上升）。另外统计预设：宏的使用频率、正则作用范围和开关的分布。
  输出：详细报告写到 `eval-private/reports/health.md`（可以引用原文片段）；**只含统计数字的版本**写到 `docs/dev/reports/M0-health.md`（可以提交）。
  验收：两份报告都生成了；仓库版本里没有任何原文。

- [x] **M0-T09 正则分类器** | 依赖：M0-T05
  完成：2026-11-06 `packages/st-compat/src/regex-classifier.ts` 按结构分类 928 条正则（渲染 HTML 214、内联脚本 141、删除内容 319、删除思考链 76、重排捕获内容 99、文本替换 39、流式版本 34、无法分类 6），启用的 637 条里 300 条可自动升级（47.1%）；报告新增正则分类章节，17+1 个新测试，门禁通过
  做什么：在 st-compat 里实现分类器，分类与 DESIGN §6 对应：html_render、html_script、delete（区分只影响显示、只影响 prompt、带深度限制）、strip_cot、rewrite_capture、text_replace、streaming_variant。再判断每一条是否"可以自动升级"成块策略。对全部预设运行一遍，统计数字追加到 M0-health 报告里。
  验收：每个分类都有合成用例；报告里有可升级比例。

- [x] **M0-T10 评测集：状态类题目（规则生成）** | 依赖：M0-T07
  完成：2026-11-06 实现 `evalset/state-questions.ts` 与 `evalset/cli.ts`：按稳定区间生成状态题并回放快照核对；3 个对话共 236 题（71/65/100），全部核对一致；ADR-0006 修正空对象快照语义，10 个新测试，门禁通过
  做什么：从 MVU 的 diff 中按规则生成题目：在第 Y 楼提问"在第 X 楼之后，<变量路径> 的值是什么"，标准答案取自快照，证据是第 X 楼。只挑间隔大的（Y − X ≥ 30）和重要的变量（变化次数少、不是每楼都变的那种）。每个对话出 50 到 100 题。格式为 JSONL：`{id, story, askAtNode, question, answer, evidenceNodes, kind:"state"}`，写到 `eval-private/evalset/`。
  验收：题目数量达标；随机抽 10 题，自动核对答案和快照一致。

- [x] **M0-T11 LLM 最小客户端与事件类题目** | 依赖：M0-T07 | 需要 HUMAN-01
  完成：2026-11-06 新增 core 的 OpenAI 兼容客户端（可配置限速、重试、按请求 hash 缓存、思考 token 统计）与 st-compat 事件题生成器；3 个对话共 150 题（各 50），结构核对全部一致；`antigravity/gemini-3.8-flash` 账号中途被上游停用，第三个对话改用 `auto/deepseek-v4.1-flash`（HUMAN-05）；spotcheck 30 题；15 个新测试，门禁通过
  做什么：在 core 里写一个最小的 OpenAI 兼容客户端（只为 M0 服务，到 M1 会被 pi-ai 替换，所以接口保持很薄）；渠道从 `.env` 读取（`DRAMATICER_BG_BASE_URL`、`DRAMATICER_BG_API_KEY`、`DRAMATICER_BG_MODEL`）；带限速（每分钟请求数可以配置）、重试和缓存（同样的输入不重复调用）。然后用它让后台模型按窗口阅读对话，生成事件类题目（`kind:"event"`），每个对话 50 题。另外随机抽 20% 写进 `eval-private/evalset/spotcheck.md`，供人类**可选地**抽查。
  验收：题目生成完成；在 HUMAN.md 里新增一条可选事项 HUMAN-03，请人类抽查（这条不阻塞任何任务）。

- [x] **M0-T12 基线：朴素 BM25 检索** | 依赖：M0-T10
  完成：2026-11-06 core 新增固定窗口分块与 FTS5 trigram 块索引（`ChunkIndex`），st-compat 新增按题目类型统计的检索评测；3 个对话 386 题，命中@5/10/20 = 126/143/153（事件题 113/128/137，状态题 13/15/16）；报告写入私有版和统计版 health
  做什么：把历史楼层切成小块，存入 FTS5；对每道题，只在提问楼层之前的内容里检索，算出 recall@5、@10、@20（证据楼层是否命中）。输出按对话和题目类型分别统计。
  验收：报告追加到 health（私有版和统计版各一份）。

- [x] **M0-T13 ACU 对照组** | 依赖：M0-T10、M0-T03
  完成：2026-11-06 `packages/st-compat/src/evalset/acu.ts` 解析三种表格来源（头部 `sheets` 的 `cellHistory` 配逐楼层 `hash_sheets`、`TavernDB_ACU_Data`/`independentData` 整表内容、`TavernDB_ACU_IsolatedData` 的 SQL 更新在内存 SQLite 里重放），按提问楼层之前最近的表格内容做规范化包含判断；3 个对话都适用、没有不适用对话；386 题覆盖 91（23.6%），状态题 88/236（37.3%）、事件题 3/150（2.0%）；答案按长度分档后 1 字符 27/33、2–3 字符 39/61、4–9 字符 25/69、10 字符以上 0/223；报告写入私有版和统计版 health；7 个新测试，门禁通过（157 个测试）
  做什么：解析 ACU 表格数据（`chat_metadata.sheets`，以及消息里的 `TavernDB_ACU_*`、`hash_sheets` 字段，先写探测代码弄清楚结构），在提问楼层时刻取出表格内容，判断答案是否出现在表格里（先用规范化字符串匹配；有 LLM 渠道时再加一个可选的 LLM 判定）。如果某个对话里没有 ACU 数据，就记为"不适用"。
  验收：报告里有"ACU 覆盖率"这个对照数字。

- [x] **M0-REVIEW-1 代码与不变量审查**（ADR-0002 要求累计推进 8 项任务后插入；M0-T11 完成时已到期） | 依赖：M0-T13
  完成：2026-11-06 结论写入 `docs/dev/reports/M0-review-1.md`（I1–I10 逐条判断依据；32 条代码问题、7 条文档不同步、测试覆盖缺口；门禁 157 个测试通过）；发现问题转成 M0-FIX-1 到 M0-FIX-11，门禁脚本的两处缺口写进 HUMAN-06
  做什么：审查 `packages/core`、`packages/st-compat`、`scripts/` 的代码质量（没有用到的代码、重复实现、错误处理、fast-fail）；逐条核对不变量 I1–I10，其中 I4、I5、I6、I8、I9 必须指出对应的测试；检查 TASKS、HANDOFF、DECISIONS、DESIGN、DEPENDENCIES 与代码是否同步；列出没有测试覆盖的导出模块和 CLI 路径。
  验收：结论写进 `docs/dev/reports/M0-review-1.md`；每个发现的问题转成 `M0-FIX-n` 修复任务插在本任务下面并写清验收标准；没有问题的条目也要写出判断依据。

- [x] **M0-FIX-1 导入原子性与状态快照** | 依赖：M0-REVIEW-1
  完成：2026-11-06 `StoryStore.runInTransaction` 让整次导入在一个事务里完成，失败回滚故事、楼层、diff 与 FTS 条目；`swipe_id` 越界或非整数在解析阶段抛错，节点 id 与 MVU 快照共用同一校验结果；嵌套空对象生成删除 diff 的用例、状态题答案与 store 回放交叉验证的用例已补；6 个新测试，门禁通过（163 个测试）
  做什么：`packages/st-compat/src/chat-import.ts` 的整次导入放进一个事务，失败后库内不残留故事、楼层、diff 与 FTS 条目；`swipe_id` 越界或非整数时直接抛错，节点 id 与 MVU 快照取自同一个下标；`readSnapshot` 的嵌套空对象（`{"stat_data":{}}`）语义补测试；状态题测试改为先导入 store，再用 `getStateDiffsAlongPath` 回放并断言与题目答案一致。
  验收：新增“坏行在文件末尾时库内为空、修正后可以重新导入”“越界 swipe_id 抛错”“嵌套空对象生成删除 diff 且回放正确”“题目答案与 store 回放一致”四组测试；`pnpm check` 通过。

- [x] **M0-FIX-2 聊天与角色卡解析边界** | 依赖：M0-REVIEW-1
  完成：2026-11-06 聊天首行剥离 UTF-8 BOM，`splitChatLines` 复用 `stripCarriageReturn`；角色卡改用 `field-readers` 的读取函数并增加 base64 回环校验；四个无消费者的符号退出导出；PNG 失败路径测试补齐，门禁通过（166 个测试）
  做什么：`chat-jsonl.ts` 首行剥离 U+FEFF；删除没有调用的 `stripCarriageReturn`（或让 `splitChatLines` 的两处内联改为调用它）；`character-card.ts` 改用 `field-readers.ts` 的读取函数并删除本地重复实现；`src/index.ts` 不再公开 `SourceLine`、`splitChatLines`、`isPngData`、`SnapshotDiffOp` 等没有外部消费者的符号；给 `test/png-fixture.ts` 增加写入原始文本的选项，补 tEXt 解码失败与非法 base64 两条用例。
  验收：BOM 用例覆盖 `parseChatJsonl` 与 `parseChatJsonlFile`；角色卡错误文案与现有测试保持一致；新增两条 PNG 失败路径测试；`pnpm check` 通过。

- [x] **M0-FIX-3 后台 LLM 客户端重试与中止** | 依赖：M0-REVIEW-1
  完成：2026-11-06 `packages/core/src/llm/client.ts` 只把响应体的 `SyntaxError` 判为“不是 JSON”并只发一次请求，其余读取错误与中止原样抛出；退避与限速等待都接收中止信号，`Retry-After` 增加 `maxRetryAfterMs`（默认 60 秒）；缓存键并入 apiKey 的 sha256 摘要，`stableJson` 与 `JSON.stringify` 语义一致；删除不可达的尾部抛出与 `LlmResponseError` 重试分支；新增 13 个用例，门禁通过（179 个测试）
  做什么：`packages/core/src/llm/client.ts` 只在响应体解析抛出 `SyntaxError` 时按“响应体不是 JSON”处理，其余读取错误原样抛出；2xx 且响应体非法时只发一次 HTTP 请求；等待（重试退避与限速）监听 `request.signal`，`Retry-After` 设上限；缓存键并入 `apiKey` 的摘要；`stableJson` 丢弃值为 `undefined` 的属性、`Date` 等按 `JSON.stringify` 处理；删除不可达的 `throw lastError` 与 `LlmResponseError` 重试分支。
  验收：新增用例覆盖 2xx 非 JSON 只请求一次、中止抛出 `AbortError`、`Retry-After` 上限、`undefined` 属性与 `apiKey` 影响缓存键、`parseCompletion` 四个错误分支、5xx 重试与错误体的 `status`/`body`；`pnpm check` 通过。

- [x] **M0-FIX-4 检索规范化与命中口径** | 依赖：M0-REVIEW-1
  完成：2026-11-06 `normalizeRetrievalText` 让写入与查询共用 NFKC 加去标点/符号/空白的规范化，规范化后无字符的块不写入；`evalset/retrieval.ts` 按 `nodeId` 保序去重，`askAtNode` 越界抛错并指出题目；新增分块、索引与检索边界测试，报告命中更新为 141/156/163（原 126/143/153），门禁通过（188 个测试）
  做什么：`ChunkIndex` 的写入与查询使用同一套规范化（NFKC、去掉标点/符号/空白中的一致处理）；`evalset/retrieval.ts` 按 `nodeId` 保序去重后取前 K；`askAtNode` 序号越界直接抛错；补分块与索引的边界测试（长度等于 `maxChars`、等于 `maxChars + 1`、末尾残片小于 `step`、`\r\n` 归一化、`limit` 上限、重复写入、`toThrow` 按消息断言）。
  验收：新增“全角文本写入后全角查询命中”“带标点查询命中”“同一楼层多个块只占一个位次”“越界 askAtNode 抛错”等用例；重新跑 `pnpm --filter @dramaticer/st-compat report` 并用新的命中数字更新 `docs/dev/reports/M0-health.md`；`pnpm check` 通过。

- [x] **M0-FIX-5 ACU 快照逐单元格判定** | 依赖：M0-FIX-4
  完成：2026-11-06 表格快照改为值列表（单元格历史、整表内容与 SQL 重放都按单元格收集），每个值和答案各自规范化后判断答案是否出现在某一个值里，相邻单元格不再被拼成一段文本；提问楼层不在对话里时抛错并列出楼层与题目 id；补相邻单元格负例与缺楼层用例，ACU 覆盖仍为 91/386，门禁通过（190 个测试）
  做什么：`evalset/acu.ts` 的快照改为返回值数组（单元格历史与 SQL 重放都返回值列表），逐值规范化后判断包含，不再把相邻单元格拼成一段文本；提问楼层在聊天里不存在时抛出并列出题目 id；补“负例”：表格里只有 `集市` 与 `时间` 两个单元格时，答案 `集市时间` 判为未命中，`集市` 仍命中。
  验收：fixture 上两种答案的判定符合上述预期；重新跑报告，更新私有版与统计版的 ACU 章节数字；`pnpm check` 通过。

- [x] **M0-FIX-6 存储层校验与测试资源清理** | 依赖：M0-REVIEW-1
  完成：2026-11-06 `getStateDiffs` 对不存在的楼层抛错；`applyMigrations` 入口校验版本号从 1 连续递增（可选注入迁移列表）；`rowToStateDiff` 与 `#normaliseStateDiff` 共用 `assertStateDiffPath` 校验非空字符串数组；删除 `getLatestSchemaVersion`；版本测试注册临时目录清理，仓库里 43 个 `.tmp-store-*` 目录已删除且重跑测试不再新增；3 个新测试，门禁通过（193 个测试）
  做什么：`getStateDiffs` 对不存在的楼层抛错；`applyMigrations` 入口校验 `MIGRATIONS[i].version === i + 1`；`rowToStateDiff` 校验 `path` 是非空字符串数组；删除 `getLatestSchemaVersion`；`store.test.ts` 的版本测试注册临时目录清理，并清理仓库里已积累的 `.tmp-store-*` 目录。
  验收：补齐对应测试（存在性抛错、乱序迁移列表抛错、非法 `path` 抛错）；重复运行测试后 `packages/core/test/` 下不再新增 `.tmp-store-*`；`pnpm check` 通过。

- [x] **M0-FIX-7 体检报告口径与 CLI 入口** | 依赖：M0-FIX-4、M0-FIX-5
  完成：2026-11-07 合计增加 `headerBytes` 并在统计版单列（合计 66,397,069 字节，与分类之和的差额是 1,222 个行分隔符）；每对话字段统计改为全量、截断只在渲染层；删除零消费者的 `extraSwipeCount` 与 `totals.rawBytes`；`ratio` 对 0/0 返回 `null` 并显示 `—`；删除 `report.ts` 对 manifest 的再导出，两个评测 CLI 改走 `health/manifest.js`；`health/cli.ts` 抽出 `runHealthCli`（可注入路径与时间）并补测试；新增 7 个用例（含第 11 名字段 fixture、ACU 段、两条抛错分支、私有标识反向断言），门禁通过（200 个测试），两份报告已重新生成
  做什么：`HealthTotals` 增加 `headerBytes` 并在统计版表中单列；字段字节统计保留全量，截断只放在渲染层；`extraSwipeCount` 按每条消息累加 `max(0, swipes.length - 1)`（或删除字段）；`ratio` 对 `0/0` 返回 `null` 并显示 `—`；删除 `totals.rawBytes` 或把它加入报告；合并 `health/report.ts` 对 `health/manifest.ts` 的再导出；把 `health/cli.ts` 抽成可注入路径的 `runHealthCli` 并测试，覆盖 `renderAcuSection` 与 `collectHealthReport` 的两条抛错分支。
  验收：两份报告重新生成；新增合计差额小于 1% 的断言、每个对话第 11 名字段的 fixture、ACU 段落测试、statistics 版私有字段的整表反向断言；`pnpm check` 通过。

- [x] **M0-FIX-8 正则分类器与统计参数** | 依赖：M0-REVIEW-1
  完成：2026-11-07 `hasRenderSibling` 跳过 `disabled` 的兄弟脚本；`classifyCore` 的末尾不可达分支删除；`analyzeDuplication` 入口统一校验 `ngramSize`、`windowSize`、`step`、`riseWindows` 为正整数；`token-estimate` 补谚文五个区段；删除零调用的 `countMacros`（测试改用 `scanMacros`），`REGEX_CATEGORY_ORDER` 取消导出；新增 4 个用例，报告重新生成（可升级仍为 300/637 = 47.1%，token 估算因谚文略增），门禁通过（202 个测试）
  做什么：`hasRenderSibling` 跳过 `disabled` 的兄弟脚本；删除 `classifyCore` 里不可达的最后一个分支；`analyzeDuplication` 入口统一校验 `ngramSize`、`windowSize`、`step`、`riseWindows` 为正整数；`token-estimate` 补谚文区间；`countMacros` 取消导出（测试改用 `scanMacros`），`REGEX_CATEGORY_ORDER` 取消导出。
  验收：新增“启用流式 + 停用渲染 → 不可升级”“三个非法参数各抛错”“韩文 token 估算”用例；报告里的可升级比例随启发式修正重新生成；`pnpm check` 通过。

- [x] **M0-FIX-9 评测集 CLI 与题目文件** | 依赖：M0-REVIEW-1
  完成：2026-11-07 `readQuestionFile` 拒绝重复 id 并给出两处文件与行号；事件题模型输出缺字段或类型不符的条目逐条计入失败记录，空数组窗口记“模型输出里没有题目”；抽样改为按 id 哈希的 `sampleDeterministic`，状态题与事件抽查连续运行样本一致；`EventQuestionStats` 删除 `messageCount`、`floorCount`、`questionCount`；state CLI 拆出可测试的 `assertStateQuestionCount` 与 `writeStateSummary`；`event-cli --story` 只写 `spotcheck-<故事>.md` 与 `event-summary-<故事>.json`，不覆盖全局产物；`.env` 缺失由 `loadDotEnv` 抛错并带路径；计分与 `requireNonEmpty` 合并到 `evalset/shared.ts`；新增 19 个测试，门禁通过（221 个测试）
  做什么：`readQuestionFile` 拒绝重复 `id` 并给出文件与行号；事件题解析阶段的结构校验失败计入失败记录；20% 抽查与状态题抽样改为确定性（固定种子或 id 哈希），连续两次运行样本一致；`event-cli` 的 `--story` 运行时按故事分别写文件、汇总时合并已有条目，不覆盖全局 `spotcheck.md` 与 `event-summary.json`；删除 `EventQuestionStats` 里没有读取方的三个字段；给 `*FromFile` 包装、`sanitizeFileName`、`storyIdOf`、`evalset/cli.ts` 的题量区间与 `summary.json` 写出、`event-cli` 的 `.env` 缺失错误补测试；合并 evalset 内重复的计分与 `requireNonEmpty` 辅助。
  验收：新增测试覆盖上述每一条；`.env` 缺失时错误信息包含文件路径；`pnpm check` 通过（不调用 LLM，使用注入的假客户端）。

- [x] **M0-FIX-10 manifest 完整性校验** | 依赖：M0-REVIEW-1
  完成：2026-11-07 `health/manifest.ts` 的 `openSnapshot` 成为唯一入口：解析时要求 `size`（非负整数）与 `sha256`（64 位小写十六进制），`resolveFile` 先校验路径在 `rawRoot` 内，再用 `stat` 与流式 sha256 比对，错误都带 `target`；五个调用方改走同一入口，fixture manifest 补齐校验字段；新增 4 个测试，门禁通过（225 个测试）
  做什么：`health/manifest.ts` 保留 `size` 与 `sha256`；读取 raw 前用 `stat` 与流式哈希比对，不一致时指出 `target` 并抛错。调用方（`collectHealthReport`、`collectRetrievalBaseline`、`collectAcuBaseline`、`evalset/cli.ts`、`evalset/event-cli.ts`）统一走同一入口。
  验收：新增“篡改一个 raw 文件后 report 抛错并指出 target”的测试（在临时目录构造）；`pnpm check` 通过。

- [x] **M0-FIX-11 依赖声明与文档同步** | 依赖：M0-FIX-2、M0-FIX-7
  完成：2026-11-07 `packages/st-compat` 把 `png-chunks-extract` 与 `png-chunk-text` 声明为运行时依赖，根目录的副本留给快照脚本；`DEPENDENCIES.md` 增加位置列并说明工作区依赖不登记；JSON 类型与 `isJsonObject` 合并到 `packages/core/src/json.ts`，删除 `packages/st-compat/src/json.ts`，`LlmClient` 改用同一守卫；删除零消费者的 `MemoryEvent`；`DESIGN.md` §5 的 `state_diffs` 示例改用 `path`；ADR-0003 记录两个 PNG 库的两个声明位置；TASKS 与 LOG 的测试计数改为 11/10，diff/快照改为 20.8%；门禁通过（225 个测试）
  做什么：`packages/st-compat/package.json` 声明 `png-chunks-extract` 与 `png-chunk-text`（根目录保留给快照脚本的副本或删除），`DEPENDENCIES.md` 区分包内与根目录依赖并说明工作区依赖豁免；`core/src/json.ts` 与 `st-compat/src/json.ts` 只保留一份对象守卫；处理 `MemoryEvent`（删除或在 M2 任务里挂引用）；`DESIGN.md` §5 的 `state_diffs` 字段改为 `path`；ADR-0007 补缓存键包含 `baseUrl`；`HANDOFF.md` 删除未实现的 `sheet_replace` 描述；修正 `TASKS.md` 与 `LOG.md` 里过期的测试计数与 47.8%。
  验收：`pnpm install` 后 `pnpm check` 通过；`git diff` 里的文档数字与当前报告一致；不再有未声明的 import。

- [x] **M0-T99 M0 验收与 M1 准备** | 依赖：M0 全部任务（M0-T11 如果被 HUMAN-01 阻塞，可以跳过，在报告里注明"事件类题目缺失"，等 HUMAN-01 处理完后再补做）
  完成：2026-11-07 全部报告重跑；3 个对话 1222 楼导入为 1279 个节点、2423 条 diff，沿主路径回放与原文快照 0 处差异；结论写入 `docs/dev/reports/M0.md`，ADR-0008 记录实测校准并同步 DESIGN §2、§14 与 M1、M2 任务
  做什么：运行所有报告；在 `docs/dev/reports/M0.md` 里总结：哪些设计假设被数据证实了，哪些被推翻了（推翻的写 ADR 并更新 DESIGN）；逐条审查不变量 I1–I10；确认 M1 的任务清单还适用（不适用就修改）。
  结果写 `MILESTONE_DONE`。

## M1：模型层与单轮生成（DESIGN §9、§10、§11）

- [x] **M1-T01 pi 技术验证** | 依赖：M0-T99 | HUMAN-04 已取消，HUMAN-05 已完成
  完成：2026-11-07 安装并锁定 `pi-ai` 与 `pi-agent-core` 1.5.0；`spikes/pi/` 在真实渠道验证流式（96 个思考增量、24 个正文增量）、思考内容、函数调用、abort 后保留部分正文并续写、三个钩子；Gemini 自定义 baseUrl 确认请求地址，gcli2api 未运行故端到端跳过；结论写入 ADR-0009
  做什么：先用 pnpm 在根目录 devDependencies 安装并锁版本 `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core`（登记到 `DEPENDENCIES.md`，M1-T02 采用后再移到 `packages/core` 的运行时依赖），然后在 `spikes/pi/` 里写最小脚本（先读 node_modules 里的 README 和类型定义）：① 用 openai-completions 加 `.env` 里的渠道：流式输出、思考内容、函数调用；② google-generative-ai 能不能用自定义 baseUrl 指到本地的 gcli2api（服务没运行就跳过，并记录下来）；③ abort 之后保留部分内容，再续写；④ pi-agent-core 的 `prepareRequest`、`beforeToolCall`、`finishTurn` 三个钩子。
  产出：ADR，写明是否采用 pi，以及哪些部分采用。
  验收：每一项的结果都有记录（通过、失败或跳过，并附原因）。

- [x] **M1-T02 core/llm 接口与渠道** | 依赖：M1-T01
  完成：2026-11-07 `packages/core/src/llm` 实现流式事件、用量、中止、截断检测与续写；`data/channels.yaml` 支持多渠道优先级与 `${ENV}` 引用；pi-ai 适配器在真实渠道验证流式与中止后续写；模拟渠道测试覆盖重试、切换、续写、缓存与限速；删除 M0 客户端，事件题改用新接口；门禁通过（241 个测试）
  做什么：定义 `core/llm` 的薄接口（流式事件、用量、中止）；渠道配置（`data/channels.yaml`，密钥用 `${ENV}` 引用 `.env` 里的变量）；同一个模型可以配多个渠道，按优先级自动切换；重试；截断检测（以 length 结束、标签没闭合、内容突然中断）；续写。用 pi 实现这个接口（或者按 ADR 的结论自己实现）。替换掉 M0-T11 的最小客户端：`evalset/event-questions.ts` 迁移到新接口后删除 `packages/core/src/llm/client.ts`，迁移期间保留已有 `eval-private/llm-cache` 的读取，避免重复调用渠道。
  验收：用一个模拟的提供方测试切换、重试和续写的逻辑；事件题生成器的测试改用新接口的假客户端，`pnpm check` 通过。

- [x] **M1-T03 渠道体检** | 依赖：M1-T02
  完成：2026-11-07 `probeChannel` 检测真流式/假流式、函数调用、思考输出、预填充、用量与缓存统计，结果写回 `models.<alias>.probe`；`LlmRequest` 增加工具定义与工具调用结果；`dramaticer probe <channel> [--model <alias>]` 在真实渠道验证（流式、函数调用、思考、用量、缓存统计支持，预填充不支持，缓存命中 5248 token），9 个模拟提供方测试与 1 个 live 测试，门禁通过（250 个测试）
  做什么：CLI 命令 `dramaticer probe <channel>`，检测真流式还是假流式、函数调用、思考输出、预填充、用量和缓存统计，结果写回渠道配置里，供结构化输出选择模式。
  验收：模拟提供方的测试通过；用真实渠道的测试放进 `*.live.test.ts`。

- [x] **M1-T04 原生上下文模板与组装器** | 依赖：M0-T06
  完成：2026-11-07 `packages/core/src/context` 实现结构化模板（静态段、槽位段、`when` 条件）、九个槽位与提供者接口、按优先级整体裁剪 token 预算、按模板顺序输出与逐段 Trace；`createTokenEstimator` 移到 core 并从 st-compat 删除重复实现；15 个组装器测试与 5 个 token 测试，门禁通过（265 个测试）
  做什么：实现 DESIGN §9 的原生模板（静态段、条件段、槽位）、槽位提供者接口、token 预算裁剪（按优先级）、Trace 记录（每一段的来源和 token 数）。
  验收：测试覆盖预算裁剪、条件段、缺失槽位的情况。

- [x] **M1-T05 块解析器** | 依赖：M0-T01
  完成：2026-11-07 `packages/core/src/blocks`：增量解析器（标签前缀缓冲、嵌套、未闭合块、未注册与不配对标签保留为原文）、快照与结束语义、块类型注册表（显示/上下文/语义三类策略声明）与 DESIGN §6 的六个默认原生块类型；14 个测试含 40 组随机切分与一次性解析一致，门禁通过（279 个测试）
  做什么：在 core 里实现增量（流式）的标签块解析器：未闭合的块、嵌套、标签名可以配置、普通文本和块交错出现。块类型在注册表里登记，每种类型声明显示、上下文、语义三类策略的接口（具体策略留到后面实现）。
  验收：用"随机切分输入"的方式测试，结果和一次性解析完全一致。

- [x] **M1-T06 结构化输出双模式** | 依赖：M1-T02、M1-T05
  完成：2026-11-07 `packages/core/src/structured`：`state_update`（path/op/value/reason）与 `plot_note`（text）的 JSON Schema 与工具定义；同一个校验器拒绝未知字段、非法 op、set 缺 value、delete 带 value、空路径与保留路径段，空 reason 归一化为 null；函数调用模式读 `LlmResult.toolCalls`，文本标签模式用 `BlockParser` 只取已闭合块，未闭合、空内容、非法 JSON 都记为带原因的拒绝；两种模式产出相同结构，21 个新测试，ADR-0014，门禁通过（300 个测试）
  做什么：`state_update` 和 `plot_note` 的 schema；函数调用模式（通过 pi）和文本标签模式（通过块解析器）共用同一个校验器；校验失败时的处理策略。
  验收：两种模式产出同样的结构；非法的值会被拒绝，并记录原因。

- [x] **M1-T07 单轮生成 CLI** | 依赖：M1-T03、M1-T04、M1-T06
  完成：2026-11-07 core 新增 `chat` 模块（默认原生模板、历史与状态槽位、`runChatTurn`）、`applyStateDiffs` 与块上下文视图；存储层迁移 v2 增加 `traces` 表与按楼层的 Trace 读写；`dramaticer chat --story <id> --card <path> --user <text>` 走 st-compat 的统一入口（`probe` 委托 core），导入角色卡、组装上下文、流式解析块、按模式处理结构化输出，并把回复、状态 diff 与 Trace 写进楼层树；28 个新测试，真实渠道连续 3 轮对话通过（首字 1855–2529 毫秒），门禁通过（328 个测试）；ADR-0015
  做什么：`dramaticer chat --story <id>`：导入一张卡（通过 st-compat），用一个默认的原生模板组装上下文，流式生成，解析块，处理结构化输出，保存为楼层节点，写入 Trace。
  验收：用真实渠道完成 3 轮对话（live 测试）；Trace 内容完整。

- [x] **M1-T99 M1 验收** | 依赖：M1 全部任务
  完成：2026-11-07 门禁与 live 测试重跑（330 个测试，含真实渠道 3 轮）；首字中位数 1857 毫秒，直连体检 2045 毫秒；Trace 抽查字段完整；结论写入 `docs/dev/reports/M1.md`；M2 条目细化为 `M2-T01` 至 `M2-T15` 与 `M2-T99`
  做什么：同 M0-T99；另外做一次首字延迟对比（和直接调用渠道相比）；把 M2 的条目细化为可执行任务。

## M2：楼层树与记忆引擎（DESIGN §5、§7）

- [x] **M2-T01 楼层树操作与分支指针** | 依赖：M1-T07 | DESIGN §5
  完成：2026-11-07 迁移 v3 给 `stories` 增加 `head_node_id` 与同故事触发器；`appendNode` 在同一事务里移动 head，新增 `setHead`、`getHead`、`getPathToHead`、`swipeNode`、`editNode`、`isNodeConfirmed`；`runChatTurn` 与 `dramaticer chat` 以 head 为父节点，对话导入完成后 head 回到主路径末端；6 个新测试，门禁通过（333 个测试）
  做什么：
  - 迁移 v3：给 `stories` 增加 `head_node_id`（可空，引用 `nodes(id)`）；`appendNode` 在同一个事务里把 head 指向新节点。
  - `setHead(storyId, nodeId)`、`getHead(storyId)`、`getPathToHead(storyId)`。节点不存在、节点属于其他故事、故事不存在都直接抛错。
  - `swipeNode(nodeId, raw)` 与 `editNode(nodeId, raw)`：在节点的父节点下新建同角色的兄弟节点，旧节点保留，新节点成为 head。`raw` 为空或节点不存在时抛错。
  - `isNodeConfirmed(nodeId)`：节点有子节点即为已确认。`appendNode` 创建子节点时父节点自动确认。
  - `runChatTurn` 与 `dramaticer chat` 改用 head 作为父节点，不再使用全局最后插入的楼层。
  验收：swipe 与 edit 生成兄弟节点、旧节点原文不变、head 更新、`getPathToHead` 正确；切到旧分支后路径只含该分支；跨故事与缺失节点抛错；追加子节点后父节点变为已确认；裸连接 UPDATE 楼层原文仍被触发器拒绝；`pnpm check` 通过。

- [x] **M2-T02 状态快照缓存** | 依赖：M2-T01 | DESIGN §5
  完成：2026-11-07 迁移 v4 新增 `state_snapshots` 与同故事触发器；`getStateSnapshot` 由父快照叠加本楼层 diff 计算并缓存，`getStateSnapshotAtHead` 走同一入口；`appendStateDiffs` 在同一事务里删除该楼层与全部后代的缓存；`createStateSlotProvider` 改用快照，Trace 来源格式不变；8 个新测试，门禁通过（341 个测试）
  做什么：
  - 迁移 v4：新增 `state_snapshots(node_id PRIMARY KEY, story_id, state, computed_at)`。
  - `getStateSnapshot(nodeId)`：命中缓存直接返回；否则取父节点快照，叠加本楼层的 diff，用 `applyStateDiffs` 计算后写入缓存。`getStateSnapshotAtHead(storyId)` 是同一逻辑的入口。
  - `appendStateDiffs` 在写入后删除该楼层及其全部后代楼层的快照缓存，避免后代使用过期结果。
  - `createStateSlotProvider` 改用快照，不再每轮从根节点回放；输出格式保持不变。
  验收：随机路径上快照与逐条 diff 回放完全一致；同一节点第二次读取不重新计算（`computed_at` 不变）；追加 diff 后该节点与后代缓存失效；不同分支的快照互不影响；删除型 diff 与 `__proto__` 路径的用例通过；`pnpm check` 通过。

- [x] **M2-T03 后台任务框架** | 依赖：M2-T01 | DESIGN §4、§7、§14
  完成：2026-11-07 迁移 v5 新增 `background_jobs` 与同故事触发器；`enqueueMissingJobs` 只为已确认楼层补建任务且重复调用不产生新行；`drainBackgroundJobs` 通过注册表执行处理器，`attempts` 达 3 次仍未成功标为 `failed` 并保留最后错误；`dramaticer work` 单轮执行并打印统计；15 个新测试，门禁通过（356 个测试）
  做什么：
  - 迁移 v5：新增 `background_jobs(id, story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at, UNIQUE(node_id, kind))`，状态取 `pending`、`running`、`done`、`failed`。
  - 任务类型注册表。`enqueueMissingJobs(storyId)` 扫描已确认节点，为每个尚未入队的类型补建任务；重复调用不产生重复行。
  - `drainBackgroundJobs({storyId, client, kinds, limit, now})`：先补齐任务，再按创建顺序执行；处理器通过注入的注册表获得 `{store, client, job}`；失败时记录错误并按最多 3 次重试，超过后标为 `failed`。后台模型使用 `data/channels.yaml` 的 `background` 别名，限速由现有 `LlmRouter` 负责。
  - `dramaticer work --db <path> [--limit <n>] [--kind <kind>]`：单次执行一轮任务并打印统计，不启动长期进程。
  - `runChatTurn` 不调用后台模型；主循环与后台任务的客户端分开创建。
  验收：已确认节点才会入队；同一节点同一类型只有一行；drain 执行一次处理器后标为 `done`；失败按次数重试后标为 `failed` 并保留最后错误；`--kind` 只执行指定类型；chat 轮次中后台客户端零调用；`pnpm check` 通过。

- [x] **M2-T04 实体与别名表** | 依赖：M2-T01 | DESIGN §7
  完成：2026-11-07 迁移 v6 新增 `entities`（按故事与规范化名称唯一）与 `entity_aliases`（按实体与规范化别名唯一）；`normalizeEntityName` 复用 NFKC、去标点符号空白、大小写折叠；`upsertEntity` 同名合并只补别名，`resolveEntities` 返回同一别名的全部实体；st-compat 导入角色卡与世界书实体并在 chat 启动时合并；7+7 个新测试，门禁通过（370 个测试）
  做什么：
  - 迁移 v6：新增 `entities(row_id, id, story_id, kind, name, normalized_name, description, source, created_at)` 与 `entity_aliases(entity_id, story_id, alias, normalized_alias)`；同一故事内 `normalized_name` 唯一，同一实体内 `normalized_alias` 唯一（ADR-0017）。
  - core 定义 `EntityKind`（`character`、`location`、`item`、`faction`、`lore`、`unknown`）与实体读写接口；名称规范化复用 NFKC、大小写折叠、去空白与标点。
  - `upsertEntity` 合并同名实体与别名；`resolveEntities(alias)` 按规范化后的别名返回实体列表。
  - st-compat 新增角色卡与世界书的实体导入：角色卡的名字作为 `character`，昵称作为别名；世界书条目的 `comment`（没有时用第一个可用主关键词）作为 `lore` 实体名，主关键词作为别名。core 不出现世界书、角色卡等 ST 类型。
  验收：合成角色卡与世界书导入后实体数、别名数符合预期；重复名称与别名合并；全角、大小写、标点差异能命中同一实体；一个别名对应多个实体时返回全部；缺失字段的条目跳过并在导入结果里计数；`pnpm check` 通过。

- [x] **M2-T05 事件抽取** | 依赖：M2-T03、M2-T04 | DESIGN §7
  完成：2026-11-07 迁移 v7 新增只追加的 `memory_events`（`UNIQUE(source_node_id, ordinal)`，触发器拒绝 UPDATE 与 DELETE）；`StoryStore` 新增 `insertMemoryEvents`（整批事务，任一非法回滚）、`getEventsForPath`（路径顺序、limit 与 offset）、`countEventsForNode`；core 新增 `memory` 模块：抽取窗口为任务楼层加前面最多 8 楼，严格校验 JSON 数组的字段、类型、空字符串与 importance 范围，重复执行先查已有事件不再调用模型；`dramaticer work` 默认注册 `events` 处理器；8 个新测试，门禁通过（378 个测试）
  做什么：
  - 迁移 v7：新增只追加的 `memory_events(id, story_id, source_node_id, ordinal, story_time, location, participants, importance, knowers, text, created_at)`，`UNIQUE(source_node_id, ordinal)`；`participants` 与 `knowers` 存 JSON 数组；数据库触发器拒绝 UPDATE 与 DELETE。
  - 后台任务类型 `events`：沿路径取已确认节点及其前面最多 8 楼作为窗口，用 `background` 模型输出 JSON 数组。每条包含 `text`（非空）、`participants`、`knowers`、`importance`（0 到 1）、可选的 `storyTime` 与 `location`。
  - 严格校验：任一字段类型不符、`importance` 越界、数组里出现空字符串时整批不写入，任务记为失败并保留原因；成功后在一个事务里写入该楼层的全部事件。
  - `getEventsForPath(nodeId, options)` 按楼层顺序返回事件；同一楼层重复执行不产生重复行。
  验收：假客户端返回 3 条合法事件时全部写入；包含一条非法事件时整批不写入且任务有错误原因；重跑不重复；`getEventsForPath` 的分页与 limit 正确；触发器拒绝修改与删除事件；`pnpm check` 通过。

- [x] **M2-T06 分层摘要** | 依赖：M2-T03 | DESIGN §5、§7
  完成：2026-11-07 迁移 v8 新增 `summaries`（同故事、级别、起止节点唯一，触发器拒绝跨故事行）；`StoryStore` 新增 `insertSummary`（起点必须是终点祖先、正文非空、token 数由估算器计算）、`isSummaryValid`、`getValidSummaries`（按 head 路径过滤，先章节后主线）、`countConfirmedAssistantNodesOnPath`；core 新增 `memory/summary.ts` 与 `memory/summarize.ts`：章节摘要每 20 个已确认助手楼层触发、窗口为上一章节终点之后的原文，主线摘要每 5 条章节摘要触发、窗口为最近 5 条章节摘要，窗口大小可注入，重跑按已有摘要跳过；`dramaticer work` 默认注册 `summary` 处理器；10 个新测试，门禁通过（388 个测试，ADR-0018）
  做什么：
  - 迁移 v8：新增 `summaries(id, story_id, level, start_node_id, end_node_id, text, token_count, created_at)`，`level` 取 `chapter` 或 `mainline`，同一故事、级别、起止节点唯一。
  - `isSummaryValid(summary, headNodeId)`：起止节点都在 head 的路径上，且起点在终点之前。`getValidSummaries(storyId, headNodeId)` 只返回有效摘要。
  - 后台任务类型 `summary`：每 20 个已确认的助手楼层生成一条章节摘要，覆盖上一章节结束之后的楼层；每 5 条章节摘要生成一条主线摘要。窗口大小做成可注入参数。
  - 摘要请求只使用窗口内的楼层原文，不携带其他分支的内容；写入前校验 `text` 非空、`token_count` 由现有估算器重新计算。
  验收：路径上的摘要有效，切到其他分支后旧摘要失效；章节与主线的唯一约束生效；重复执行不产生重复行；窗口参数变化时范围正确；空窗口不调用模型；`pnpm check` 通过。

- [x] **M2-T07 剧情笔记** | 依赖：M2-T01 | DESIGN §7、§11
  完成：2026-11-07 迁移 v9 新增 `plot_notes`（状态只取 `open`/`fulfilled`，已兑现必须有兑现时间、未兑现必须为空）；`StoryStore` 新增 `insertPlotNotes`（整批校验与写入、正文去两端空白）、`getOpenPlotNotes`（按创建顺序）、`fulfillPlotNote`（只接受未兑现，重复兑现抛错）；触发器允许更新 `status` 与 `fulfilled_at`，拒绝修改正文/来源与删除；`runChatTurn` 在同一事务里保存 `structured.notes`，两种模式共用一条写入路径，结果新增 `plotNotes`；新增 5 个测试覆盖两种模式、兑现、校验、触发器与事务回滚，门禁通过（393 个测试）
  做什么：
  - 迁移 v9：新增 `plot_notes(id, story_id, source_node_id, text, status, created_at, fulfilled_at)`，`status` 取 `open` 或 `fulfilled`。
  - `runChatTurn` 在写入助手楼层的事务里保存 `structured.notes`，每条笔记关联助手楼层；`note` 的文本不可修改，数据库触发器只允许更新 `status` 与 `fulfilled_at`。
  - `fulfillPlotNote(noteId, at)` 只接受 `open` 笔记；`getOpenPlotNotes(storyId)` 按创建顺序返回。
  - 两种结构化输出模式产生的笔记走同一写入路径。
  验收：文本标签模式与函数调用模式各写入一条笔记；`fulfill` 后不再出现在 open 列表；对已兑现笔记再次 `fulfill` 抛错；裸连接修改笔记文本被触发器拒绝；事务失败时助手楼层与笔记一起回滚；`pnpm check` 通过。

- [x] **M2-T08 运行时分块与 BM25 索引** | 依赖：M2-T01 | DESIGN §7、§14
  完成：2026-11-07 迁移 v10 新增 `chunks`（按楼层与序号唯一）与 FTS5 trigram 的 `chunks_fts`；`appendNode` 在写楼层的同一事务里用 `chunkText` 分块、`normalizeRetrievalText` 规范化后写入索引；打开数据库时给尚无块的楼层回填，重复打开不产生重复块；`searchChunks` 用 FTS5 bm25 排序，`beforeNodeId` 通过递归祖先路径过滤，同一楼层多个块只保留分数最高的一块；新增 6 个测试，门禁通过（399 个测试）
  做什么：
  - 迁移 v10：新增 `chunks(id INTEGER PRIMARY KEY, story_id, node_id, ordinal, text)` 与 FTS5 trigram 的 `chunks_fts`；`appendNode` 在同一个事务里用现有 `chunkText` 与 `normalizeRetrievalText` 写入该楼层的块。
  - 迁移完成后对已有楼层做一次回填；回填可重复执行，不产生重复块。
  - `searchChunks(query, {storyId, beforeNodeId, limit})`：`beforeNodeId` 只搜索该节点祖先路径上的楼层，排除该节点自身与其他分支；没有 `beforeNodeId` 时搜索整个故事。
  - 现有离线 `ChunkIndex` 保留给 st-compat 的基线评测；运行时检索只读 `StoryStore` 内的索引。
  验收：一楼的块数与 `chunkText` 一致；分支上的楼层不出现在当前路径的检索结果里；全角文本与带标点查询能命中；同一楼层多个块只占一个结果位次；回填重复运行后块数不变；`pnpm check` 通过。

- [x] **M2-T09 embedding 客户端与向量索引** | 依赖：M2-T03、M2-T08 | DESIGN §7、§13 | 需要 HUMAN-02（已完成）
  完成：2026-11-07 `sqlite-vec@0.1.9` 加载进 `StoryStore`；迁移 v11 按配置维度创建 `chunk_vectors`（vec0，按故事与节点过滤）；`EmbeddingClient` 与 OpenAI 兼容实现（批量、限速、重试、维度校验）接入 `data/channels.yaml` 的 `embeddings` 段；`embeddings` 后台任务只处理缺失向量的块，`searchVectors` 支持祖先路径过滤；16 个单元测试与 1 个真实 bge-m3 live 测试，门禁通过（416 个测试）
  做什么：
  - 新增 `sqlite-vec` 与 `@types`（如果有）；在 `DEPENDENCIES.md` 登记。`StoryStore.open` 加载扩展。
  - core 新增 `EmbeddingClient` 接口与 OpenAI 兼容实现：`/embeddings`、批量、限速、重试、维度校验；配置写进 `data/channels.yaml` 的 `embeddings` 段（`api: openai-embeddings`、`baseUrl`、`apiKey` 环境变量引用、`model`、`dimensions`），`channels.example.yaml` 增加 `bge-m3` 示例，密钥只从 `.env` 读取。
  - 迁移 v11：新增 `chunk_vectors` 的 vec0 表，行号对应 `chunks.id`，维度来自配置（bge-m3 为 1024）。
  - 后台任务类型 `embeddings`：为已确认楼层里还没有向量的块调用 embedding 并写入；同一块不重复调用。`searchVectors(vector, {storyId, beforeNodeId, limit})` 返回最近块。
  验收：假 embedding 客户端下写入、查询与维度校验通过；同一块第二次执行不重复调用；维度不符直接抛错；后台任务失败后按 M2-T03 的规则重试；真实 `bge-m3` 的 live 测试只调用一次并验证 1024 维；默认单元测试零网络；`pnpm check` 通过。

- [x] **M2-T10 多路融合检索** | 依赖：M2-T04、M2-T05、M2-T08、M2-T09 | DESIGN §7
  完成：2026-11-07 core 新增 `retrieval/hybrid.ts` 的 `retrieveMemory`：BM25、向量、实体命中、事件重要度与新近度四路各取前 K（向量路先按楼层去重），用 RRF（常数 60）融合；实体路匹配查询里的名称与别名，召回该实体参与的事件与包含别名的块；空查询返回重要事件与最近块；`limit` 默认 8、限制 1 到 50；7 个新测试，门禁通过（423 个测试）
  做什么：
  - core 新增 `retrieval/hybrid.ts`：输入 `{store, embedder, storyId, query, beforeNodeId, viewpoint?, limit}`，同时取 BM25 块、向量块、实体命中、事件的重要性与新近度。
  - 排名融合使用 RRF（常数 60），每一路先按自己的排序取前 K；实体命中先用别名解析，再召回该实体参与的事件与包含别名的块。
  - 返回 `RetrievalHit`，带 `kind`（`chunk` 或 `event`）、`nodeId`、`score`、`sources`（每一路的排名）。没有向量或没有实体时自动跳过该路，其余路径照常工作。
  - `limit` 默认 8，限制在 1 到 50；空查询返回最近的高重要度事件与最近块。
  验收：固定输入下排序稳定；任意一路缺失时结果仍可用且来源标记正确；实体别名能把相关事件排到前面；`beforeNodeId` 的分支过滤生效；同一节点多个块只保留最高分；`pnpm check` 通过。

- [x] **M2-T11 知情者过滤** | 依赖：M2-T05、M2-T10 | DESIGN §7
  完成：2026-11-07 `retrieveMemory` 返回 `RetrievalResult`（`hits` 加 `filter` 统计）；`viewpoint` 经实体别名归一化后过滤事件，公开与 `"*"` 事件保留；视角存在时跳过全部原文块路（BM25、向量、实体块召回、最近块）；新增 2 个测试，门禁通过（425 个测试）
  做什么：
  - `retrieveMemory` 接受可选 `viewpoint`。没有 `viewpoint` 时作为全知视图返回全部结果。
  - 有 `viewpoint` 时只返回 `knowers` 为空（公开）、包含 `"*"`、或通过别名解析后包含该视角的事件；原文块在没有块级知情者信息时不注入，避免泄露秘密。
  - `knowers` 与视角都先做实体别名归一化；`participants` 与 `knowers` 可以存实体名或别名，读取时解析到同一实体。
  - 返回结果里保留被过滤前的计数，便于 Trace 观察过滤量。
  验收：视角不在 `knowers` 里的事件被排除；公开事件与 `"*"` 事件保留；别名与全名互相匹配；有视角时不返回原文块；没有视角时结果与 M2-T10 一致；`pnpm check` 通过。

- [x] **M2-T12 记忆与摘要的被动注入槽位** | 依赖：M2-T02、M2-T06、M2-T10、M2-T11 | DESIGN §7、§9
  完成：2026-11-07 `createMemorySlotProvider` 以当前楼层原文为查询、只检索其祖先路径，默认 6 条，同一楼层只出现一次，事件命中带事件正文、块命中带上下文视图，来源写 `memory:<条数>`；`createSummarySlotProvider` 取全部有效主线摘要与最近一条章节摘要，按 token 上限从最久远的开始裁剪，来源写 `summary:<级别>`；`dramaticer chat` 接入两个提供者并在配置了 embeddings 时启用向量路；5 个新测试，门禁通过（430 个测试）
  做什么：
  - `createMemorySlotProvider`：在组装上下文时用当前用户楼层之前的路径做 `retrieveMemory`，默认取 6 条，渲染成一条 system 消息；每条带来源楼层 id 与类型（事件或原文块），重复的楼层只保留一次。没有检索结果时返回 `null`，由组装器记为 `missing-slot`。
  - `createSummarySlotProvider`：返回当前 head 下有效的主线摘要与最近一条章节摘要，超出 token 上限时按新近程度裁剪；没有有效摘要时返回 `null`。
  - 默认模板的 `memory` 与 `summary` 段接入这两个提供者；Trace 的来源写成 `memory:<条数>` 与 `summary:<级别>`。
  验收：槽位按 limit 取结果并按路径过滤；重复结果去重；分支切换后失效摘要不再出现；没有结果时记 `missing-slot`；token 上限裁剪生效；单元测试不调用模型；`pnpm check` 通过。

- [x] **M2-T13 世界书与导演的被动注入槽位** | 依赖：M2-T04、M2-T07、M2-T10 | DESIGN §7、§9
  完成：2026-11-07 迁移 v12 新增 `lore_entries`（`(story_id, source)` 唯一，重复导入跳过）；st-compat 新增 `importWorldInfoLore` 与 `importCharacterBookLore`，世界书条目与卡内嵌世界书都转成 lore 条目并关联实体；新增 `createLoreSlotProvider`（常驻必注入、其余按关键词与实体别名命中、同实体或同正文去重、超预算先裁靠后检索条目再裁常驻）与 `createDirectorSlotProvider`（当前分支未兑现笔记、按创建顺序、带楼层年龄）；`dramaticer chat` 支持可重复的 `--world` 并接入两个槽位；11 个新测试，门禁通过（442 个测试）；ADR-0021
  做什么：
  - 迁移 v12：新增 `lore_entries(id, story_id, entity_id, name, content, constant, keywords, source, created_at)`；`keywords` 存 JSON 数组。st-compat 把世界书条目导入为通用 lore 条目，`constant` 与主关键词保留。
  - `createLoreSlotProvider`：常驻条目始终注入；非恒常条目按当前对话做混合检索，只取命中的条目；同一实体或同一内容只出现一次。总 token 超过预算时先删除靠后的非恒常条目，常驻条目最后裁剪。
  - `createDirectorSlotProvider`：把未兑现的剧情笔记按创建顺序渲染成一行一条，带“距创建经过的楼层数”；不调用模型，不做实时决策。没有未兑现笔记时返回 `null`。
  验收：常驻条目每轮都出现；非恒常条目只在关键词或实体命中时出现；重复条目去重；已兑现笔记不出现；楼层年龄计算正确；预算裁剪顺序符合上述规则；`pnpm check` 通过。

- [x] **M2-T14 读取工具与单轮执行器** | 依赖：M2-T10、M2-T12、M2-T13 | DESIGN §10、§11
  完成：2026-11-07 `core/src/tools/read-tools.ts` 定义 `memory_search`、`lore_lookup`、`state_get` 的 JSON Schema、参数校验与执行函数；`core/src/chat/executor.ts` 的 `runModelTurns` 直接在 `LlmStreamingClient` 上执行主请求与最多 2 轮读取工具，只有读取工具会在校验通过后执行，写入工具只收集；`LlmMessage` 支持助手工具调用与工具结果消息，pi-ai 适配器映射成 `toolCall` 与 `toolResult`；`runChatTurn` 在函数调用模式提供全部工具、文本标签模式不提供；Trace 新增 `tools.rounds` 与 `tools.calls`；`dramaticer chat` 把 embedder 交给读取工具并打印工具轮数；11 个新测试，门禁通过（453 个测试）；ADR-0022
  做什么：
  - 新增 `memory_search`、`lore_lookup`、`state_get` 三个读取工具的定义、JSON Schema 与执行函数；`memory_search` 调用 `retrieveMemory`，`lore_lookup` 查 lore 条目与实体，`state_get` 读快照或按路径读值。
  - 接入 pi-agent-core 的无状态单轮执行器：`prepareRequest` 注入已经组装好的上下文，`beforeToolCall` 只允许读取工具并校验参数，`finishTurn` 把工具往返限制在最多 2 轮，`identity` 设为 `{ attribution: null }`。如果 pi-agent-core 的流式接口与现有 `LlmStreamingClient` 无法共存，写 ADR 记录替代实现，验收标准不变。
  - `runChatTurn` 在函数调用模式下执行读取工具循环；文本标签模式不暴露读取工具。`state_update` 与 `plot_note` 仍然只收集，不执行。Trace 增加工具轮数与每次调用的工具名。
  验收：假客户端第一轮调用 `memory_search`、第二轮给出正文，最终正文正确且检索结果进入第二轮请求；最多 2 轮后停止；文本标签模式没有工具定义；写入工具不执行；中止信号在工具循环中生效；`pnpm check` 通过。

- [x] **M2-T15 记忆引擎评测** | 依赖：M2-T08、M2-T09、M2-T10、M2-T11、M2-T12、M2-T13、M2-T14 | DESIGN §14
  完成：2026-11-07 新增 `pnpm --filter @dramaticer/st-compat memory-eval`：导入 3 个对话、实体与 13,818 个块向量，按文本缓存 embedding，`retrieveMemory` 对 386 道题打分并输出每一路、每一路按题型、按对话的成绩；两份报告生成，重复运行数字一致。融合结果：状态题命中@20 32/236（13.6%），事件题命中@5 125/150（83.3%）、命中@20 147/150（98.0%）；状态题 45% 与事件题 @5 88% 未通过，事件题 @20 97% 通过；9 个分对话非回归门槛中 7 个通过，对话 1 与对话 3 的事件题 @5 低于各自 BM25 基线减 2 个百分点。事件表未建立（后台渠道实测约 2.7 次/分钟，1219 次抽取超过 7 小时），报告如实标注；事件题 @5 失败与状态题口径写入 ADR-0023 和 HUMAN-08，M2-T99 被 HUMAN-08 阻塞。
  做什么：
  - 新增 `pnpm --filter @dramaticer/st-compat memory-eval`：把 3 个私有对话导入临时数据库，建立块索引、向量索引、实体表，按需要建立事件与摘要；对 386 道题使用 `retrieveMemory` 计算命中@5、@10、@20，按题型与对话分别统计。
  - 向量生成结果缓存到 `eval-private/memory-cache/`；重复运行不重复调用 embedding 渠道。详细报告写 `eval-private/reports/m2-retrieval.md`，统计版写 `docs/dev/reports/M2-retrieval.md`（只含数字）。
  - 报告同时列出 M0 的 BM25 与 ACU 基线、每一路的单独成绩、融合后的成绩、以及被知情者过滤掉的数量。
  - 达标门槛：事件题命中@5 不低于 88%，命中@20 不低于 97%；每个对话的同一题型不低于各自 BM25 基线减 2 个百分点。状态题按 ADR-0023 改用状态层答案正确率，文本召回的 45% 目标记为未通过并原样报告。
  验收：命令一条完成并生成两份报告；统计版不含原文；数字可由重复运行复现；达标门槛逐条核对并写进报告；`pnpm check` 通过。

- [x] **M2-T99 M2 验收** | 依赖：M2 全部任务 | 状态题口径见 ADR-0023
  完成：2026-11-07 门禁与 live 测试重跑（默认 478 个测试、live 481 个）；状态层答案正确率做进评测管线，236/236 道状态题与标准答案一致，报告新增该节；文本召回 13.6% 与事件题 @5 83.3% 按 ADR-0023 原样报告；I1–I10 逐条核对，结论写入 `docs/dev/reports/M2.md`；确认 M3 任务清单，D-T04 因 HUMAN-07 完成而解除阻塞并排在 M3 之前
  做什么：同 M0-T99；重跑门禁与 live 测试；逐条核对 M2-T15 的分层门槛，状态题按 ADR-0023 用提问楼层的 `getStateSnapshot` 值与标准答案的一致率作为状态层指标，文本召回数字原样保留；复核 I1–I10，重点检查 I5（快照只是缓存）、I6（主循环只有一次主模型调用加最多 2 轮读取工具）、I7、I8、I9；在 `docs/dev/reports/M2.md` 里总结哪些假设被证实、哪些需要调整；确认 M3 的任务清单。
  结果写 `MILESTONE_DONE`。

## D：参照语料与文笔基线（由 INBOX 分拣，排在 M3 之前）

- [x] **D-T01 快照脚本按修改时间取样最新对话** | 依赖：M0-T02
  完成：2026-11-07 快照脚本按每个对话目录里最新的 jsonl 取样，排除 legacy 三个目录，`DRAMATICER_LATEST_CHATS` 默认 4、0 关闭；manifest 每条记录 `corpus`（legacy/latest，预设为 shared）与 `sourceMtime`，`parseSnapshotManifest` 校验并保留这两个字段；重复运行 94 条条目完全一致，legacy 对话、卡、世界书的路径与 sha256 不变；新增 2 个解析测试，评测 CLI 只读 legacy 语料，门禁通过（463 个测试）
  做什么：
  - `scripts/snapshot-private-data.mjs` 增加按文件修改时间取最新 N 个对话的取样方式（`DRAMATICER_LATEST_CHATS` 控制，默认 4，0 关闭），连同对应角色卡与世界书复制进 `eval-private/raw/`，与原有 3 个对话并存。
  - manifest 每条记录语料分组（`legacy` / `latest`）与源文件修改时间；原有 3 个对话的路径与哈希保持不变，重复运行不产生重复条目。
  验收：manifest 两组条目齐全且哈希与目标文件逐一对上；重复运行条目数不变；`git status` 里看不到 eval-private。

- [x] **D-T02 新语料三项统计分栏** | 依赖：D-T01、M0-FIX-7
  完成：2026-11-07 体检、BM25、ACU 按 `corpus` 分栏；旧语料的对话体量、状态存储、重复度数字与上次报告逐项相同；新增语料补出 101 道状态题（1/50/50），1 个单楼对话跳过；事件题请求估算按窗口数统计（新增语料 3 次）；两份报告重新生成，重复运行除生成时间外逐字节相同；7 个新测试，门禁通过（470 个测试）
  做什么：
  - 体检、BM25、ACU 三项统计按语料分组（旧 3 个 / 新增集合）分栏输出，旧数字保持原样可比。
  - 新语料补出状态题（规则生成，不调用模型）；事件题按评测覆盖需要评估，出题成本写进报告，本任务不调用 LLM 出题。
  验收：统计版报告只含数字、不含新的角色名与对话名；两组数字分别列出且重复运行可复现；`pnpm check` 通过。

- [x] **D-T03 参照小说统计脚本与 ADR** | 依赖：无
  完成：2026-11-07 ADR-0024 分离记忆评测与文笔结构度量的数据来源；新增 `reference/text-stats.ts`、`reference/collect.ts`、`reference/cli.ts` 与 `pnpm --filter @dramaticer/st-compat reference`，输出相邻块重复度、句长分布、对话占比、字符与二元组 TTR；公有领域 fixture（论语与唐诗选段，59 块、962 字符）可测；私有报告与统计版已生成，统计版不含版权作品名与原文；8 个新测试，门禁通过（478 个测试）
  做什么：
  - 写 ADR：记忆类评测（状态、事件召回）继续用现有对话；文笔与结构类度量（重复度阈值、句长分布、对话占比、词汇丰富度、伏笔设置与回收）改用小说参照基线；公有领域作品可以进仓库测试数据，版权作品只能放 `eval-private/reference/`，不进提交、测试数据、文档或日志，agent 不联网下载。
  - 新增统计脚本：复用 `packages/st-compat/src/health/duplication.ts` 的重复度计算，输出相邻文本块的重复度曲线、句长分布、对话占比与词汇丰富度；输入为公有领域 fixture 与 `eval-private/reference/` 下人类提供的文件；私有报告写 `eval-private/reports/reference.md`，统计版写 `docs/dev/reports/reference-baseline.md`。
  - 需要人类提供的电子书写进 HUMAN.md。
  验收：脚本在公有领域 fixture 上可测并产出全部四项统计；仓库提交里不出现版权原文；ADR 与 HUMAN 条目录入；`pnpm check` 通过。

- [x] **D-T04 小说参照基线与 Director 阈值** | 依赖：D-T03、HUMAN-07
  完成：2026-11-07 对 5 部参照小说生成每部与汇总分布（相邻块 Jaccard 均值 0.0018–0.0030、P99 0.0387–0.0476；句长均值 22.72–29.68；对话占比 27.0%–37.2%；二元组 TTR 0.2246–0.4791；连续含对白块 P90 6–9、不含对白块 P90 4–8）；新增 bge-m3 相邻块余弦校准（500 对，P99 0.7324）与评测对话同口径对照（582 条助手回复，Jaccard 均值 0.1176，约为小说的 40 倍）；阈值写入 ADR-0025（余弦 0.73、窗口 20、riseWindows 5、climaxFloors 7、breatheFloors 6），统计版不含版权作品名与原文；新增 6 个余弦测试与 2 个统计测试，门禁通过。
  做什么：
  - 对 `eval-private/reference/` 里的作品运行 D-T03 的脚本，得到正常文本的重复度、句长、对话占比与词汇丰富度分布，写进私有报告与统计版。
  - 写 ADR：把上述分布作为 M3 Director 的重复检测阈值与节奏状态机的依据，与现有评测对话的同一组数字并列比较。
  验收：报告含每部作品与汇总的分布；阈值有明确数字来源；统计版不含原文与作品全文引文；`pnpm check` 通过。

## M3：Director（DESIGN §8）——已由 M3-T00 细化

- [x] **M3-T00 细化 M3 任务** | 依赖：无
  完成：2026-11-07 把 M3 细化为 M3-T01 至 M3-T08 与 M3-T99；T01–T05 不依赖参照基线，可以立即执行；T06 重复检测、T07 节奏状态机与 T08 开关对比评测依赖 D-T04（被 HUMAN-07 阻塞），排在其后；T01 的决策记录同时作为 T08 回放的输入。
  做什么：原条目：线索追踪；重复检测（embedding 版）；节奏状态机；NPC 议程（后台任务）；事件池和卡扩展字段 `extensions.dramaticer`；director 槽位；评测（重复度、伏笔回收率，开启和关闭 Director 的对比回放）。重复检测与节奏阈值的任务依赖 D-T04（小说参照基线），按 D-T04 的状态安排实现顺序。

- [x] **M3-T01 Director 决策框架与线索追踪** | 依赖：M2-T07、M2-T13
  完成：2026-11-07 迁移 v13 新增 `director_decisions`（每楼层一行，触发器拒绝跨故事组合与归属修改）；`StoryStore` 新增 `saveDirectorDecision`（upsert）、`getDirectorDecision`、`getDirectorDecisionsAlongPath`；core 新增 `director/`（`DirectorConfig`、`DirectorSuggestion`、`DirectorMechanism`、`evaluateDirector`、默认线索追踪机制），年龄超过 12 楼或未兑现达到 5 条时输出一行建议，年龄优先，不调用 LLM；11 个新测试，门禁通过（497 个测试）
  做什么：
  - 迁移 v13 新增 `director_decisions(node_id PRIMARY KEY, story_id, directive, mechanisms, signals, created_at)`；同一节点重复评估时覆盖旧记录；数据库触发器拒绝跨故事的楼层与故事组合；`StoryStore` 增加 `saveDirectorDecision`、`getDirectorDecision`、`getDirectorDecisionsAlongPath`。
  - core 新增 `director/` 模块：`DirectorConfig`（`enabled`、`clueAgeWarning` 默认 12、`maxOpenClues` 默认 5、`pace` 与 `surprise` 留给后续机制）、`DirectorSuggestion {mechanism, priority, directive, signals}`、`DirectorMechanism {name, evaluate(input)}`；`evaluateDirector({store, storyId, nodeId, config})` 按注册顺序评估全部机制，只选优先级最高的一条建议作为输出，最多一行指令；不调用 LLM。
  - 线索追踪机制只统计当前分支上的未兑现笔记；年龄等于当前路径位置减去笔记来源楼层的位置；最老笔记年龄超过 `clueAgeWarning` 时建议回收；未兑现数量达到 `maxOpenClues` 时建议先回收最老的笔记；没有未兑现笔记时不产生建议。
  - 决策记录的 `signals` JSON 保存未兑现数量、最老年龄与被选中的笔记 id；`mechanisms` JSON 记录每个机制是否触发以及原因。`enabled` 为 true 时每次评估都写入一条记录，没有建议时 `directive` 为 null；`enabled` 为 false 时不评估也不写记录。
  验收：年龄与路径位置计算正确；切换分支后另一分支的笔记不参与；超过年龄与超过数量各产生一条建议；两个条件同时满足时只输出一行且取优先级更高的那条；没有笔记时 `evaluateDirector` 返回 null 且记录里 `directive` 为 null；同一节点重复评估不产生两行；裸连接写入跨故事记录被触发器拒绝；`pnpm check` 通过。

- [x] **M3-T02 导演槽位与用户控制** | 依赖：M3-T01
  完成：2026-11-07 `createDirectorSlotProvider` 改为调用 `evaluateDirector`，有建议时只返回一条以 `【导演】` 开头的 system 消息、来源写 `director:<mechanism>`，无建议或关闭时返回 null；`dramaticer chat` 新增 `--director <on|off>`（默认 on）并注入 `DirectorConfig`，非法取值抛错；默认配置下每次组装写一条决策记录，关闭时不写；4 个 provider 测试与 3 个 CLI 测试，门禁通过（500 个测试）
  做什么：
  - 重写 `createDirectorSlotProvider(store, options)`：调用 `evaluateDirector`，有建议时返回一条以 `【导演】` 开头的 system 消息，`source` 写成 `director:<mechanism>`；没有建议或 `config.enabled` 为 false 时返回 null，由组装器记为 `missing-slot`。
  - 组装上下文时产生的决策写入 `director_decisions`，与 Trace 的 `context` 来源一致；后续机制只注册到同一个评估器，槽位代码不再按机制分别修改。
  - `dramaticer chat` 增加 `--director <on|off>`（默认 on），把 `DirectorConfig` 注入槽位；`runChatTurn` 不改主循环，不增加模型调用。
  验收：开启时未兑现笔记按 M3-T01 的规则出现；关闭时槽位为 `missing-slot` 且没有决策记录；一次组装最多一条导演消息；`dramaticer chat --director off` 不产生导演指令；非法的 `--director` 取值抛错；`pnpm check` 通过。

- [x] **M3-T03 卡扩展 extensions.dramaticer 与事件池存储** | 依赖：M2-T04、M2-T07
  完成：2026-11-07 core 新增 `parseContextCondition` 与严格的 `parseDramaticerCardExtension`（未知字段、重复 id、负冷却、越界重要度、非法条件都带字段路径抛错）；迁移 v14 新增 `event_pool` 与 `npc_agendas`（复合主键、跨故事触发器），`StoryStore` 新增四组读写方法与进度保留语义；st-compat 新增 `importDramaticerExtension` 并在 `dramaticer chat` 导入卡后调用；21 个新测试，门禁通过（521 个测试）
  做什么：
  - core 定义原生扩展类型 `DramaticerCardExtension`，包含 `events` 与 `npcAgendas` 两个数组。事件字段：`id`（故事内唯一、非空）、`text`（非空）、`preconditions`（复用 `ContextCondition`，只允许 `state`、`all`、`any`、`not`）、`cooldown`（非负整数，默认 0）、`enabled`（默认 true）。NPC 议程字段：`npc`（非空名称或别名）、`goal`（非空）、`everyChapters`（正整数，默认 1）、`importance`（0 到 1，默认 0.5）。
  - `parseDramaticerCardExtension(value)` 严格校验：未知字段、类型不符、空字符串、非法条件、重复 `id` 都抛错并指出条目下标与字段路径；没有 `extensions.dramaticer` 时返回空扩展。
  - 迁移 v14 新增 `event_pool(story_id, source_id, text, preconditions, cooldown, source, created_at, PRIMARY KEY(story_id, source_id))` 与 `npc_agendas(story_id, entity_id, goal, every_chapters, importance, progress, last_advanced_node_id, created_at, updated_at, PRIMARY KEY(story_id, entity_id))`；`StoryStore` 增加 `upsertEventPool`、`listEventPool`、`upsertNpcAgendas`、`listNpcAgendas`。
  - st-compat 新增 `importDramaticerExtension(card, store, storyId)`：先解析扩展，再把 NPC 名称或别名解析为实体（找不到实体时抛错并指出 `npc`）；事件按 `(story_id, source_id)` 更新文本、条件与冷却；NPC 议程更新目标、章节间隔与重要度，保留已有 `progress` 与 `last_advanced_node_id`；重复导入不产生重复行。`dramaticer chat` 在导入角色卡之后调用它。
  验收：合法扩展解析出全部字段；未知字段、重复 id、负冷却、越界重要度、找不到实体各抛错并指出位置；重复导入后事件数不变且文本更新、NPC 进度保留；没有扩展时导入返回零计数；`pnpm check` 通过。

- [x] **M3-T04 事件池选择与停滞检测** | 依赖：M3-T01、M3-T03
  完成：2026-11-07 `StoryStore` 新增 `countPlotNotesForNode`；迁移 v15 给 `event_pool` 增加 `enabled`，导入与读写都保留停用标记；core 新增 `director/event-pool.ts`：停滞判定为当前路径最近 3 个已确认助手楼层都没有状态 diff 与新建笔记，条件用当前楼层快照与 `evaluateContextCondition`，冷却读取当前路径决策记录里最近选中的事件，合格事件按上次使用位置与 `source_id` 升序取第一条并用 `(storyId, nodeId, sourceId)` 的 FNV-1a 哈希与 `surprise` 比较，指令直接使用事件正文；决策 signals 以 `eventPool` 键记录检查楼层、候选、跳过原因与选中事件；默认配置增加 `stallFloors=3` 与 `surprise=1`；10 个新测试，门禁通过（531 个测试）
  做什么：
  - `StoryStore` 增加 `countPlotNotesForNode(nodeId)`；core 新增事件池机制：停滞判定为当前路径上最近 `stallFloors`（默认 3）个已确认助手楼层既没有状态 diff，也没有新建剧情笔记；楼层不足或事件池为空时跳过。
  - 事件条件用当前楼层的状态快照与 `evaluateContextCondition` 判定；冷却判定读取当前路径上的 `director_decisions`，同一 `source_id` 在最近 `cooldown` 个楼层内出现过就不再选择。
  - 合格事件按“上次使用位置升序、`source_id` 升序”排序并取第一条；`surprise` 配置用 `(storyId, nodeId, source_id)` 的稳定哈希做门槛，0 表示永不触发，1 表示命中停滞就触发；选中的事件写入决策记录的 `signals`，导演指令直接使用事件正文。
  - 不修改 `event_pool` 表，不调用 LLM；分支切换后另一分支的使用记录不参与冷却。
  验收：最近三个楼层都有状态 diff 或新笔记时不触发；满足停滞后条件成立且冷却结束的事件被选中；条件不成立、冷却未结束、`enabled=false` 的事件被跳过；`surprise` 为 0 和 1 时行为正确；同一路径重复评估选择同一条；另一分支的决策不影响当前分支；`pnpm check` 通过。

- [x] **M3-T05 NPC 议程后台任务** | 依赖：M3-T03、M2-T03、M2-T06
  完成：2026-11-07 core 新增 `memory/npc-agenda.ts`：章节边界与章节摘要一致（已确认助手楼层数为 `chapterSize` 的整数倍），无议程、无到期议程或同一楼层已推进时都不调用模型；每条议程按 `everyChapters` 决定是否在本章节边界推进，名称与别名规范化后匹配，缺项、陌生名称、空进度、重复名称整批抛错；章节输入优先取终点为当前楼层的章节摘要，没有时用上一章节终点之后的原文；`StoryStore.advanceNpcAgendas` 在一个事务里更新进度与 `last_advanced_node_id` 并写入 `与此同时：<progress>` 事件，事件序号接在已有事件之后；迁移 v16 给 `memory_events` 增加 `source`（抽取 `events`、议程 `npc_agenda`），`countEventsForNode` 可按来源过滤，避免议程事件让事件抽取误判为已完成；`dramaticer work` 默认注册 `npc_agenda`；12 个新测试，门禁通过（543 个测试）
  做什么：
  - 新增后台任务类型 `npc_agenda`：只在章节边界执行，判定与章节摘要一致（当前路径已确认助手楼层数是 `chapterSize` 的整数倍，默认 20）；没有 NPC 议程时不调用模型。
  - 每次章节边界用 background 模型发起一次请求，输入为该章节的摘要（没有摘要时用同一窗口的楼层原文）、全部 NPC 的目标与上次进度，输出 JSON 数组，每项 `{npc, progress}`；`npc` 必须匹配一条议程，`progress` 必须非空；缺项、陌生名称、空正文、重复名称都抛错，整批不写入，并按 M2-T03 的规则重试。
  - 成功时在一个事务里更新每条议程的 `progress` 与 `last_advanced_node_id`，并写入一条 `memory_events`，`text` 为 `与此同时：<progress>`，`participants` 写 NPC 名称，`knowers` 写 NPC 名称，`importance` 取议程配置；同一节点重复执行时不新增事件、不重复更新（按 `last_advanced_node_id` 跳过）。
  - `dramaticer work` 默认注册 `npc_agenda` 处理器；`everyChapters` 决定在哪些章节边界推进（默认每隔 1 章）。
  验收：非章节边界执行一次时不调用模型；没有议程时也不调用；合法 JSON 数组写入进度与事件；缺项或陌生 NPC 时整批不写入且任务失败；重复执行同一节点不产生重复事件；`everyChapters=2` 时只在对应边界推进；单元测试使用假客户端，`pnpm check` 通过。

- [x] **M3-T06 重复检测（embedding 版）** | 依赖：D-T04、M2-T09、M3-T01
  完成：2026-11-07 `StoryStore.listChunkVectorsForNode` 按块序号返回 float32 向量；core 新增 `director/repetition.ts`：节拍取已确认助手楼层，楼层向量取块向量平均值，相邻余弦按 ADR-0025 的窗口 20、步长 10、`riseWindows` 5、`riseDelta` 0.02、`riseMinimum` 0.03 与阈值 0.73 判定，缺失向量的楼层跳过并计数；场景序列按可配置 `scenePath` 的状态快照读取，取不到时回退该楼层最近事件的 `location`，连续超过 `sceneRepeatThreshold` 7 时建议换场景；两类信号同时命中时重复度优先（40 高于场景 25），只输出一条指令，所有序列、窗口均值、阈值来源写进 `signals.repetition`；`readStateValue` 从读取工具抽到 `state.ts` 共用；非法窗口、阈值与场景配置在评估时抛错；9 个新测试，门禁通过（552 个测试）
  做什么：
  - `StoryStore` 增加 `listChunkVectorsForNode(nodeId)`，返回每个块的序号与向量；节拍取已确认助手楼层，楼层向量取该楼层全部块向量的平均值，只使用已经生成向量的楼层，缺失向量的楼层跳过并在信号里计数。
  - 相邻节拍的相似度用余弦；窗口与上升规则沿用 `health/duplication.ts` 的语义（连续 `riseWindows` 个窗口均值上升）。窗口 20 对、步长 10、`riseWindows` 5、`riseDelta` 0.02、`riseMinimum` 0.03，绝对阈值取参照余弦 P99 = 0.73（ADR-0025），窗口均值高于阈值且连续上升才触发。
  - 场景类型序列：从可配置的 `scenePath` 读取当前状态值；没有配置或取不到值时，用该楼层最近事件的 `location` 代替；两者都没有时跳过场景检测。同一场景连续出现超过 `sceneRepeatThreshold`（默认 7，参照连续含对白块 P90，ADR-0025）时建议换场景。
  - 两类信号同时命中时按优先级只输出一条指令，`signals` 记录相似度序列、窗口均值、场景序列与阈值来源；不调用 LLM。
  - 向量或场景数据缺失时其余机制照常工作；配置非法（窗口小于 2、阈值不在 0 到 1 之间）在创建评估器时抛错。
  验收：相邻节拍相似度与平均向量计算正确；连续上升超过阈值触发，单个高值不触发；缺失向量的楼层被跳过并计入信号；场景重复触发；两类信号只输出一条；另一分支的楼层不参与；`pnpm check` 通过。

- [x] **M3-T07 节奏状态机** | 依赖：D-T04、M3-T01
  完成：2026-11-07 core 新增 `director/pacing.ts`：张力优先读可配置 `tensionPath`（越界或类型不符抛错），取不到时用最近 3 个已确认助手楼层的状态 diff、新建笔记与最近事件重要度按 0.4/0.3/0.3 加权并截断；阶段按张力与已持续楼层在 `setup`、`escalate`、`climax`、`breathe` 间转移，`pace` 越大需求楼层越少，高潮 7 楼后喘息、喘息 6 楼后回到铺垫；只在阶段变化时输出一条固定指令（优先级 5），阶段、张力与变化点写入 `signals.pacing`，下一轮按当前路径的决策记录恢复，不新增表；默认机制注册在事件池之后；6 个新测试，门禁通过（558 个测试）；ADR-0026
  做什么：
  - 张力值优先读取可配置的 `tensionPath` 状态值（0 到 1）；取不到时用最近 3 个已确认助手楼层推导：状态 diff 数量、新建剧情笔记数量与最近事件重要度的加权和，并截断到 0 到 1；公式与权重写进配置与 ADR。
  - 阶段取 `setup`（铺垫）、`escalate`（升级）、`climax`（高潮）、`breathe`（喘息）。按张力和“距上次阶段变化的楼层数”转移；`pace` 越大，进入升级与高潮所需的楼层数越少；`climax` 持续不超过 `climaxFloors`，之后进入 `breathe`，`breathe` 持续 `breatheFloors` 后回到 `setup`。
  - 每个阶段输出一条固定指令；当前阶段与张力写入决策记录的 `signals`，阶段变化点也记录在同一 JSON 里，后续轮次从当前路径的决策记录恢复状态，不新增表。
  - `climaxFloors` 取 7、`breatheFloors` 取 6（参照连续含对白块与不含对白块的 P90，ADR-0025）；张力阈值取 0.33 与 0.67，按 ADR-0025 说明这不来自小说文本，由 T08 回放检验阶段可达性；没有历史记录时从 `setup` 开始；分支切换后只读取当前路径上的记录。
  验收：四类转移各有用例；`pace` 改变时进入高潮的楼层数按预期变化；`climax` 到期进入 `breathe`，`breathe` 到期回到 `setup`；没有历史时从 `setup` 开始；另一分支的阶段记录不参与；`pnpm check` 通过。

- [x] **M3-T08 Director 开关对比评测** | 依赖：M3-T02、M3-T04、M3-T05、M3-T06、M3-T07、D-T04
  完成：2026-11-07 新增 `pnpm --filter @dramaticer/st-compat director-eval`：3 个 legacy 对话各取 1 个分支点，开启与关闭各 3 次、每次 5 轮，共 18 次回放、90 个生成楼层、0 失败；相邻块 Jaccard 均值 0.0915（开启）对 0.0940（关闭），节拍余弦均值 0.9018 对 0.9053；pacing 触发 9 次并且 9 次被选中，关闭模式 0 条决策记录、0 条导演消息；模型没有输出 `plot_note`，新建/兑现笔记为 0/0，兑现率按无样本记为 `—`；每个对话的 Jaccard 方向不一致（对话 1、2 开启更高，对话 3 开启更低），报告按对话分栏；ADR-0027；9 个新测试，门禁通过（567 个测试）。
  做什么：
  - 新增 `pnpm --filter @dramaticer/st-compat director-eval`：从 `eval-private/raw/` 读取评测对话，按固定间隔选择分支点，用后续真实用户消息回放若干轮；同一分支点分别以导演开启与关闭生成，两种模式各运行 `pairs` 次（默认 3）。
  - 重复度指标复用 `reference/text-stats.ts` 的相邻块统计与 M3-T06 的节拍余弦，分别报告开启与关闭的均值、中位数与分位数；线索回收率统计回放期间新建与兑现的剧情笔记数量、兑现时的平均年龄；同时统计每个机制的触发次数与被选中次数。
  - 单个分支点失败不中断整批，记入失败列表；所有数字可由重复运行复现（生成内容本身不保证一致，报告注明样本数与模型名）。
  - 详细报告写 `eval-private/reports/m3-director.md`，统计版写 `docs/dev/reports/M3-director.md`，只含数字、模型别名与配置，不含原文、角色名与对话名。
  - 用注入的假生成器给回放框架补单元测试；真实渠道的运行记录写进报告与 HANDOFF。
  验收：命令一条完成并生成两份报告；关闭导演时没有导演消息与决策记录；开启时机制触发次数非零；报告给出开启与关闭的重复度分布、线索回收率与机制触发统计；统计版不含原文与私有名称；回放框架的单元测试不访问网络；`pnpm check` 通过。

- [x] **M3-T99 M3 验收** | 依赖：M3 全部任务
  完成：2026-11-07 门禁与 live 测试重跑（默认 567 个测试、live 570 个）；M3-T01 至 M3-T08 逐条核对；I1–I10 通过，重点 I6、I7、I9 有代码与测试证据；重复度“显著低于”未证实（Jaccard 0.0915 对 0.0940、余弦 0.9018 对 0.9053，分对话方向不一致），线索回收率无样本（笔记 0/0），两项如实记录为未达成；结论写入 `docs/dev/reports/M3.md`，ADR-0029；确认 M4 条目
  做什么：同 M0-T99；重跑门禁与 live 测试；逐条核对 M3-T08 的重复度与线索回收率门槛；复核 I1–I10，重点检查 I6（主循环只有一次主模型调用加最多 2 轮读取工具，导演不增加调用）、I7、I9（导演实时决策不调用 LLM）；在 `docs/dev/reports/M3.md` 报告哪些假设被证实、哪些需要调整；确认 M4 的条目。
  结果写 `MILESTONE_DONE`。

## M4：server 骨架与 SSE 对话（T00–T06 已完成；T07 起并入 R5）

- [x] **M4-T00 细化 M4 任务** | 依赖：无
  完成：2026-11-07 把 M4 细化为 M4-T01 至 M4-T20 与 M4-T99：共享类型包、故事设置与模板持久化、重新生成、server 骨架与认证、故事导入、SSE 回合、后台任务、分支与面板接口、渠道管理、web 骨架与聊天、分支、面板、设置与模板、渠道面板、沙箱渲染、Playwright 端到端、自动试玩框架与真实 50 轮。读取工具与 `state_update`、`plot_note` 已在 M2-T14 与 M2-T07 接入主循环，M4 改为端到端核对；`illustrate` 留到 M6。ST 预设转换留在兼容线。兼容线段按 DESIGN §15 的表格移到 M4 之后。ADR-0030。
  做什么：原条目：server（HTTP 加 SSE，默认只监听 127.0.0.1，局域网模式必须设密码）；web（移动端优先：聊天、分支、预设和模板编辑器、记忆面板、状态面板、导演面板、Trace 面板、渠道管理）；沙箱 iframe 渲染器；写入工具和读取工具接入主循环。**试玩验收按 ADR-0028：Playwright 端到端加 LLM 模拟用户至少 50 轮，产出私有报告与统计版报告，作者看统计版确认；不新增 HUMAN 阻塞项。统计版报告按 ADR-0029 增加 Director 机制命中次数、节奏阶段分布、新建与兑现的剧情笔记数、线索兑现率与兑现平均年龄。**

- [x] **M4-T01 共享 API 类型包** | 依赖：无 | DESIGN §13
  完成：2026-11-07 新增 `@dramaticer/protocol`：`story.ts` 的故事视图、请求、路径与树，`settings.ts` 的故事设置与模板记录，`channels.ts` 的脱敏渠道视图与整份配置替换请求，`errors.ts` 的 8 个错误码与统一错误形状，`turn.ts` 的 `TurnRequest`、7 个 SSE 事件名与按事件名分发的联合类型；领域类型全部用 `import type` 引用 core，`verbatimModuleSyntax` 保证擦除；根 `tsconfig.json` 增加项目引用；3 个测试（事件名与错误码唯一性、dist 的 JS 不含 core），门禁通过（570 个测试）
  做什么：
  - 新增 `packages/protocol`（`@dramaticer/protocol`），只放 HTTP 与 SSE 的类型和常量：故事、楼层、路径、树、设置、模板、Trace、状态快照、事件、摘要、剧情笔记、导演决策、实体、lore、渠道脱敏视图、错误包装、SSE 事件联合类型与事件名。
  - 领域类型从 `@dramaticer/core` 只用 `import type` 引用，编译结果不包含 core 的运行时代码；导出 `SSE_EVENT_NAMES` 等常量。根 `tsconfig.json` 增加项目引用，`pnpm check` 覆盖。
  - 工作区类型依赖按现有规则不登记到 `DEPENDENCIES.md`。
  验收：`pnpm check` 通过；`packages/protocol/dist` 里没有 core 的运行时 import；后续 server 与 web 任务可以直接引用这些类型，本任务先由 `tsc -b` 验证。

- [x] **M4-T02 故事运行配置与模板持久化** | 依赖：M1-T07、M2-T01 | DESIGN §5、§9
  完成：2026-11-07 迁移 v17 新增 `story_settings` 与 `context_templates`；`StoryStore` 新增设置读取（缺失返回默认值）、合并更新与模板 CRUD，校验枚举、数值范围、模板结构与 `director_config`，内置模板可直接引用、被引用的模板拒绝删除；core 新增 `createCharacterSlotProvider` 与 `createStandardChatProviders`，st-compat 的 `createChatProviders` 改为薄包装；`importCardContent` 返回 `{characterPrompt, cardName}`，`dramaticer chat` 导入后写入设置，之后的运行可省略 `--card`，故事设置里的模板优先于内置模板；protocol 的设置类型改为从 core 复用；12 个新测试，门禁通过（582 个测试）
  做什么：
  - 迁移 v17 新增 `story_settings(story_id PRIMARY KEY REFERENCES stories(id), card_name, character_prompt, persona, template_id, model, budget_tokens, structured_output, temperature, max_tokens, reasoning, viewpoint, director_config, updated_at)` 与 `context_templates(id PRIMARY KEY, name UNIQUE, template, created_at, updated_at)`；`template_id` 可空，空表示内置默认模板。
  - `StoryStore` 新增 `getStorySettings`（缺失时返回默认值）、`updateStorySettings` 与模板 CRUD；枚举、数值范围、模板 JSON 与 `director_config` 在这里校验。
  - core 新增 `createCharacterSlotProvider(characterPrompt)` 与 `createStandardChatProviders({store, characterPrompt, embedder, directorConfig, mechanisms})`；st-compat 的 `createChatProviders` 改为薄包装。
  - `importCardContent` 返回 `{characterPrompt, cardName}`；`dramaticer chat` 导入后写入故事设置，后续组装优先读库里的提示词；没有设置时回退到 `--card`。
  验收：重启数据库后设置与模板仍在；非法结构化输出模式、负预算、空模板抛错；内置默认模板可被故事引用；导入卡后不需要卡文件就能组装上下文（假客户端）；现有 chat 测试不回归；`pnpm check` 通过。

- [x] **M4-T03 重新生成助手楼层** | 依赖：M1-T07、M2-T01 | DESIGN §5
  完成：2026-11-07 从 `runChatTurn` 抽出 `generateAssistantTurn` 与 `regenerateAssistantTurn`；重新生成在父用户楼层下新建兄弟节点并移动 head，旧楼层与旧 Trace 不变；3 个新测试覆盖兄弟节点、父节点校验、函数调用模式工具轮次，门禁通过（585 个测试）
  做什么：
  - 从 `runChatTurn` 抽出 `generateAssistantTurn`：接收现有用户楼层 id，不再追加用户楼层；组装上下文、生成、解析块、写状态 diff 与笔记、写 Trace 都在新助手楼层上完成。
  - `regenerateAssistantTurn(assistantNodeId)` 找到父用户楼层，用父楼层 raw 作为本轮输入，在父节点下新建助手兄弟节点并把 head 移过去；旧节点原文不变。
  - `runChatTurn` 改为先追加用户楼层再调用 `generateAssistantTurn`，现有 CLI 行为不变。
  验收：重新生成产生兄弟节点、旧节点与旧 Trace 不变、head 正确；父节点不是用户楼层时抛错；函数调用模式仍只有一次主调用与最多 2 轮读取；状态 diff、笔记与新 Trace 写在新楼层；`pnpm check` 通过。

- [x] **M4-T04 server 骨架、认证与静态资源** | 依赖：M4-T01 | DESIGN §13
  完成：2026-11-07 新增 `packages/server`（`node:http`，无 Web 框架）与 `dramaticer-serve` 入口（`--db`、`--port`、`--host`、`--channels`、`--web`）；非回环无 `DRAMATICER_SERVER_PASSWORD` 拒绝启动，登录用 `timingSafeEqual` 校验并发放内存会话 cookie，除健康检查与登录外全部要求会话，非读取方法校验 `Origin`；JSON 上限 25 MB 返回 413，统一错误形状，日志不写正文与会话；静态资源按扩展名给 MIME，realpath 包含判断拒绝路径穿越与符号链接逃逸，找不到文件回退 `index.html`；21 个新测试与 CLI 冒烟，门禁通过（606 个测试）
  做什么：
  - 新增 `packages/server`（`@dramaticer/server`），使用 `node:http`，不引入 Web 框架；提供 `dramaticer-serve` 入口，参数 `--db`、`--port`（默认 8787）、`--host`（默认 127.0.0.1）、`--channels`、`--web`。
  - 绑定非回环地址且没有设置 `DRAMATICER_SERVER_PASSWORD` 时拒绝启动；设置密码后 `/api/login` 用 `timingSafeEqual` 校验，成功后发 `HttpOnly; SameSite=Strict` 会话 cookie（内存会话表），除 `/api/health` 与 `/api/login` 外全部要求会话；状态变更请求校验 `Origin`。
  - JSON 请求体上限 25 MB（角色卡 base64），超限 413；统一错误形状 `{error:{code,message,details?}}`；日志不输出请求正文、cookie 与密钥。
  - 静态资源服务 `packages/web/dist`：MIME 正确，拒绝 `..` 与符号链接逃逸，找不到文件时回退 `index.html`。
  验收：非回环无密码启动失败；错误密码 401、正确密码后可访问；无会话的 `/api` 401；超大请求 413；路径穿越被拒绝且读不到仓库外文件；`pnpm check` 通过。

- [x] **M4-T05 server 故事、导入与设置接口** | 依赖：M4-T04、M4-T02 | DESIGN §13
  完成：2026-11-07 新增 `src/routes.ts`：故事 CRUD（`GET/POST /api/stories`、`GET/PATCH /api/stories/:id`）、导入（`POST /api/stories/:id/import`，JSON 或 PNG base64 卡加可选世界书，事务内导入实体、lore、`extensions.dramaticer` 与设置）、设置（`GET/PUT .../settings`）与模板 CRUD；`importCardContent` 返回实体、lore、事件与 NPC 议程计数；存储层新增 `updateStoryTitle` 与 `findStoryUsingContextTemplate`；错误带 `details.path`，未知故事/模板 404，重复故事/模板名与仍被引用的模板 409；9 个新测试，门禁通过（615 个测试）
  做什么：
  - 故事：`GET/POST /api/stories`、`GET/PATCH /api/stories/:id`。
  - 导入：`POST /api/stories/:id/import`，JSON 里带角色卡（PNG 的 base64 或 JSON）与可选世界书；用 st-compat 解析并导入实体、lore、`extensions.dramaticer` 与故事设置；同一张卡重复导入只补缺失内容。
  - 设置与模板：`GET/PUT /api/stories/:id/settings`、`GET/POST /api/templates`、`GET/PUT/DELETE /api/templates/:id`；删除仍被故事引用的模板返回 409。
  - 所有输入错误返回 400 与字段路径，未知故事 404；响应使用 protocol 类型。
  验收：合成卡与世界书导入后实体、lore、设置正确；重复导入不重复；非法模板 JSON 与设置枚举 400；测试只用 fixture；`pnpm check` 通过。

- [x] **M4-T06 server 运行时与 SSE 对话** | 依赖：M4-T05、M4-T03、M4-T02 | DESIGN §10、§11
  完成：2026-11-07 新增 `runtime.ts`：`StoryRuntimeManager` 按故事缓存正文、后台与 embedding 客户端、模板和槽位提供者，缓存键是设置 `updatedAt` 与渠道配置指纹；`sse.ts` 输出事件帧与心跳；`turns.ts` 提供按故事互斥的 `TurnCoordinator` 与 `POST /api/stories/:id/turns`，节流 `blocks.replace`；执行器中止时抛出带部分正文的 `TurnAbortedError`，聊天层保存部分助手楼层并写 `aborted` Trace；服务端关闭先中止回合并等待写完；7 个新测试（含心跳与日志不含正文），ADR-0032，门禁通过（623 个测试）
  做什么：
  - `StoryRuntime`：按故事设置建正文客户端、embedding 客户端、模板与槽位提供者；设置或渠道配置变化后失效；正文与后台客户端分开。
  - `POST /api/stories/:id/turns` 返回 `text/event-stream`：`turn.started`、`text.delta`、`thinking.delta`、`blocks.replace`（节流 100 毫秒与结束时各一次）、`tool.call`、`turn.completed`（用户与助手楼层、状态 diff、笔记、用量、Trace 摘要、首字毫秒）、`turn.error`；每 15 秒心跳注释。
  - 每个故事同时只允许一个回合，冲突 409；客户端断开触发 `AbortController`，已生成内容写入助手楼层并记录中止；服务端关闭中止全部回合。
  - 一次回合只调用一次主模型；读取工具最多 2 轮；`state_update` 与 `plot_note` 在同一回复里收集并写入；文本标签模式不提供工具。
  验收：假渠道下事件顺序与终态正确；增量按顺序到达；断开后上游中止且部分内容保留；并发第二轮 409；同一回合主模型调用次数与工具轮次符合上限；日志不含正文与密钥；`pnpm check` 通过。

- **M4 说明**：M4 只保留已完成的 T00–T06；T07 起的未开始任务已按 ADR-0033 并入 R5，编号改为 R5-T01 起。

## R0：v2 迁移（INBOX 分拣）

- [x] **R0-T01 合并 v2 设计提案** | 依赖：无
  完成：2026-11-07 ADR-0033 记录采纳理由与决定；`docs/DESIGN.md` 升为 v0.2（台账、双回合、Director v2、评测基线、路线图、明确不做与待验证事项全部改写）；TASKS 新增 R1–R7，R1 与 R2 已细化，M4-T07 起移入 R5；INBOX 条目清空；门禁通过
  做什么：
  - 写 ADR，记录采纳 `docs/proposals/v2.md` 及其原因（提案第〇节与 M2、M3 报告）。
  - 把提案合并进 `docs/DESIGN.md`：回合模式、台账、记忆、Director、评测与路线图；被取代的旧内容删除或注明已被取代。
  - 改写 `docs/dev/TASKS.md`：M4 尚未开始的任务移入 R5，新建 R1–R7，R1 与 R2 细化为具体任务。
  - AGENTS.md 的不变量已由人类改好，不改。
  验收：ADR 入库；DESIGN 与提案一致且不再保留冲突内容；TASKS 可从 R1-T01 继续；INBOX 已清空；`pnpm check` 通过。

- [x] **R0-T02 合并 v2.1 补充提案** | 依赖：R1-T01
  完成：2026-11-07 ADR-0035 按三分法合并；A1–A9 全部落成任务（A9 为 R1-T01.b，A4/A5 在 R1-T04.b 之前，A7/A8 进 R3-T00），X1/X2 排在 R2-T99 之后，暂缓项进 DESIGN §18；DESIGN §7.1/§7.3/§9/§10/§14.4/§15/§17、TASKS 与迁移编号（v18–v24）同步
  做什么：
  - 写 ADR-0035，记录采纳 `docs/proposals/v2.1.md` 与“直接采纳 / 用评测决定 / 暂缓”的三分法。
  - 把 A1–A9 合并进 `docs/DESIGN.md` 对应章节，并转成任务：A4 父子分块（R1-T03.a）与 A5 重排序（R1-T03.b）排在 R1-T04.b 之前；A7 深回合工具与 A8 运行中追加要求写进 R3-T00 的细化说明；A9 按岗位配置模型作为 R1-T01.b 建在配置层，供 R1-T02 与 R2 的裁判共用；A1 现场分析（R1-T02.a）、A2 上下文包复用（R1-T08）、A3 自然语言修订记忆（R1-T07.a）、A6 评测补充（R2-T03.a、R2-T04.a）各自建任务并写清依赖。
  - 在 R2-T99 之后新增实验任务 X1（世界模型表示方式）与 X2（Director 组织方式），写清候选方案、评测指标与“只有显著胜出才切换”的规则。
  - 第三节“暂缓”的内容写进 DESIGN 的“后续方向”，不建任务。
  验收：ADR 入库；DESIGN 与 v2.1 一致；A1–A9 都有对应任务且 A4/A5 在 R1-T04.b 之前；X1 与 X2 在 R2-T99 之后；INBOX 条目清空；`pnpm check` 通过。

- [x] **R0-T03 合并 v2.2 补充提案** | 依赖：R0-T02
  完成：2026-11-07 ADR-0036 合并 v2.2：D1–D5 进 DESIGN §10.1 与 R3-T00 的细化说明，D6 与第三节三项进 §18；应用内助手写入 §10.3 并取代侧边 agent；新增 E-T01（R2-T99 之后）与 H-T00（R5-T99 之后）；R5-T05 增加虚拟列表与分页读取验收；门禁通过（629 个测试）
  做什么：
  - 写 ADR-0036，记录采纳 `docs/proposals/v2.2.md`；外部参考只借鉴设计，不复制 AGPL-3.0 代码。
  - 深回合要点 D1–D5 写进 DESIGN §10.1 与 R3-T00 的细化说明：草稿与提交分开、导演手记按楼层存 diff、运行日志并入 Trace、模板附带深回合配置、原生元数据保真（尤其 Gemini 思考签名）并有工具循环测试与中转渠道实测。
  - D6 的 `SKILL.md` 技能格式写进 DESIGN §18，不建任务。
  - 应用内助手一段写进 DESIGN：与正剧隔离，复用深回合运行时，类型化 server 接口，权限分三级，影响剧情的修改走变更卡。排障技能先做命令行版本，建任务排在 R2 之后；完整助手排在 R5 之后并取代 R7 的侧边 agent 条目。
  - 第三节三项（本机 embedding 备选、上千楼虚拟列表、多设备同步）写进 DESIGN §18，不建任务。
  验收：ADR 入库；DESIGN 与 v2.2 一致；D1–D5 在 R3-T00 说明里；排障命令行与完整助手各有一个任务且位置正确；R7 的侧边 agent 描述改为被取代；`pnpm check` 通过。

- [ ] **R0-T04 合并 v3 插件系统提案** | 依赖：无
  做什么：
  - 读 `docs/proposals/plugins.md`（人类 2026-11-07 确认，标注“并入 v3”），写一条 ADR 记录采纳：参照 Cordis（MIT 上游）的 Context、插件生命周期、事件分发、服务、玩法包（profile 补丁层）五个概念，对外只暴露 Dramaticer 自己定义的类型。
  - 把提案内容写进 `docs/DESIGN.md`：插件系统章节（Context 与插件注册表、第二节的扩展点与分发模式、两档插件、清单与玩法包、卡片依赖、插件市场），以及第七节的三条新不变量；原有不变量 I4、I9、I12 对插件的约束写清楚。
  - 在 TASKS 新增 P1–P5：P1 技术验证（直接依赖 Cordis 与自研精简版的比较，写 ADR）、P2 内核改造（内置槽位、Director 机制、块类型、后台任务、工具逐个改成插件，每步门禁与评测不退化，和 R3 并行或紧随其后）、P3 声明式插件格式与卡片打包、P4 代码插件（权限清单、worker 隔离、安装更新）、P5 应用内插件市场。写清各阶段的依赖与位置。
  - ST 生态兼容的四个插件（`st-content`、`st-mvu`、`st-ejs`、`st-helper-host`）已按 ADR-0038 落为 C-T02–C-T05，顺序 P-A → P-C → P-B → P-D，依赖 P2；P-E `st-classic-ui` 已取消。本任务只负责插件内核，不重复建立兼容插件任务。
  - 提案第七节说新不变量要进 DESIGN，AGENTS.md 是否加入由人类决定：在 HUMAN.md 新增一条请人类确认，不修改 AGENTS.md。
  验收：ADR 入库；DESIGN 与提案一致；P1–P5 都有任务且顺序符合提案第六节；兼容插件任务已存在且依赖 P2；HUMAN.md 有 AGENTS.md 不变量确认条目；`pnpm check` 通过。

- [ ] **R0-T05 归档已完成任务** | 依赖：无 | ADR-0041（A11）
  做什么：
  - 把 `docs/dev/TASKS.md` 里已完成的里程碑（M0–M4、D、R0 的已完成项与 F0 已完成项）整段移到 `docs/dev/TASKS-archive.md`，HISTORY 内容一字不改；TASKS.md 只保留未完成任务、进行中任务与当前阶段的细节。
  - TASKS.md 顶部保留状态标记说明、选任务规则与阶段目录，并指向归档文件；HANDOFF 与 LOG 里对已完成任务细节的引用改成指向归档。
  验收：TASKS.md 不再逐条包含已完成任务；归档文件保留原文与完成记录；两个文件里的任务编号与状态一致；`pnpm check` 通过。

## R1：世界模型（台账与记忆）

> F0 取证完成并给出路线建议之前，不选本节及之后的任务（ADR-0037）。

- [x] **R1-T01 台账结构与 MVU 映射** | 依赖：M2-T02、M2-T04、M4-T02 | DESIGN §5、§7.1
  完成：2026-11-07 `packages/core/src/ledger` 定义九个命名空间与路径表，`validateLedgerDiff` 校验路径、类型、范围与线索状态，`readLedger` 与 `listLedgerEntities` 复用状态快照；st-compat 导入 MVU 时加 `mvu` 前缀；ADR-0034；门禁通过（629 个测试）
  做什么：
  - core 定义台账命名空间与类型：`character`（主演与龙套两级）、`relation`（有方向、类型、阶段、好感内在与外在五档、惯性）、`item`（持有者、位置、来历、变动日志）、`scene`（地点树与当前现场）、`time`（故事内时间锚点）、`clue`（开启、推进、兑现）、`knowledge`（谁知道什么）、`userWill`（偏好、底线、纠正）、`mvu`（MVU 命名空间）。全部用现有 `StateDiff.path` 表达，不新增第二套存储。
  - `validateLedgerDiff` 校验命名空间、路径段非空、值的类型与范围、线索状态（只允许开启、推进、兑现）；非法条目抛错并指出字段路径。
  - `readLedger(store, nodeId, prefix?)` 读节点快照并按前缀取子树；`listLedgerEntities` 返回人物与关系、未兑现线索；读取复用 M2-T02 的快照，不新增表。
  - st-compat 导入 MVU 快照时把路径映射为 `["mvu", ...]`；没有 MVU 的卡不生成 `mvu` 命名空间；评测数据库由 raw 重建，不做旧库迁移。
  验收：九个命名空间各有一条通过校验的 diff；未知命名空间、空路径段、错误值类型、非法线索状态各抛错并指出位置；MVU 快照导入后沿路径回放与原文一致；`readLedger` 前缀读取与分支切换正确；`pnpm check` 通过。

- [x] **R1-T01.a 台账事实补 storyTime 与 source** | 依赖：R1-T01 | DESIGN §7.1、ADR-0035
  完成：2026-11-07 迁移 v18 给 `state_diffs` 增加 `story_time_start`/`story_time_end`；`StateDiff` 增加 `storyTime`，存储层把起止都为空归一为 null；`validateLedgerDiff` 校验 `source` 四值与 `storyTime` 形状；新增 `readLedgerFacts` 读回事实及其元数据，`readLedger`/`listLedgerEntities` 值视图不变；正文模型的结构化写入来源改为 `model`；后续 R1 迁移编号顺延到 v19–v25；门禁通过
  做什么：
  - 按 v2.1 第二节，把 `storyTime`（事实成立的故事时间段，起止都可空）与 `source`（`model`、`settler`、`player`、`import`）作为每条台账事实的元数据；`storyTime` 进入存储，`source` 与现有 `StateDiff.source` 的关系写清楚。
  - `validateLedgerDiff` 校验两个字段的类型与来源取值；导入 MVU 的事实来源为 `import`。
  - `readLedger` 与 `listLedgerEntities` 能读回这两个字段；已有 R1-T01 路径表与快照语义不变。
  验收：九类台账事实都能带两个字段并读回；来源取值非法时抛错并指出位置；旧路径与快照回放结果不变；`pnpm check` 通过。

- [ ] **R1-T01.b 渠道按岗位配置** | 依赖：M1-T02 | DESIGN §10.2
  做什么：
  - `data/channels.yaml` 增加 `roles` 段：`writer`（正文）、`settler`（结算与抽取）、`planner`（导演与条件判断）、`judge`（评测裁判），每个角色指向一个已有模型别名；`channels.example.yaml` 补示例。
  - core 提供按角色解析的入口：`runChatTurn` 用 `writer`，结算与抽取用 `settler`，导演与条件判断用 `planner`，评测裁判用 `judge`；缺省时 `writer` 回落到 `main`，其余回落到 `background`。Trace 记录角色与实际渠道。
  - 创建路由时校验 `judge` 与 `writer` 的模型家族不同：由模型名映射家族（映射不到的按完整模型名比较），不比较 `baseUrl`（所有模型都经过同一个本地网关）；相同则直接失败并指出两个角色，不自动替换。
  验收：四个角色各自解析到配置的模型别名；缺省回落正确；`judge` 与 `writer` 同模型家族时创建路由抛错并指出角色；`baseUrl` 相同但模型不同不报错；Trace 里有角色与渠道；`pnpm check` 通过。

- [ ] **R1-T01.c 生成长度默认值与截断统计** | 依赖：M4-T02、R1-T01.b | DESIGN §10.2 | ADR-0041（A6）
  做什么：
  - 故事设置 `maxTokens` 的默认值改为 4096 与 writer 模型在 `data/channels.yaml` 里声明的 `maxTokens` 中较小的一个；已保存的故事设置不改。
  - 截断检测结果（以 length 结束、标签未闭合、正文突然中断）写进 Trace；不自动续写到设置上限之外。
  - R2-T02 的试玩记录与 R2-T06 的记分牌新增截断率。
  验收：默认值按渠道声明计算并有测试（渠道声明大于、小于 4096 两种）；三种截断都能在 Trace 里读到；`pnpm check` 通过。

- [ ] **R1-T02 台账结算器** | 依赖：R1-T01、R1-T01.a、R1-T01.b、R1-T01.c、M2-T03、M4-T03 | DESIGN §7.2 | I12 | ADR-0041（A2、A4、A5）
  做什么：
  - 迁移 v19 新增 `ledger_settlements(node_id PRIMARY KEY, story_id, source, added_count, repairs, created_at)`；`repairs` 存 JSON 数组 `{path, action, reason}`，同故事触发器与 M2-T02 的一致。
  - 迁移 v20 新增 `entity_candidates(story_id, normalized_name, kind, hits, first_node_id, created_at)` 并给 `state_diffs` 增加结算置信度列（0 到 1，空表示未结算）；`validateLedgerDiff` 校验置信度范围。
  - 后台任务类型 `settle`：沿当前路径取最多 `settleWindowFloors`（默认 4）个已落定、尚未结算的助手楼层；已落定指正文生成完成，不要求已确认。一次请求返回 `{nodeId, diffs}` 数组。窗口内有解析失败或校验失败的条目时，该楼层整条拒绝并记入 `repairs`，其余楼层照常写入；整次请求失败按 M2-T03 的规则重试。
  - 落定即结算：回复落定后对 head 结算，被放弃的节点保留结算结果但不参与当前路径。后台任务框架按任务类型声明落定条件，不再统一要求已确认。
  - 输入顺序：本楼层已有的结构化写入（`state_update`、原生块，兼容插件开启时还有 MVU 与表格编辑）→ 校验与修复 → 只对缺失的路径调用模型。该楼层已有的写入优先，结算器跳过相同路径。修复动作限定为补值、删除非法条目、改写线索状态三种，修复原因进入 `repairs` 与 Trace。
  - 实体解析：写入前把人物、地点、物品的名称对照实体与别名表规范化；不认识的名称进 `entity_candidates`，同一窗口出现两次以上或被模型直接写入时才建档。`knowledge` 的值为 `{factId, text}`，`factId` 指向事件或线索，同一 `factId` 不重复写入。
  - 冲突处理：与最近 `conflictWindowFloors`（默认 6）楼原文矛盾的结算事实不覆盖已有值，拒绝写入并记入 `repairs`；R1-T07.a 把这些记录转成待审变更卡。
  - 原生模板新增可选的 `block_format` 段，说明 `state_update` 与 `plot_note` 的格式，默认关闭；开启后只说明格式，不要求模型输出（I13）。
  - 写入在一个事务里完成；同一楼层重复结算不新增 diff；结算结果与楼层绑定，swipe 与编辑的新节点各自结算。
  - 结算在间隙执行，`generateAssistantTurn` 不等待它；没有后台客户端时任务保持 pending。
  验收：模型写入的路径不被覆盖，缺失路径被补齐；非法条目被拒绝并记录原因；不认识的名称两次出现后建档、只出现一次不建档；`knowledge` 按 `factId` 去重；与原文冲突的事实不覆盖并记入 `repairs`；重复执行不产生重复行；分支切换后另一分支的结算不参与；`block_format` 关闭时模板与现在逐字节一致；回合内后台客户端零调用；`pnpm check` 通过。

- [ ] **R1-T02.a 现场分析** | 依赖：R1-T02 | DESIGN §7.3、§9 | ADR-0041（A2）
  做什么：
  - 迁移 v21 新增 `scene_analyses(node_id PRIMARY KEY, story_id, text, token_count, created_at)`，同故事触发器与 M2-T02 一致。
  - 后台任务 `scene`：读投机结算后的台账快照与最近 `sceneWindowFloors`（默认 6）楼原文，由 `settler` 角色输出一小段，写明在场人物各自想要什么、知道什么、张力在哪里；长度按 token 估算器控制；同一楼层重复执行覆盖同一行。现场分析不落后一楼：读的是本楼层的结算结果，结算尚未完成时任务保持 pending。
  - 新增 `scene` 槽位提供者，取当前路径上最近一条分析；没有时槽位为空并在 Trace 里标注缺失；注入位置在历史之后、导演之前。
  - 分析在间隙执行，回合内不调用模型；结果不写台账，也不修改楼层原文。
  验收：假客户端执行一次任务后分析入库；同一楼层重跑不新增行；结算未完成时任务保持 pending；槽位取最近一条且分支切换后不跨分支；回合内后台客户端零调用；空窗口不调用模型；`pnpm check` 通过。

- [ ] **R1-T03 批量事件抽取** | 依赖：R1-T02、M2-T05 | DESIGN §7.3
  做什么：
  - 把 `events` 任务从逐楼抽取改为批量窗口：一次请求处理最多 `eventWindowFloors`（默认 8）个沿当前路径连续、尚未抽取的已确认助手楼层；输入包含窗口内原文与前后各一楼作为边界上下文。
  - 模型返回 `{nodeId, events}` 数组，每条事件沿用 M2-T05 的字段与校验；`nodeId` 必须在窗口内，未知楼层或重复楼层整窗拒绝并记录原因。
  - 事件仍按 `source_node_id` 写入只追加表；窗口内任一楼层非法时整窗不写入并按任务框架重试；重跑不产生重复行。
  - 事件窗口与结算窗口互不阻塞，两者都使用后台客户端与独立限速。
  验收：8 个楼层只发一次请求；事件归属到正确的楼层；未知或重复 `nodeId` 整窗拒绝；重跑无重复；窗口跨越分支时只取当前路径；单元测试用假客户端且零网络；`pnpm check` 通过。

- [ ] **R1-T03.a 父子分块** | 依赖：M2-T08、M2-T10 | DESIGN §7.3
  做什么：
  - 迁移 v22 给 `chunks` 增加父段字段（`parent_ordinal`、`parent_text`）：父段按段落边界切分，过长的段落退化为整楼；检索只匹配小块，命中后返回父段文本。
  - 打开数据库时按新规则重建块，旧块与对应向量一并删除；`embeddings` 任务随后补齐缺失向量。回填可重复执行，不产生重复块。
  - `searchChunks` 与 `searchVectors` 返回父段文本；多路融合按楼层去重时保留父段文本，Trace 记录注入的是整段还是整楼。
  验收：小块命中后返回父段；同一父段多个小块只占一个结果位次；回填重复运行后块数不变；旧向量被清理且不参与查询；`pnpm check` 通过。

- [ ] **R1-T03.b 重排序** | 依赖：R1-T03.a、M2-T10 | DESIGN §7.3
  做什么：
  - 新增 `RerankClient`（OpenAI 兼容 `POST /rerank`，批量、限速、重试），渠道写在 `data/channels.yaml` 的 `reranker` 段（硅基流动 bge-reranker），密钥只从 `.env` 读取；`channels.example.yaml` 补示例。
  - `retrieveMemory` 融合后取前 `rerankCandidates`（默认 20）交给重排序，再取最终 top-K；`memory_search` 与 M2-T12 的槽位共用同一入口。
  - 开关默认关闭；用 R1-T04.b 的记忆评测决定，事件题与状态题都没有下降且有提升才在默认配置打开，结论写 ADR。
  验收：假重排序客户端下候选顺序按分数重排；开关关闭时与现在的融合顺序逐条一致；没有配置 `reranker` 时开关保持关闭且不发起请求；单元测试零网络；`pnpm check` 通过。

- [ ] **R1-T04.a 批量抽取管线与断点续跑** | 依赖：R1-T03
  做什么：
  - 新增 `pnpm --filter @dramaticer/st-compat events-backfill`：把 legacy 评测对话导入 `eval-private/memory-cache/eval.db`，建实体、lore、块与向量，然后按路径窗口批量抽取事件。
  - 支持 `--story <id>`、`--limit <windows>`、`--resume`、`--db <path>`；每处理一个窗口打印进度与累计请求数；模型响应按输入 hash 缓存到 `eval-private/memory-cache/events/`，中断后从缓存继续。
  - 只写私有目录与临时数据库；统计输出不带原文。
  验收：假客户端下 3 个窗口跑通并写出事件；中断后 `--resume` 从缓存继续且不重复调用；同一窗口重复运行结果一致；`pnpm check` 通过。

- [ ] **R1-T04.b 三对话事件表回填与记忆评测重跑** | 依赖：R1-T04.a、R1-T03.a、R1-T03.b、M2-T15
  做什么：
  - 对 3 个 legacy 评测对话运行 `events-backfill`，按窗口数量与实测速率安排运行，记录耗时与请求数；事件覆盖率按对话报告。
  - 重跑 `memory-eval`，分别给出 BM25、向量、实体、事件、融合五路的事件题命中@5、@10、@20 与分对话结果。
  - 权重调整采用留一对话交叉验证：在 2 个对话上从固定候选集（每路权重 0.5、1、2）选择融合参数，在第 3 个对话上报告；规则与结果写 ADR，默认值只在交叉验证得分高于当前默认时更新。
  - 重新生成私有报告与统计版 `docs/dev/reports/R1-retrieval.md`；统计版不含原文与对话名。
  验收：事件表覆盖 3 个对话并给出覆盖率；五路数字齐全；交叉验证规则与选择结果写入 ADR；报告可重复生成；`pnpm check` 通过。

- [ ] **R1-T05 八段式章节压缩** | 依赖：M2-T06、R1-T01 | DESIGN §7.3
  做什么：
  - 迁移 v23 新增 `chapter_compressions(id, story_id, level, start_node_id, end_node_id, sections, token_count, created_at)`，`level` 取 `chapter` 或 `mainline`，同一故事、级别、起止节点唯一；`sections` 存 JSON，键固定为 `剧情脉络`、`人物档案`、`关系网`、`世界与设定`、`物品与资源`、`伏笔与约定`、`当前情况`、`用户意志`。
  - 后台任务 `compression`：每 `chapterSize`（默认 20）个已确认助手楼层生成一条章节压缩，输入为窗口原文与上一份压缩；每 5 条章节压缩生成一条主线压缩，输入为最近 5 条章节压缩。八个键必须齐全，值为字符串；缺键或类型不符整条拒绝并记录原因。
  - 有效性与 M2-T06 一致：起止节点都在当前路径上且起点在终点之前；重复执行不产生重复行；空窗口不调用模型。
  - 槽位提供者按预算注入主线与最近章节压缩，用户意志段永远保留；Trace 来源写 `compression:<level>`。
  验收：八段齐全且顺序固定；缺键、空正文、非字符串各抛错并指出字段；分支切换后旧压缩失效；重复执行不产生重复行；预算裁剪保留用户意志；`pnpm check` 通过。

- [ ] **R1-T06 后台预筛世界书** | 依赖：M2-T13、R1-T02 | DESIGN §7.3、§9
  做什么：
  - 迁移 v24 新增 `lore_prefilter(node_id PRIMARY KEY, story_id, entry_ids, created_at)`；`entry_ids` 存 JSON 数组。
  - 后台任务 `lore_prefilter`：回合落定后，用本轮用户消息、最近一条压缩摘要与下一拍方案构造查询；先用 BM25 取前 `prefilterLimit`（默认 20）条非恒常 lore，再由后台模型判断相关性并写入当前 head 楼层的预筛结果；恒常条目永远保留。
  - 下一轮组装时 `createLoreSlotProvider` 优先读当前 head 的预筛结果，没有记录时退回关键词与实体命中；回合内不调用模型。
  - 重复执行覆盖同一 `node_id`，不新增行；分支切换后只使用当前路径上的预筛结果。
  验收：回合内假客户端零调用；下一轮使用预筛结果；没有记录时回退正确；恒常条目始终注入；重复执行行数不变；分支隔离；`pnpm check` 通过。

- [ ] **R1-T07 用户意志捕获** | 依赖：R1-T01、R1-T02 | DESIGN §7.1、§9
  做什么：
  - 后台任务 `user_will`：在间隙读取最近若干条玩家消息，识别明确表达的偏好、底线与纠正；返回 `{kind, text, sourceQuote}` 数组，`kind` 取 `preference`、`boundary`、`correction`。
  - 写入台账路径 `["userWill", <稳定 id>]`，值包含正文、来源楼层与创建时间；同一正文按规范化去重；只追加，不自动删除。
  - 组装上下文时把用户意志放在预算取舍的第一位；分支切换后只注入当前路径上的条目。
  - 模糊的陈述、疑问与角色台词不捕获；单元测试用固定文本 fixture 验证正负例。
  验收：明确的偏好、底线与纠正各被捕获；模糊陈述与角色台词不产生条目；重复表达合并；注入优先级最高；分支隔离；非法输出整条拒绝并记录原因；`pnpm check` 通过。

- [ ] **R1-T07.a 自然语言修订记忆** | 依赖：R1-T07、R1-T01.a | DESIGN §7.1
  做什么：
  - 迁移 v25 新增 `ledger_change_cards(id, story_id, source_node_id, text, diffs, before, status, created_at, decided_at)`，`status` 取 `pending`、`approved`、`rejected`、`rolled_back`；`diffs` 与 `before` 存 JSON，写入前用 `validateLedgerDiff` 校验。
  - 后台任务 `memory_revision`：读取最近的玩家消息，识别明确的修改要求，生成变更卡草案；模糊陈述、疑问与角色台词不生成。
  - 批准时把 `diffs` 写成 `source` 为 `player` 的事实，同时把同一段话写进 `userWill`；拒绝只改状态；已批准的回滚写反向 diff 恢复 `before` 里的原值，保留原事实的变更历史。
  - 结算器记下的冲突（R1-T02 的 `repairs`）转成待审变更卡，卡片来源标为 `settler`；批准后才覆盖台账。
  - CLI：`dramaticer ledger cards <story>` 列出待定卡片，`--approve <id>`、`--reject <id>`、`--rollback <id>` 执行对应动作；R5 面板复用同一接口。
  验收：明确的修改要求生成一张待定卡；结算冲突生成一张待定卡且批准前台账不变；批准后事实来源为 `player` 且进入用户意志；拒绝不写台账；回滚后快照回到批准前的值；非法 diff 整卡拒绝并记录原因；重复批准不重复写入；`pnpm check` 通过。

- [ ] **R1-T07.b 间隙合并调用 `gap_pass`** | 依赖：R1-T02.a、R1-T03、R1-T07、R1-T07.a | DESIGN §7.3、§9 | ADR-0041（A3）
  做什么：
  - 新增后台任务 `gap_pass`：每个回合一次结构化调用，同时产出结算 diff、现场分析、用户意志与修订候选，事件作为可选段；各段复用对应任务的校验器与写入路径，不新增存储。单段非法只拒绝该段。
  - 队列按“下一轮要不要用”分两档：`gap_pass` 与世界书预筛优先；章节压缩、事件回填、导演规划、NPC 议程只在长于玩家思考间隙 P75 的间隙（默认 212 秒，可由设置覆盖）或会话结束后运行。
  - head 变化后队列里过期的任务直接丢弃并计数；Trace 与试玩报告记录“间隙未完成率”（下一轮开始时关键间隙工作未完成的比例）。
  - 在至少 20 个楼层上对比合并调用与拆开调用的结算准确率，结论写 ADR；准确率明显下降时保留拆开调用，把 `gap_pass` 作为默认关闭的开关，不删除已完成的拆开路径。
  验收：一次调用产出多段并各自校验入库；单段非法只拒绝该段；过期任务被丢弃并计数；延后档只在长间隙或会话结束后运行；间隙未完成率可读；对比结果写进 ADR；`pnpm check` 通过。

- [ ] **R1-T08 上下文包复用** | 依赖：R1-T02.a、R1-T03.a、R1-T06、M2-T12 | DESIGN §7.3、§9
  做什么：
  - 迁移 v26 新增 `context_packs(node_id PRIMARY KEY, story_id, payload, created_at)`；`payload` 存检索结果、预筛世界书条目 id、现场分析引用与台账快照版本。
  - 第一次生成玩家楼层的回复时组装上下文并写入上下文包；swipe 与重新生成同一楼层直接读包，不重新检索、不重新调用 embedding 或预筛；包不存在时按现有路径组装并写入。
  - 玩家编辑输入产生新楼层，不继承旧包；包引用的条目被删或分析楼层不在当前路径时视为不存在，重新组装。
  - 包本身不触发模型调用；回合内只读，回合外只准备下一轮能提前准备的部分。
  验收：同一玩家楼层 swipe 两次只组装一次且结果一致；编辑输入后重新组装；引用失效时回退到重新组装；包不跨分支复用；`pnpm check` 通过。

- [ ] **R1-T99 R1 验收** | 依赖：R1 全部任务
  做什么：同 M0-T99；重跑门禁与 live 测试；逐条核对 R1-T01 至 R1-T08；复核 I11（后台工作不进入回合）、I12（所有写入经过校验）、I13（不强制模型输出结构）；在 `docs/dev/reports/R1.md` 总结事件覆盖率、记忆评测结果、压缩与预筛的实测数字、父子分块与重排序的效果、间隙未完成率与截断率；确认 R2 任务。
  结果写 `MILESTONE_DONE`。

## R2：评测底座

- [ ] **R2-T01 B0 朴素模式** | 依赖：M4-T02、R1-T01 | DESIGN §14.1
  做什么：
  - core 增加 `ChatProfile`（`native`、`naive`）；`naive` 只提供角色、persona、写作契约与最近 N 楼原文，不提供台账、记忆、lore、摘要、现场分析与导演槽位；`dramaticer chat --profile naive` 可运行。
  - 朴素模式关闭后台任务与台账写入，Trace 里不出现 `memory:`、`summary:`、`ledger:`、`director:` 来源。
  - 与 `native` 共用同一条生成与楼层写入路径，只替换槽位提供者集合。
  验收：朴素模式 Trace 只有角色、persona、历史与写作契约；后台客户端零调用；两种模式写出的楼层结构一致；`pnpm check` 通过。

- [ ] **R2-T02 回放驱动与长程自动试玩命令行** | 依赖：R2-T01、R1-T02
  做什么：
  - 新增 `pnpm --filter @dramaticer/st-compat playtest`：参数 `--db`、`--story`、`--rounds`（默认 20）、`--profile`、`--user-model`、`--model`、`--seed`、`--out`、`--resume`。
  - 模拟用户由 `background` 模型生成，严格 JSON `{message}`；解析失败重试 3 次后终止并记录原因；支持按轮次配置 swipe、编辑与分支切换。
  - 助手模型由 `--model <alias>` 指定，自动试玩默认用 `rp`（catie 渠道的 Gemini 3.8 Flash，人类指定）；`--user-model` 只影响模拟用户。
  - 每轮记录序号、节点 id、用户输入与助手正文、首字毫秒、用量、台账 diff 数、新建与兑现线索、导演决策、Trace 摘要、是否截断、下一轮开始时关键间隙工作的完成情况（用于计算间隙未完成率）；写私有 JSONL 到 `eval-private/reports/`。
  - 断点续跑从最后一个完成轮次继续；单轮失败不中断整批，记入失败列表。
  验收：假客户端下 5 轮跑通且零网络；模拟用户输出非法 JSON 时重试 3 次后终止；`--resume` 不重复轮次；记录字段齐全；`pnpm check` 通过。

- [ ] **R2-T03 一致性探针** | 依赖：R2-T02、R1-T01、R1-T01.b
  做什么：
  - 在试玩中每 `probeEvery`（默认 10）轮插入一次回忆型探针：从台账里取至少 20 楼之前的事实，生成问题；探针调用不写入楼层树，也不改变当前 head。
  - 回答与当前台账快照交给 `judge` 角色的模型裁判，严格 JSON `{consistent: boolean, reason}`；无法判断记为 `unknown`，不并入矛盾率。
  - 报告按对话与轮次给出矛盾率、`unknown` 数与样例编号（私有报告可含原文，统计版只含数字）。
  验收：探针不产生新楼层；裁判输出非法 JSON 时重试；矛盾率计算正确；`unknown` 单列；`pnpm check` 通过。

- [ ] **R2-T03.a 五类记忆题与编造回忆率** | 依赖：R2-T03、M2-T15
  做什么：
  - 记忆题按 LongMemEval 五类扩充：信息抽取、跨段推理、时间推理、知识更新、拒答；每道题标注类别与证据楼层。
  - 新增编造回忆题：用从未发生的人、事、物生成提问，正确答案是明确否认或拒答；模型给出肯定描述即计为编造。
  - 一致性探针与记忆评测共用同一套判分；报告按类别给出命中与编造率，`unknown` 单列。
  验收：五类各有题目且判分正确；编造回忆题在肯定描述时判为编造、明确否认时判为通过；报告按类别分列；统计版不含题目与原文；`pnpm check` 通过。

- [ ] **R2-T04 盲测两两对比** | 依赖：R2-T02、R1-T01.b
  做什么：
  - 新增两两对比：同一分支点的两份续写分别以 A、B 与 B、A 两种顺序交给 `judge` 角色的裁判，严格 JSON `{winner:"A"|"B"|"tie", reason}`。
  - 汇总胜率、平局率与位置偏差（两种顺序结论不一致的比例）；裁判失败重试 3 次后记入失败列表。
  - 统计版只含胜率、平局率、位置偏差、样本数与模型别名，不含原文。
  验收：两份完全相同的续写在两种顺序下都判平局；顺序交换后结论统计正确；失败重试与记录可用；`pnpm check` 通过。

- [ ] **R2-T04.a 叙事质量评分表** | 依赖：R2-T04、R1-T01.b
  做什么：
  - 参考 TTCW 的评分表，裁判严格输出 `{originality, character, pacing, dialogue, reason}`，四项各 1 到 5 分；非法 JSON 重试 3 次后记入失败列表。
  - 同一批盲测样本同时给出两两胜负与四项分数；报告按对话给出均值与分布，统计版只含分数与样本数。
  - 评分与裁判都使用 `judge` 角色；`judge` 与 `writer` 由路由创建时校验为不同模型家族（ADR-0041）。
  验收：评分字段齐全且范围校验；非法输出重试与失败记录可用；与盲测胜率一起出现在报告里；统计版不含原文；`pnpm check` 通过。

- [ ] **R2-T05 B1 历史回放基线** | 依赖：R2-T02、R2-T04、R1-T04.b
  做什么：
  - 从 legacy 评测对话按 ADR-0027 的分支点选择规则取点；用后续真实用户消息回放，只用固定轮数生成续写。
  - 把第一段续写与当时 ST 的真实回复配对，走 R2-T04 的盲测对比；报告按对话给出胜率、平局率、样本数与位置偏差。
  - 报告同时列出上下文差异（前缀楼层数、模型别名、采样参数、是否有记忆与导演），并标出历史回复所用的模型；不调用本地 ST。
  - 主对照是同一写作模型下的 B0 与 native。能找到同模型样本时用同模型子集比较；找不到时 B1 只作为“相对现状”的参考，不作门槛。
  验收：3 个对话都有样本；对比不访问本地 ST；报告给出上下文差异与历史回复模型；同模型子集与参考口径分开列出；统计版不含私有名称与原文；`pnpm check` 通过。

- [ ] **R2-T06 记分牌与报告口径** | 依赖：R2-T03、R2-T03.a、R2-T04、R2-T04.a、R2-T05
  做什么：
  - 新增 `docs/dev/SCOREBOARD.md`，由 CLI `pnpm --filter @dramaticer/st-compat scoreboard` 从私有 JSONL 生成：日期、阶段、profile、模型别名、样本数、对比胜率、矛盾率、编造回忆率、叙事质量四项分数、重复度、首字延迟 P50/P95、截断率、间隙未完成率、每轮成本、结论与下一步。
  - 记分牌只含聚合数字；同一批输入重复生成逐字节相同。
  - 写清门槛规则：没赢过基线就自动生成改进任务并重评，最多三轮，之后写入 HUMAN.md。
  验收：记分牌可由报告重复生成；字段齐全；私有标识反向扫描通过；门槛规则写进文档；`pnpm check` 通过。

- [ ] **R2-T99 R2 验收** | 依赖：R2 全部任务
  做什么：同 M0-T99；重跑门禁；用 5 轮假试玩与 1 个真实分支点验证整条链路；核对 B0、B1 的口径与可复现性；在 `docs/dev/reports/R2.md` 记录样本数与限制；确认 R3 任务。
  结果写 `MILESTONE_DONE`。

## E：排障命令行（排在 R2 之后）

- [ ] **E-T01 排障命令行 `dramaticer explain`** | 依赖：R2-T99 | DESIGN §10.3
  做什么：
  - 新增 `dramaticer explain --node <id> [--json]`：读取该楼层的 Trace、上下文分段来源与 token、被裁剪的段落与缺失槽位、检索各路分数与融合排名、台账快照与本楼 diff、导演决策，按固定顺序解释“这一轮为什么这么写、为什么忘了某件事”，并给出可以操作的修正建议（置顶某条记忆、修订台账）。
  - 每个结论都带证据（Trace 分段、检索条目与楼层 id、台账路径、导演方案 id）；证据缺失时明确写“没有记录”，不推断。
  - 只读：不写楼层、不改变 head、不调用模型；默认输出中文文本，`--json` 输出结构化字段。
  验收：对已有楼层输出每个分段、检索条目、台账路径与导演决策；缺 Trace 时给出明确提示；模型调用次数为零；`pnpm check` 通过。

## X：对比实验（排在 R2-T99 之后，可与 R3 并行）

- [ ] **X1 世界模型表示方式对比** | 依赖：R1-T99、R2-T99 | DESIGN §14.4
  做什么：
  - 候选：① 现有台账（硬事实）；② 台账加实体 Wiki 页（软知识：性格变化、关系史，带出处楼层与版本历史）；③ 时序知识图谱（事实标记失效而不删除，支持按时间点查询）。三个候选通过同一个读写接口切换，用配置选择，不改调用方。
  - 在 3 个对话、固定轮数、同一批记忆题与探针上比较矛盾率、编造回忆率、盲测胜率与每轮成本；每种候选至少重复 3 次。
  - 判定：主要指标不劣于候选 ①，且盲测胜率明显高于 ① 才切换；否则保留 ①。设计与结论写 ADR，未切换的候选代码删除或留在开关后面。
  验收：三种候选各自可运行并产出同一格式的指标表；判定按规则执行；ADR 入库；`pnpm check` 通过。

- [ ] **X2 Director 组织方式对比** | 依赖：R2-T99、R4-T99 | DESIGN §14.4
  做什么：
  - 候选：① 现有方案与序列；② 剧情小品引擎：只有一种对象，条件是自然语言或台账查询，间隙里一次调用批量判断，支持冷却、顺序约束、可否重复与兜底；卡作者可以在 `extensions.dramaticer` 里附带自己的小品。
  - 指标：重复度、推进度、线索兑现率、盲测胜率、条件判断准确率；条件判断用固定样本逐条核对，不能只靠裁判模型自评。
  - 判定：不劣于 ① 且盲测胜率明显更高才切换，否则保留 ①；设计与结论写 ADR。
  验收：两个候选在同一批试玩样本上产出指标表；条件判断样本与核对结果入库；判定按规则执行；`pnpm check` 通过。

## R3：双模式回合

- [ ] **R3-T00 细化 R3 任务** | 依赖：R1-T99、R2-T99 | DESIGN §10.1
  做什么：把 DESIGN §10.1 拆成可执行任务：快回合与深回合的循环与上限、故事级锁定与单轮开关、文本协议解析与执行、写作契约进入默认模板、深回合进度事件、模式不自动切换的校验。深回合的工具集合以搜索、阅读页面或条目、读写台账为核心，外加可选的联网搜索，不为每类数据各开一个工具；深回合运行中允许玩家补一句要求进入后续步骤，不中断重来。v2.2 的五项要点一并纳入：草稿与提交分开（草稿实时投影到界面，未提交不产生楼层）、导演手记挂在楼层树上按楼存修改并沿路径累加（每个分支各自版本，事实仍以台账为准）、运行日志只追加地并入 Trace 供界面时间线展示、模板可以附带深回合配置（工具与技能、计划方式、防失控上限）、多轮工具调用原样回放原生元数据（尤其 Gemini 思考签名）并配工具循环测试与中转渠道实测。容忍协议漂移（ADR-0041 的 A9）：模型没有调用提交工具、直接输出了正文时，按草稿接住，不判失败。验收指标增加运行失败率、漂移率与时长分布，目标失败率明显低于 23%。每项写清依赖与验收。
  验收：任务清单可直接执行；`pnpm check` 通过。

- [ ] **R3-T99 R3 验收** | 依赖：R3 全部任务
  做什么：逐条核对快回合与深回合、手动切换、文本协议兜底、进度事件与防失控上限；复核 I6（程序不自动切换）、I13；写 `docs/dev/reports/R3.md`；确认 R4 任务。
  结果写 `MILESTONE_DONE`。

## R4：Director v2

- [ ] **R4-T00 细化 R4 任务** | 依赖：R1-T99、R3-T99 | DESIGN §8
  做什么：把长线层（弧线、序列、后台规划器、玩家编辑）、短线层（当前拍、强度、纠偏信号、程序选择）、落拍检测、候选行动、注入玩家消息末尾、透明与盲盒模式、`extensions.dramaticer` 扩展拆成任务，写清依赖与验收。
  验收：任务清单可直接执行；`pnpm check` 通过。

- [ ] **R4-T99 R4 验收** | 依赖：R4 全部任务
  做什么：核对短线层零模型调用、建议具体到人和事、玩家可编辑与关闭、落拍检测不额外调用；复核 I9；写 `docs/dev/reports/R4.md`；确认 R5 任务。
  结果写 `MILESTONE_DONE`。

## R5：能玩的界面

- [ ] **R5-T00 细化 R5 任务** | 依赖：R4-T99
  做什么：在并入的 M4 剩余任务基础上重新排序：server、SSE 聊天、快深模式开关、台账面板、导演面板优先；其余面板延后。把模式开关、台账读取接口与台账面板、Director v2 面板、候选行动加入任务，删除已被 R1–R4 取代的旧面板描述。
  验收：R5-T01 至 R5-T14 的依赖与验收与 DESIGN §8、§10.1、§13 一致；`pnpm check` 通过。

- [ ] **R5-T01 server 后台任务调度**（原 M4-T07） | 依赖：M4-T06、M2-T03、R1-T02 | DESIGN §4、§7
  做什么：
  - 回合成功后在后台执行 `enqueueMissingJobs` 与 `drainBackgroundJobs`，不阻塞 SSE 结束；服务端同一时间只跑一个后台任务，按创建顺序；使用独立的 `background` 客户端与限速。
  - 失败按任务框架的规则记录，超过重试次数后标为 `failed` 并保留最后错误；服务端关闭时中止正在执行的处理器。
  - 新增 `GET /api/stories/:id/jobs` 返回 pending/running/done/failed 计数与最近错误，供面板显示。
  验收：回合响应先于后台任务完成；结算、事件与压缩在任务完成后写入；失败重试到 `failed`；关闭服务不留下未结束的异步任务；测试用假处理器且零网络；`pnpm check` 通过。

- [ ] **R5-T02 server 分支与面板接口**（原 M4-T08） | 依赖：M4-T06、M4-T03、R1-T01
  做什么：
  - 分支：`GET /api/stories/:id/tree`、`GET /api/stories/:id/path?nodeId=`、`POST /api/nodes/:id/swipe`、`POST /api/nodes/:id/edit`、`POST /api/stories/:id/head`、`POST /api/nodes/:id/regenerate`。
  - 面板：`GET /api/nodes/:id/trace`、`/ledger`、`/events?limit&offset`、`/compressions`、`/director`；`GET /api/stories/:id/clues`、`POST /api/clues/:id/fulfill`；`GET /api/stories/:id/entities`、`/lore`、`/proposals`。
  - 节点必须属于请求路径里的故事，否则 404；响应使用 protocol 类型；不返回密钥。
  验收：swipe 与 edit 生成兄弟且旧节点不变；head 切换后路径正确；regenerate 走 M4-T03；面板数据与 store 一致；跨故事节点 404；`pnpm check` 通过。

- [ ] **R5-T03 server 渠道管理接口**（原 M4-T09） | 依赖：M4-T04、M1-T03
  做什么：
  - `GET /api/channels`：别名、模型、优先级、启用状态、`${ENV}` 变量名与是否已设置、最近体检结果；密钥值永远不出现在响应里。
  - `PUT /api/channels`：编辑别名、模型、优先级、启用状态与新增渠道；密钥字段只接受环境变量引用；校验后原子写回 `channels.yaml`（临时文件加 rename），运行时缓存失效。
  - `POST /api/channels/probe`：调用 `probeChannel`，只在用户点击时联网，结果写回配置。
  验收：脱敏响应里没有密钥；非法 YAML、重复别名与缺失环境变量 400；写入后下一回合使用新配置；probe 用假提供方测试；真实渠道测试放 `*.live.test.ts`；`pnpm check` 通过。

- [ ] **R5-T04 web 骨架与 API 客户端**（原 M4-T10） | 依赖：M4-T05、M4-T06、M4-T01 | DESIGN §13
  做什么：
  - 新增 `packages/web`（React、Vite、TypeScript，中文，移动端优先）；路由使用 `react-router-dom`；页面：登录、故事列表、故事页（聊天、分支、台账、导演、设置、渠道）。
  - `api` 客户端使用 cookie 凭据与 protocol 类型；`streamTurn` 用 fetch 与 ReadableStream 解析 SSE，支持 AbortController；错误统一显示。
  - 移动端布局：底部导航、安全区、390×844 无横向滚动；桌面宽屏两栏。
  - 根脚本接入 `typecheck` 与 `build`；登记 `react`、`react-dom`、`react-router-dom`、`vite`、`@vitejs/plugin-react`、`@types/react`、`@types/react-dom`。
  验收：`pnpm check` 与 `pnpm --filter @dramaticer/web build` 通过；SSE 解析器单测覆盖分块、多事件、注释与错误事件；API 客户端用假 fetch 测试；390×844 截图无横向滚动。

- [ ] **R5-T05 web 聊天界面**（原 M4-T11） | 依赖：R5-T04、M4-T06、R3-T99
  做什么：
  - 按当前路径渲染消息；流式正文、思考折叠；快深模式开关（单轮与故事锁定）；原生块组件（选项、页眉、悄悄话、旁白、备忘）；未知块显示原文。
  - 上千楼的路径必须可用：虚拟列表只渲染可见楼层，历史按页读取（向上滚动加载更早的页），切换分支后定位到 head 且不重排全部楼层。
  - 发送、停止、失败重试；深回合显示进度事件；回合完成后显示台账 diff 数、新线索与首字延迟；候选行动点击后填入输入框，不自动发送；自动滚动与“回到底部”。
  验收：增量逐字出现；思考默认折叠；停止后保留部分内容；错误重试不重复写楼层；模式只能手动切换；候选行动不自动发送；2000 楼夹具下滚动流畅、可见楼层数量有上限、分页加载不重复不丢楼；键盘与触摸可用；纯逻辑单测覆盖 SSE 事件归并与块选择；`pnpm check` 通过。

- [ ] **R5-T06 web 分支视图**（原 M4-T12） | 依赖：R5-T05、R5-T02
  做什么：
  - 楼层树（缩进与折叠）、当前路径高亮、点击切换 head；swipe、编辑用户或助手文本、重新生成；切换前提示未确认楼层的后果。
  验收：swipe 与 edit 后旧分支仍可切回；编辑后原文不变；head 切换与路径刷新正确；移动端可操作；纯逻辑单测覆盖树构造与路径标记；`pnpm check` 通过。

- [ ] **R5-T07 web 台账与记忆面板**（原 M4-T13） | 依赖：R5-T04、R5-T02、R1-T01
  做什么：
  - 台账按命名空间树形展示、本楼 diff 高亮；人物、关系、物品、场景、线索与知情表分栏；事件列表（时间、地点、参与者、重要度、知情者、来源楼层）；压缩列表与覆盖区间；分页与空状态。
  验收：面板数据与接口一致；长值可展开；空状态清楚；线索状态变更后刷新正确；纯逻辑单测覆盖格式化与分页；`pnpm check` 通过。

- [ ] **R5-T08 web 导演与 Trace 面板**（原 M4-T14） | 依赖：R5-T04、R5-T02、R4-T99
  做什么：
  - 导演决策（当前拍、强度、纠偏信号、指令、候选行动）、弧线与序列查看与编辑、未兑现线索与兑现按钮；透明与盲盒模式切换。
  - Trace 分段（来源、token、裁剪、缺失槽位）、工具轮次、回合模式、渠道与用量。
  验收：导演开关与模式切换后下一回合行为不同；编辑弧线后刷新仍在；兑现后列表更新；Trace 与核心记录一致；纯逻辑单测覆盖展示模型；`pnpm check` 通过。

- [ ] **R5-T09 web 故事设置与模板编辑器**（原 M4-T15） | 依赖：R5-T04、M4-T05、M4-T02 | DESIGN §9
  做什么：
  - 故事设置：模型别名、预算、结构化输出模式、温度、最大 token、思考档位、视角、回合模式锁定、导演开关与参数；保存前做范围校验。
  - 模板编辑器：段落列表（静态、槽位、条件）增删与上下移动、槽位选择、条件编辑；保存前由服务端 `assertContextTemplate` 校验；支持复制模板与设为故事默认。
  - ST 预设转换属于兼容线，本任务不做，界面不放置未实现的导入入口。
  验收：模板增删移动后组装顺序与预览一致；非法条件与空静态段被拒绝并显示字段错误；设置保存后下一回合生效；刷新后仍在；纯逻辑单测覆盖编辑状态与校验映射；`pnpm check` 通过。

- [ ] **R5-T10 web 渠道管理面板**（原 M4-T16） | 依赖：R5-T04、R5-T03
  做什么：
  - 渠道列表（别名、模型、优先级、启用、密钥变量是否设置、体检结果）；编辑与新增；体检按钮显示流式、函数调用、思考、预填充、用量结果；密钥只显示变量名与是否设置。
  验收：界面不出现密钥值；保存后服务端配置更新；未设置的变量有醒目提示；体检失败显示错误；纯逻辑单测覆盖表单校验；`pnpm check` 通过。

- [ ] **R5-T11 沙箱 iframe 块渲染器**（原 M4-T17） | 依赖：R5-T05、M1-T05 | DESIGN §6
  做什么：
  - web 新增沙箱渲染组件：`<iframe sandbox="allow-scripts">`，不添加 `allow-same-origin`；`srcdoc` 注入块 HTML 与最小 CSP；模板来自块注册表的 `html` 显示策略，服务端在 `blocks.replace` 里带上显示策略与模板。
  - postMessage 白名单：只接受 `ready`、`height`、`action`（`choice`、`scroll` 等固定类型）；校验 `event.source` 与 `event.origin === "null"`；父页面只回发固定字段。
  - 原生块继续用 React 组件；未知块显示原文。
  验收：脚本无法读取父页面 DOM 与 cookie；高度自适应；非法消息被忽略；模板 HTML 不进入主文档；Playwright 用例覆盖隔离与高度；`pnpm check` 通过。

- [ ] **R5-T12 Playwright 端到端**（原 M4-T18） | 依赖：R5-T05 至 R5-T11
  做什么：
  - 安装 `@playwright/test` 与 Chromium；`packages/web/e2e/` 配置 `pnpm e2e`：先构建 server 与 web，再启动本地假 OpenAI 兼容渠道与 server；假渠道返回固定 SSE，覆盖思考、块、台账写入、线索与读取工具调用。
  - 用例覆盖：密码登录、创建故事、导入合成卡、两轮对话、快深切换、swipe、编辑、分支切换、台账与记忆面板、导演与 Trace 面板、模板编辑、渠道编辑；390×844 与桌面两种视口。
  - 默认不进入 `pnpm check`（浏览器体积），`pnpm e2e` 单独运行并写进文档。
  验收：`pnpm e2e` 全部通过；不访问外网、不使用私有数据；失败截图与 trace 写进 `.devloop/scratch/e2e/`（git 忽略）；`pnpm check` 通过。

- [ ] **R5-T13 自动试玩框架**（原 M4-T19） | 依赖：R5-T12、R5-T01、R2-T02
  做什么：
  - `packages/web/e2e/playtest/`：用 Playwright 驱动真实界面；模拟用户由 `background` 模型生成，严格 JSON `{message}`，失败重试 3 次后终止并记录；50 轮内至少执行 2 次 swipe、2 次编辑、2 次分支切换，轮次位置可配置。
  - 每轮记录序号、节点 id、用户与助手原文、回合模式、首字毫秒、用量、台账 diff 数、新建与兑现线索、导演决策、截图路径；报告头写模型别名、配置与样本数。
  - 私有报告写 `eval-private/reports/r5-playtest.md`；统计版写 `docs/dev/reports/R5-playtest.md`，字段按 ADR-0033 §九：轮数、对比胜率、矛盾率、相邻块 Jaccard 与节拍余弦、首字延迟、token、导演机制命中、新建与兑现线索、兑现率与平均年龄、错误数与复现步骤编号。
  - 统计版不出现故事名、角色名、原文与题目文本；失败可整批重跑并注明。
  验收：假渠道下 5 轮冒烟跑通且不联网；私有报告含逐轮记录与截图路径；统计版字段齐全并通过私有标识反向扫描；`pnpm check` 通过。

- [ ] **R5-T14 真实 50 轮试玩与报告**（原 M4-T20） | 依赖：R5-T13 | 使用 `.env` 里的真实渠道
  做什么：用真实正文与后台渠道运行至少 50 轮，执行规定次数的 swipe、编辑与分支切换；生成两份报告；统计版写入 `docs/dev/reports/R5-playtest.md` 并在 `docs/dev/reports/R5.md` 引用；效果指标按 ADR-0033 原样报告，没有信号就写未证实。
  验收：50 轮完成，失败轮次有原因；两份报告生成；统计版无私有信息；报告给出导演机制命中与线索兑现数字；`pnpm check` 通过。

- [ ] **R5-T99 R5 验收** | 依赖：R5 全部任务
  做什么：同 M0-T99；重跑 `pnpm check`、`pnpm e2e` 与 50 轮试玩报告；逐条核对 R5-T01 至 R5-T14；复核 I6、I11–I14，以及 server 不绕过 core 直接写库；检查默认回环监听与局域网密码；在 `docs/dev/reports/R5.md` 总结；确认 R6 任务。
  结果写 `MILESTONE_DONE`；报告缺失时写 `PARTIAL`。

## H：应用内助手（排在 R5 之后，取代原侧边 agent）

- [ ] **H-T00 细化应用内助手** | 依赖：R5-T99、E-T01 | DESIGN §10.3
  做什么：把抽屉界面与全部技能（排障、台账修订、参谋、资料员、卡片工坊、设置向导、使用指南）、类型化 server 接口、三级权限（只读、修改前确认、自动执行）、对话保存与搜索、关掉抽屉后任务继续运行与状态提示、上下文自动与手动压缩、用量环拆成任务；复用深回合的 agent 运行时，与正剧隔离：不写楼层，不进入剧情上下文；影响剧情的修改一律走变更卡并由结算器校验。写清依赖与验收。
  验收：任务清单可直接执行；应用内助手不写楼层、不进入剧情上下文；影响剧情的修改全部经过变更卡；`pnpm check` 通过。

## R6：效果门槛

- [ ] **R6-T00 细化 R6 任务** | 依赖：R5-T99 | DESIGN §14.2
  做什么：预注册门槛：B1 对比胜率的判定方式与置信区间、矛盾率上限、重复度与推进度口径、深回合增益口径；B2 的申请模板与样本上限；未达标时自动生成改进任务并重评最多三轮，之后写入 HUMAN.md。拆成具体任务并写清依赖与验收。
  验收：门槛在运行前写死；每项都有可复现的统计口径；`pnpm check` 通过。

- [ ] **R6-T99 R6 验收** | 依赖：R6 全部任务
  做什么：按预注册门槛运行 B0、B1 对比（必要时按 HUMAN 流程申请 B2）；逐项判定；未达标时列出改进任务与重评结果；把结论写入 `docs/dev/SCOREBOARD.md` 与 `docs/dev/reports/R6.md`；确认 R7 任务。
  结果写 `MILESTONE_DONE` 或 `PARTIAL`。

## R7：之后

- [ ] **R7-T00 细化 R7 任务** | 依赖：R6-T99
  做什么：按顺序拆解公开 alpha、生图、Tauri；写清依赖与验收；`docs/DESIGN.md` 与 `docs/dev/TASKS.md` 同步。兼容插件线已有自己的任务（C-T01–C-T05），不在 R7 重新拆解。原侧边 agent 条目已由 R5 之后的应用内助手（H-T00）取代，不再出现在 R7。
  验收：后续阶段的任务清单可直接执行；`pnpm check` 通过。

- [ ] **R7-T99 R7 验收** | 依赖：R7 全部任务
  做什么：逐项核对兼容线、alpha 材料、生图与 Tauri；复核全部设计不变量；写最终报告。
  结果写 `MILESTONE_DONE`。

## 兼容插件线（DESIGN §6、§9；ADR-0038，取代 C-T00）——依赖 P2，排在插件内核改造之后

- [ ] **C-T01 ST 沙箱与 prompt 一致性测试台** | 依赖：R0-T04 | DESIGN §6、§9
  做什么：
  - 把 `D:\SillyTavern\` 的程序与数据复制到 `eval-private/st-sandbox/` 运行；原安装目录只读，不得修改、不得调用任何模型（I14）。
  - 启动本地录制服务，把沙箱里 ST 的 API 地址指向它；录制服务只记录请求，不调用模型。
  - 用 58 个预设 × 卡片 × 对话片段驱动 ST 生成，录下 ST 实际组装的请求；实现逐条比对工具，输出受支持功能的覆盖率与不一致清单（不一致逐条列出原因）。
  - 两种模式（ADR-0041 的 A10）：忠实模式关闭全部原生功能，用于一致性比对，目标是 100% 一致；共存模式按 ADR-0040 执行，不做一致性比对，只做开关对照评测。
  - 净室规则：ST 是 AGPL-3.0，只以录制下来的行为与测试作为规格，不移植或改写 ST 源码；其他上游项目（酒馆助手、MVU 等）逐个确认许可证并写进 `docs/dev/DEPENDENCIES.md`，许可证不允许的直接排除并记录。
  - 沙箱副本、录制结果与比对产物只留在 `eval-private/`，不进入提交。
  验收：录制服务在零模型调用下产出请求记录；比对工具对同一输入输出 100% 一致或逐条差异；原安装目录没有被写入；副本与录制数据没有被 git 跟踪；测试台提供「同一批卡开启与关闭兼容插件」的评测入口与原生指标（矛盾率、编造回忆率、盲测胜率、首字延迟）报告，供其余兼容插件共用（ADR-0040 共存验收）。

- [ ] **C-T02 P-A `st-content` 内容与 prompt 组装** | 依赖：C-T01、P2
  做什么：
  - 先搭一致性测试并让它变红，再实现：角色卡 V1/V2/V3（PNG/JSON）、群聊卡、人设、作者注释；世界书完整激活语义（主次关键词与逻辑、正则关键词、递归、sticky/cooldown/delay、分组与组内权重、概率、扫描深度、位置/深度/角色、outlet）；预设（`prompt_order`、深度注入、角色、预填充、续写预填充、squash、format 字段、采样参数）；完整宏引擎；完整正则语义；对话 jsonl 的导入导出。
  - 内容转换成原生模板与槽位，原生模型表达不了的按 ST 语义在插件里处理。
  验收：一致性测试覆盖的世界书、预设、宏、正则、卡片与对话导入用例全部通过；导入不丢字段；`core` 不出现 ST 概念（I1）；ST 内容按槽位进入原生预算分配器，Trace 分开显示 ST 与原生内容的 token 占比；写作契约保持在离生成最近的位置，导入时识别预设里的总结类与规划类条目；ST 正则、宏与 EJS 只作用于 ST 内容，不碰 harness 槽位；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [ ] **C-T03 P-C `st-mvu` MVU 兼容** | 依赖：C-T02
  做什么：
  - 先搭一致性测试并让它变红，再实现：`initvar`、`<UpdateVariable>`、JSONPatch、`[值, 说明]`、`$meta`（strictSet、extensible、模板）、zod schema 校验。
  - 变量映射为台账的一个命名空间；更新指令交给结算器校验和修复（I12）。
  - 脚本写变量后立刻读取要读到待结算的值：这一层是插件内的临时视图，结算后以台账为准（ADR-0041 的 A10）。
  - 修改消息分两类：改正文一律生成新 swipe（I4）；只改显示或元数据（状态栏刷新这类）写进插件自己的显示状态，不新建节点。
  验收：一致性测试的 MVU 用例全部通过；非法更新经结算器修复或拒绝并留 Trace；原楼层原文不可修改（I4）；MVU 变量与台账是同一套数据，没有第二份事实，读取路径与结算路径的测试证明这一点；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [ ] **C-T04 P-B `st-ejs` Prompt Template 兼容** | 依赖：C-T03
  做什么：
  - 先搭一致性测试并让它变红，再实现：世界书条目与预设里的 EJS 模板，包括 `getvar`/`setvar` 等函数、装饰器、激活正则与世界书条目的能力；模板在沙箱里执行。
  - 执行隔离（ADR-0041 的 A10）：EJS 在 worker 里执行，`node:vm` 不作为安全边界；模板发起的生成按卡限流并计入后台预算。
  - 作用范围：ST 正则、宏与 EJS 只作用于 history 槽位里的 ST 内容，不碰记忆、台账、导演与写作契约等 harness 槽位。
  验收：EJS 模板的一致性用例全部通过；沙箱逃逸测试通过；模板执行不影响台账事实（I12）；EJS 只作用于来自 ST 的内容，不修改 harness 槽位；模板执行与世界书递归激活计入回合内时间预算，超时写入 Trace；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

- [ ] **C-T05 P-D `st-helper-host` 酒馆助手宿主** | 依赖：C-T04
  做什么：
  - 先搭一致性测试并让它变红，再实现：执行酒馆助手脚本、角色卡内脚本、HTML 状态栏与开场页；运行在沙箱 iframe 里，提供与酒馆助手 API 对齐的变量读写、事件监听、`triggerSlash`/STscript、生成、读消息、改消息。
  - 修改消息一律映射成新建楼层或新的 swipe，不修改原文（I4）；只改显示或元数据的写进插件显示状态，不新建节点。
  - 执行隔离（ADR-0041 的 A10）：脚本在沙箱 iframe 里运行，`node:vm` 不作为安全边界；脚本发起的生成按卡限流并计入后台预算。
  验收：酒馆助手 API 覆盖率与一致性测试达到提案口径；修改消息不触碰原文；脚本在沙箱里运行；脚本发起的生成一律作为后台任务执行并在 Trace 里单独计数，走后台渠道、不进入回合内；脚本与正则的变量写入经过结算器；开启与关闭本插件的对照评测里原生指标不明显变差（ADR-0040）。

## M5：公开 alpha——由 M5-T00 细化，排在 R7 之后
## M6：生图（ComfyUI 优先）——由 M6-T00 细化，排在 R7 之后
## M7：Tauri 打包——由 M7-T00 细化，排在 R7 之后
