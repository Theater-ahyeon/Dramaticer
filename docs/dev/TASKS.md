# 任务清单

状态标记：`[ ]` 待做 · `[~]` 进行中 · `[x]` 完成 · `[!]` 被阻塞（括号里写阻塞它的 HUMAN 编号）

规则：从上往下选第一个可以做的任务；一个会话只做一个任务；任务太大就拆成子任务（`.a`、`.b`……）。每个里程碑最后都有一个 `T99` 验收任务。后面的里程碑只写了粗粒度条目，**由它的 `T00` 拆解任务细化**。

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

- [ ] **M0-T05 st-compat：世界书与预设解析** | 依赖：M0-T01
  做什么：
  - 世界书条目：主关键词、次关键词、constant、selective、position、depth、order、probability、禁用状态等
  - 预设：`prompts`、`prompt_order`、采样参数、`assistant_prefill`、`extensions.regex_scripts`；不认识的字段原样保留
  - 解析结果用明确的 TS 类型表达
  验收：合成测试数据覆盖主要字段；解析之后再序列化，和原文件在结构上等价。

- [ ] **M0-T06 core：原生领域模型与存储（M0 子集）** | 依赖：M0-T01 | DESIGN §5、§7
  做什么：定义这些类型：Story、TimelineNode（含 parentId 和不可修改的 raw）、StateDiff、MemoryEvent（先只定义类型）；用 better-sqlite3 建表（nodes、state_diffs、带 FTS5 的 node_text）；写一个数据库迁移机制（schema 版本号）。**存储层不提供修改 raw 的接口**（不变量 I4），并写一个测试确保这一点。
  验收：能建库；能插入节点和 diff；能按路径（从根到某个节点）读出数据；FTS5 查询可用。

- [ ] **M0-T07 st-compat：ST 对话导入为原生楼层树** | 依赖：M0-T03、M0-T06
  做什么：ST 对话 → 一条线性路径（当前 swipe 作为主路径上的节点，其余 swipe 作为兄弟节点）；**把相邻楼层的 MVU 变量做 diff，转成 StateDiff**，并验证按路径把 diff 依次累加之后能还原出原来的快照。
  验收：合成测试数据通过往返测试（快照 → diff → 快照）。

- [ ] **M0-T08 体检报告** | 依赖：M0-T02、M0-T05、M0-T07
  做什么：CLI 命令 `pnpm --filter @dramaticer/st-compat report`。对 eval-private 里的每个对话统计：楼层数；正文、变量、其他字段各占多少字节；估算的 token 数（估算函数做成可替换的，中文约 1.5 个字符算 1 个 token）；**原生 diff 存储和 ST 快照存储的体积比**；从卡和世界书里提取的实体数量；**重复度曲线**（相邻 AI 回复的字符 n-gram Jaccard 相似度，按楼层分窗口统计，标出从第几楼开始持续上升）。另外统计预设：宏的使用频率、正则作用范围和开关的分布。
  输出：详细报告写到 `eval-private/reports/health.md`（可以引用原文片段）；**只含统计数字的版本**写到 `docs/dev/reports/M0-health.md`（可以提交）。
  验收：两份报告都生成了；仓库版本里没有任何原文。

- [ ] **M0-T09 正则分类器** | 依赖：M0-T05
  做什么：在 st-compat 里实现分类器，分类与 DESIGN §6 对应：html_render、html_script、delete（区分只影响显示、只影响 prompt、带深度限制）、strip_cot、rewrite_capture、text_replace、streaming_variant。再判断每一条是否"可以自动升级"成块策略。对全部预设运行一遍，统计数字追加到 M0-health 报告里。
  验收：每个分类都有合成用例；报告里有可升级比例。

- [ ] **M0-T10 评测集：状态类题目（规则生成）** | 依赖：M0-T07
  做什么：从 MVU 的 diff 中按规则生成题目：在第 Y 楼提问"在第 X 楼之后，<变量路径> 的值是什么"，标准答案取自快照，证据是第 X 楼。只挑间隔大的（Y − X ≥ 30）和重要的变量（变化次数少、不是每楼都变的那种）。每个对话出 50 到 100 题。格式为 JSONL：`{id, story, askAtNode, question, answer, evidenceNodes, kind:"state"}`，写到 `eval-private/evalset/`。
  验收：题目数量达标；随机抽 10 题，自动核对答案和快照一致。

- [ ] **M0-T11 LLM 最小客户端与事件类题目** | 依赖：M0-T07 | 需要 HUMAN-01
  做什么：在 core 里写一个最小的 OpenAI 兼容客户端（只为 M0 服务，到 M1 会被 pi-ai 替换，所以接口保持很薄）；渠道从 `.env` 读取（`DRAMATICER_BG_BASE_URL`、`DRAMATICER_BG_API_KEY`、`DRAMATICER_BG_MODEL`）；带限速（每分钟请求数可以配置）、重试和缓存（同样的输入不重复调用）。然后用它让后台模型按窗口阅读对话，生成事件类题目（`kind:"event"`），每个对话 50 题。另外随机抽 20% 写进 `eval-private/evalset/spotcheck.md`，供人类**可选地**抽查。
  验收：题目生成完成；在 HUMAN.md 里新增一条可选事项 HUMAN-03，请人类抽查（这条不阻塞任何任务）。

- [ ] **M0-T12 基线：朴素 BM25 检索** | 依赖：M0-T10
  做什么：把历史楼层切成小块，存入 FTS5；对每道题，只在提问楼层之前的内容里检索，算出 recall@5、@10、@20（证据楼层是否命中）。输出按对话和题目类型分别统计。
  验收：报告追加到 health（私有版和统计版各一份）。

- [ ] **M0-T13 ACU 对照组** | 依赖：M0-T10、M0-T03
  做什么：解析 ACU 表格数据（`chat_metadata.sheets`，以及消息里的 `TavernDB_ACU_*`、`hash_sheets` 字段，先写探测代码弄清楚结构），在提问楼层时刻取出表格内容，判断答案是否出现在表格里（先用规范化字符串匹配；有 LLM 渠道时再加一个可选的 LLM 判定）。如果某个对话里没有 ACU 数据，就记为"不适用"。
  验收：报告里有"ACU 覆盖率"这个对照数字。

- [ ] **M0-T99 M0 验收与 M1 准备** | 依赖：M0 全部任务（M0-T11 如果被 HUMAN-01 阻塞，可以跳过，在报告里注明"事件类题目缺失"，等 HUMAN-01 处理完后再补做）
  做什么：运行所有报告；在 `docs/dev/reports/M0.md` 里总结：哪些设计假设被数据证实了，哪些被推翻了（推翻的写 ADR 并更新 DESIGN）；逐条审查不变量 I1–I10；确认 M1 的任务清单还适用（不适用就修改）。
  结果写 `MILESTONE_DONE`。

## M1：模型层与单轮生成（DESIGN §9、§10、§11）

- [ ] **M1-T01 pi 技术验证** | 依赖：M0-T99 | 部分需要 HUMAN-01、HUMAN-04
  做什么：在 `spikes/pi/` 里写最小脚本，验证 `@earendil-works/pi-ai`（先读 node_modules 里的 README 和类型定义）：① 用 openai-completions 加 `.env` 里的渠道：流式输出、思考内容、函数调用；② google-generative-ai 能不能用自定义 baseUrl 指到本地的 gcli2api（服务没运行就跳过，并记录下来）；③ abort 之后保留部分内容，再续写；④ pi-agent-core 的 `prepareRequest`、`beforeToolCall`、`finishTurn` 三个钩子。
  产出：ADR，写明是否采用 pi，以及哪些部分采用。
  验收：每一项的结果都有记录（通过、失败或跳过，并附原因）。

- [ ] **M1-T02 core/llm 接口与渠道** | 依赖：M1-T01
  做什么：定义 `core/llm` 的薄接口（流式事件、用量、中止）；渠道配置（`data/channels.yaml`，密钥用 `${ENV}` 引用 `.env` 里的变量）；同一个模型可以配多个渠道，按优先级自动切换；重试；截断检测（以 length 结束、标签没闭合、内容突然中断）；续写。用 pi 实现这个接口（或者按 ADR 的结论自己实现）。替换掉 M0-T11 的最小客户端。
  验收：用一个模拟的提供方测试切换、重试和续写的逻辑。

- [ ] **M1-T03 渠道体检** | 依赖：M1-T02
  做什么：CLI 命令 `dramaticer probe <channel>`，检测真流式还是假流式、函数调用、思考输出、预填充、用量和缓存统计，结果写回渠道配置里，供结构化输出选择模式。
  验收：模拟提供方的测试通过；用真实渠道的测试放进 `*.live.test.ts`。

- [ ] **M1-T04 原生上下文模板与组装器** | 依赖：M0-T06
  做什么：实现 DESIGN §9 的原生模板（静态段、条件段、槽位）、槽位提供者接口、token 预算裁剪（按优先级）、Trace 记录（每一段的来源和 token 数）。
  验收：测试覆盖预算裁剪、条件段、缺失槽位的情况。

- [ ] **M1-T05 块解析器** | 依赖：M0-T01
  做什么：在 core 里实现增量（流式）的标签块解析器：未闭合的块、嵌套、标签名可以配置、普通文本和块交错出现。块类型在注册表里登记，每种类型声明显示、上下文、语义三类策略的接口（具体策略留到后面实现）。
  验收：用"随机切分输入"的方式测试，结果和一次性解析完全一致。

- [ ] **M1-T06 结构化输出双模式** | 依赖：M1-T02、M1-T05
  做什么：`state_update` 和 `plot_note` 的 schema；函数调用模式（通过 pi）和文本标签模式（通过块解析器）共用同一个校验器；校验失败时的处理策略。
  验收：两种模式产出同样的结构；非法的值会被拒绝，并记录原因。

- [ ] **M1-T07 单轮生成 CLI** | 依赖：M1-T03、M1-T04、M1-T06
  做什么：`dramaticer chat --story <id>`：导入一张卡（通过 st-compat），用一个默认的原生模板组装上下文，流式生成，解析块，处理结构化输出，保存为楼层节点，写入 Trace。
  验收：用真实渠道完成 3 轮对话（live 测试）；Trace 内容完整。

- [ ] **M1-T99 M1 验收** | 依赖：M1 全部任务
  做什么：同 M0-T99；另外做一次首字延迟对比（和直接调用渠道相比）；拆解 M2 的任务（M2-T00 的工作可以在这里一起完成）。

## M2：楼层树与记忆引擎（DESIGN §5、§7）——由 M2-T00 细化

- [ ] **M2-T00 拆解 M2**：把下面的粗粒度条目拆成 M2-T01… 这样的任务，每个任务都要写清楚依赖和验收标准，然后在本文件里替换掉这一节。
  粗粒度条目：楼层树操作（swipe、编辑、分支切换、确认）；状态快照缓存；后台任务框架（独立渠道池、限速、楼层确认后触发）；事件抽取；分层摘要（依赖路径）；剧情笔记；实体和别名表；bge-m3 embedding 加 sqlite-vec（需要 HUMAN-02）；多路融合检索；知情者过滤；被动注入的槽位提供者；读取工具（memory_search、lore_lookup、state_get）；评测运行器接入完整的记忆引擎；**过关标准：召回率明显高于 ACU 对照组和 BM25 基线**。

## M3：Director（DESIGN §8）——由 M3-T00 细化

- [ ] **M3-T00 拆解 M3**。粗粒度条目：线索追踪；重复检测（embedding 版）；节奏状态机；NPC 议程（后台任务）；事件池和卡扩展字段 `extensions.dramaticer`；director 槽位；评测（重复度、伏笔回收率，开启和关闭 Director 的对比回放）。

## 兼容线（DESIGN §6、§9）——由 C-T00 细化，排在 M3 之后

- [ ] **C-T00 拆解兼容线**。粗粒度条目：预设转换成原生模板（条目对应段落、marker 对应槽位）；宏引擎（范围以 M0 报告里的宏统计为准）；正则第一层原样执行；第二层自动升级；MVU 转状态 schema；ACU 表格转初始记忆；导入时生成"跳过了哪些"的清单；**过关标准：58 个预设的可用率达到 M0 报告之后定下的目标**。

## M4：server、web 与工具——由 M4-T00 细化

- [ ] **M4-T00 拆解 M4**。粗粒度条目：server（HTTP 加 SSE，默认只监听 127.0.0.1，局域网模式必须设密码）；web（移动端优先：聊天、分支、预设和模板编辑器、记忆面板、状态面板、导演面板、Trace 面板、渠道管理）；沙箱 iframe 渲染器；写入工具和读取工具接入主循环。**这一步需要人类真实试玩（会新增 HUMAN 事项）。**

## M5：公开 alpha——由 M5-T00 细化
## M6：生图（ComfyUI 优先）——由 M6-T00 细化
## M7：Tauri 打包——由 M7-T00 细化
