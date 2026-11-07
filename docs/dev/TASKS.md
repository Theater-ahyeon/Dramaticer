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

- [x] **M1-T01 pi 技术验证** | 依赖：M0-T99 | 部分需要 HUMAN-04、HUMAN-05
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

- [ ] **M2-T01 楼层树操作与分支指针** | 依赖：M1-T07 | DESIGN §5
  做什么：
  - 迁移 v3：给 `stories` 增加 `head_node_id`（可空，引用 `nodes(id)`）；`appendNode` 在同一个事务里把 head 指向新节点。
  - `setHead(storyId, nodeId)`、`getHead(storyId)`、`getPathToHead(storyId)`。节点不存在、节点属于其他故事、故事不存在都直接抛错。
  - `swipeNode(nodeId, raw)` 与 `editNode(nodeId, raw)`：在节点的父节点下新建同角色的兄弟节点，旧节点保留，新节点成为 head。`raw` 为空或节点不存在时抛错。
  - `isNodeConfirmed(nodeId)`：节点有子节点即为已确认。`appendNode` 创建子节点时父节点自动确认。
  - `runChatTurn` 与 `dramaticer chat` 改用 head 作为父节点，不再使用全局最后插入的楼层。
  验收：swipe 与 edit 生成兄弟节点、旧节点原文不变、head 更新、`getPathToHead` 正确；切到旧分支后路径只含该分支；跨故事与缺失节点抛错；追加子节点后父节点变为已确认；裸连接 UPDATE 楼层原文仍被触发器拒绝；`pnpm check` 通过。

- [ ] **M2-T02 状态快照缓存** | 依赖：M2-T01 | DESIGN §5
  做什么：
  - 迁移 v4：新增 `state_snapshots(node_id PRIMARY KEY, story_id, state, computed_at)`。
  - `getStateSnapshot(nodeId)`：命中缓存直接返回；否则取父节点快照，叠加本楼层的 diff，用 `applyStateDiffs` 计算后写入缓存。`getStateSnapshotAtHead(storyId)` 是同一逻辑的入口。
  - `appendStateDiffs` 在写入后删除该楼层及其全部后代楼层的快照缓存，避免后代使用过期结果。
  - `createStateSlotProvider` 改用快照，不再每轮从根节点回放；输出格式保持不变。
  验收：随机路径上快照与逐条 diff 回放完全一致；同一节点第二次读取不重新计算（`computed_at` 不变）；追加 diff 后该节点与后代缓存失效；不同分支的快照互不影响；删除型 diff 与 `__proto__` 路径的用例通过；`pnpm check` 通过。

- [ ] **M2-T03 后台任务框架** | 依赖：M2-T01 | DESIGN §4、§7、§14
  做什么：
  - 迁移 v5：新增 `background_jobs(id, story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at, UNIQUE(node_id, kind))`，状态取 `pending`、`running`、`done`、`failed`。
  - 任务类型注册表。`enqueueMissingJobs(storyId)` 扫描已确认节点，为每个尚未入队的类型补建任务；重复调用不产生重复行。
  - `drainBackgroundJobs({storyId, client, kinds, limit, now})`：先补齐任务，再按创建顺序执行；处理器通过注入的注册表获得 `{store, client, job}`；失败时记录错误并按最多 3 次重试，超过后标为 `failed`。后台模型使用 `data/channels.yaml` 的 `background` 别名，限速由现有 `LlmRouter` 负责。
  - `dramaticer work --db <path> [--limit <n>] [--kind <kind>]`：单次执行一轮任务并打印统计，不启动长期进程。
  - `runChatTurn` 不调用后台模型；主循环与后台任务的客户端分开创建。
  验收：已确认节点才会入队；同一节点同一类型只有一行；drain 执行一次处理器后标为 `done`；失败按次数重试后标为 `failed` 并保留最后错误；`--kind` 只执行指定类型；chat 轮次中后台客户端零调用；`pnpm check` 通过。

- [ ] **M2-T04 实体与别名表** | 依赖：M2-T01 | DESIGN §7
  做什么：
  - 迁移 v6：新增 `entities(id, story_id, kind, name, description, source, created_at)` 与 `entity_aliases(entity_id, alias, normalized_alias)`；同一故事内 `normalized_alias` 唯一。
  - core 定义 `EntityKind`（`character`、`location`、`item`、`faction`、`lore`、`unknown`）与实体读写接口；名称规范化复用 NFKC、大小写折叠、去空白与标点。
  - `upsertEntity` 合并同名实体与别名；`resolveEntities(alias)` 按规范化后的别名返回实体列表。
  - st-compat 新增角色卡与世界书的实体导入：角色卡的名字作为 `character`；世界书条目的名字或 `comment` 作为 `lore` 实体名，主关键词作为别名。core 不出现世界书、角色卡等 ST 类型。
  验收：合成角色卡与世界书导入后实体数、别名数符合预期；重复名称与别名合并；全角、大小写、标点差异能命中同一实体；一个别名对应多个实体时返回全部；缺失字段的条目跳过并在导入结果里计数；`pnpm check` 通过。

- [ ] **M2-T05 事件抽取** | 依赖：M2-T03、M2-T04 | DESIGN §7
  做什么：
  - 迁移 v7：新增只追加的 `memory_events(id, story_id, source_node_id, ordinal, story_time, location, participants, importance, knowers, text, created_at)`，`UNIQUE(source_node_id, ordinal)`；`participants` 与 `knowers` 存 JSON 数组；数据库触发器拒绝 UPDATE 与 DELETE。
  - 后台任务类型 `events`：沿路径取已确认节点及其前面最多 8 楼作为窗口，用 `background` 模型输出 JSON 数组。每条包含 `text`（非空）、`participants`、`knowers`、`importance`（0 到 1）、可选的 `storyTime` 与 `location`。
  - 严格校验：任一字段类型不符、`importance` 越界、数组里出现空字符串时整批不写入，任务记为失败并保留原因；成功后在一个事务里写入该楼层的全部事件。
  - `getEventsForPath(nodeId, options)` 按楼层顺序返回事件；同一楼层重复执行不产生重复行。
  验收：假客户端返回 3 条合法事件时全部写入；包含一条非法事件时整批不写入且任务有错误原因；重跑不重复；`getEventsForPath` 的分页与 limit 正确；触发器拒绝修改与删除事件；`pnpm check` 通过。

- [ ] **M2-T06 分层摘要** | 依赖：M2-T03 | DESIGN §5、§7
  做什么：
  - 迁移 v8：新增 `summaries(id, story_id, level, start_node_id, end_node_id, text, token_count, created_at)`，`level` 取 `chapter` 或 `mainline`，同一故事、级别、起止节点唯一。
  - `isSummaryValid(summary, headNodeId)`：起止节点都在 head 的路径上，且起点在终点之前。`getValidSummaries(storyId, headNodeId)` 只返回有效摘要。
  - 后台任务类型 `summary`：每 20 个已确认的助手楼层生成一条章节摘要，覆盖上一章节结束之后的楼层；每 5 条章节摘要生成一条主线摘要。窗口大小做成可注入参数。
  - 摘要请求只使用窗口内的楼层原文，不携带其他分支的内容；写入前校验 `text` 非空、`token_count` 由现有估算器重新计算。
  验收：路径上的摘要有效，切到其他分支后旧摘要失效；章节与主线的唯一约束生效；重复执行不产生重复行；窗口参数变化时范围正确；空窗口不调用模型；`pnpm check` 通过。

- [ ] **M2-T07 剧情笔记** | 依赖：M2-T01 | DESIGN §7、§11
  做什么：
  - 迁移 v9：新增 `plot_notes(id, story_id, source_node_id, text, status, created_at, fulfilled_at)`，`status` 取 `open` 或 `fulfilled`。
  - `runChatTurn` 在写入助手楼层的事务里保存 `structured.notes`，每条笔记关联助手楼层；`note` 的文本不可修改，数据库触发器只允许更新 `status` 与 `fulfilled_at`。
  - `fulfillPlotNote(noteId, at)` 只接受 `open` 笔记；`getOpenPlotNotes(storyId)` 按创建顺序返回。
  - 两种结构化输出模式产生的笔记走同一写入路径。
  验收：文本标签模式与函数调用模式各写入一条笔记；`fulfill` 后不再出现在 open 列表；对已兑现笔记再次 `fulfill` 抛错；裸连接修改笔记文本被触发器拒绝；事务失败时助手楼层与笔记一起回滚；`pnpm check` 通过。

- [ ] **M2-T08 运行时分块与 BM25 索引** | 依赖：M2-T01 | DESIGN §7、§14
  做什么：
  - 迁移 v10：新增 `chunks(id INTEGER PRIMARY KEY, story_id, node_id, ordinal, text)` 与 FTS5 trigram 的 `chunks_fts`；`appendNode` 在同一个事务里用现有 `chunkText` 与 `normalizeRetrievalText` 写入该楼层的块。
  - 迁移完成后对已有楼层做一次回填；回填可重复执行，不产生重复块。
  - `searchChunks(query, {storyId, beforeNodeId, limit})`：`beforeNodeId` 只搜索该节点祖先路径上的楼层，排除该节点自身与其他分支；没有 `beforeNodeId` 时搜索整个故事。
  - 现有离线 `ChunkIndex` 保留给 st-compat 的基线评测；运行时检索只读 `StoryStore` 内的索引。
  验收：一楼的块数与 `chunkText` 一致；分支上的楼层不出现在当前路径的检索结果里；全角文本与带标点查询能命中；同一楼层多个块只占一个结果位次；回填重复运行后块数不变；`pnpm check` 通过。

- [ ] **M2-T09 embedding 客户端与向量索引** | 依赖：M2-T03、M2-T08 | DESIGN §7、§13 | 需要 HUMAN-02（已完成）
  做什么：
  - 新增 `sqlite-vec` 与 `@types`（如果有）；在 `DEPENDENCIES.md` 登记。`StoryStore.open` 加载扩展。
  - core 新增 `EmbeddingClient` 接口与 OpenAI 兼容实现：`/embeddings`、批量、限速、重试、维度校验；配置写进 `data/channels.yaml` 的 `embeddings` 段（`api: openai-embeddings`、`baseUrl`、`apiKey` 环境变量引用、`model`、`dimensions`），`channels.example.yaml` 增加 `bge-m3` 示例，密钥只从 `.env` 读取。
  - 迁移 v11：新增 `chunk_vectors` 的 vec0 表，行号对应 `chunks.id`，维度来自配置（bge-m3 为 1024）。
  - 后台任务类型 `embeddings`：为已确认楼层里还没有向量的块调用 embedding 并写入；同一块不重复调用。`searchVectors(vector, {storyId, beforeNodeId, limit})` 返回最近块。
  验收：假 embedding 客户端下写入、查询与维度校验通过；同一块第二次执行不重复调用；维度不符直接抛错；后台任务失败后按 M2-T03 的规则重试；真实 `bge-m3` 的 live 测试只调用一次并验证 1024 维；默认单元测试零网络；`pnpm check` 通过。

- [ ] **M2-T10 多路融合检索** | 依赖：M2-T04、M2-T05、M2-T08、M2-T09 | DESIGN §7
  做什么：
  - core 新增 `retrieval/hybrid.ts`：输入 `{store, embedder, storyId, query, beforeNodeId, viewpoint?, limit}`，同时取 BM25 块、向量块、实体命中、事件的重要性与新近度。
  - 排名融合使用 RRF（常数 60），每一路先按自己的排序取前 K；实体命中先用别名解析，再召回该实体参与的事件与包含别名的块。
  - 返回 `RetrievalHit`，带 `kind`（`chunk` 或 `event`）、`nodeId`、`score`、`sources`（每一路的排名）。没有向量或没有实体时自动跳过该路，其余路径照常工作。
  - `limit` 默认 8，限制在 1 到 50；空查询返回最近的高重要度事件与最近块。
  验收：固定输入下排序稳定；任意一路缺失时结果仍可用且来源标记正确；实体别名能把相关事件排到前面；`beforeNodeId` 的分支过滤生效；同一节点多个块只保留最高分；`pnpm check` 通过。

- [ ] **M2-T11 知情者过滤** | 依赖：M2-T05、M2-T10 | DESIGN §7
  做什么：
  - `retrieveMemory` 接受可选 `viewpoint`。没有 `viewpoint` 时作为全知视图返回全部结果。
  - 有 `viewpoint` 时只返回 `knowers` 为空（公开）、包含 `"*"`、或通过别名解析后包含该视角的事件；原文块在没有块级知情者信息时不注入，避免泄露秘密。
  - `knowers` 与视角都先做实体别名归一化；`participants` 与 `knowers` 可以存实体名或别名，读取时解析到同一实体。
  - 返回结果里保留被过滤前的计数，便于 Trace 观察过滤量。
  验收：视角不在 `knowers` 里的事件被排除；公开事件与 `"*"` 事件保留；别名与全名互相匹配；有视角时不返回原文块；没有视角时结果与 M2-T10 一致；`pnpm check` 通过。

- [ ] **M2-T12 记忆与摘要的被动注入槽位** | 依赖：M2-T02、M2-T06、M2-T10、M2-T11 | DESIGN §7、§9
  做什么：
  - `createMemorySlotProvider`：在组装上下文时用当前用户楼层之前的路径做 `retrieveMemory`，默认取 6 条，渲染成一条 system 消息；每条带来源楼层 id 与类型（事件或原文块），重复的楼层只保留一次。没有检索结果时返回 `null`，由组装器记为 `missing-slot`。
  - `createSummarySlotProvider`：返回当前 head 下有效的主线摘要与最近一条章节摘要，超出 token 上限时按新近程度裁剪；没有有效摘要时返回 `null`。
  - 默认模板的 `memory` 与 `summary` 段接入这两个提供者；Trace 的来源写成 `memory:<条数>` 与 `summary:<级别>`。
  验收：槽位按 limit 取结果并按路径过滤；重复结果去重；分支切换后失效摘要不再出现；没有结果时记 `missing-slot`；token 上限裁剪生效；单元测试不调用模型；`pnpm check` 通过。

- [ ] **M2-T13 世界书与导演的被动注入槽位** | 依赖：M2-T04、M2-T07、M2-T10 | DESIGN §7、§9
  做什么：
  - 迁移 v12：新增 `lore_entries(id, story_id, entity_id, name, content, constant, keywords, source, created_at)`；`keywords` 存 JSON 数组。st-compat 把世界书条目导入为通用 lore 条目，`constant` 与主关键词保留。
  - `createLoreSlotProvider`：常驻条目始终注入；非恒常条目按当前对话做混合检索，只取命中的条目；同一实体或同一内容只出现一次。总 token 超过预算时先删除靠后的非恒常条目，常驻条目最后裁剪。
  - `createDirectorSlotProvider`：把未兑现的剧情笔记按创建顺序渲染成一行一条，带“距创建经过的楼层数”；不调用模型，不做实时决策。没有未兑现笔记时返回 `null`。
  验收：常驻条目每轮都出现；非恒常条目只在关键词或实体命中时出现；重复条目去重；已兑现笔记不出现；楼层年龄计算正确；预算裁剪顺序符合上述规则；`pnpm check` 通过。

- [ ] **M2-T14 读取工具与单轮执行器** | 依赖：M2-T10、M2-T12、M2-T13 | DESIGN §10、§11
  做什么：
  - 新增 `memory_search`、`lore_lookup`、`state_get` 三个读取工具的定义、JSON Schema 与执行函数；`memory_search` 调用 `retrieveMemory`，`lore_lookup` 查 lore 条目与实体，`state_get` 读快照或按路径读值。
  - 接入 pi-agent-core 的无状态单轮执行器：`prepareRequest` 注入已经组装好的上下文，`beforeToolCall` 只允许读取工具并校验参数，`finishTurn` 把工具往返限制在最多 2 轮，`identity` 设为 `{ attribution: null }`。如果 pi-agent-core 的流式接口与现有 `LlmStreamingClient` 无法共存，写 ADR 记录替代实现，验收标准不变。
  - `runChatTurn` 在函数调用模式下执行读取工具循环；文本标签模式不暴露读取工具。`state_update` 与 `plot_note` 仍然只收集，不执行。Trace 增加工具轮数与每次调用的工具名。
  验收：假客户端第一轮调用 `memory_search`、第二轮给出正文，最终正文正确且检索结果进入第二轮请求；最多 2 轮后停止；文本标签模式没有工具定义；写入工具不执行；中止信号在工具循环中生效；`pnpm check` 通过。

- [ ] **M2-T15 记忆引擎评测** | 依赖：M2-T08、M2-T09、M2-T10、M2-T11、M2-T12、M2-T13、M2-T14 | DESIGN §14
  做什么：
  - 新增 `pnpm --filter @dramaticer/st-compat memory-eval`：把 3 个私有对话导入临时数据库，建立块索引、向量索引、实体表，按需要建立事件与摘要；对 386 道题使用 `retrieveMemory` 计算命中@5、@10、@20，按题型与对话分别统计。
  - 向量生成结果缓存到 `eval-private/memory-cache/`；重复运行不重复调用 embedding 渠道。详细报告写 `eval-private/reports/m2-retrieval.md`，统计版写 `docs/dev/reports/M2-retrieval.md`（只含数字）。
  - 报告同时列出 M0 的 BM25 与 ACU 基线、每一路的单独成绩、融合后的成绩、以及被知情者过滤掉的数量。
  - 达标门槛：状态题命中@20 不低于 45%；事件题命中@5 不低于 88%，命中@20 不低于 97%；每个对话的同一题型不低于各自 BM25 基线减 2 个百分点。
  验收：命令一条完成并生成两份报告；统计版不含原文；数字可由重复运行复现；达标门槛逐条核对并写进报告；`pnpm check` 通过。

- [ ] **M2-T99 M2 验收** | 依赖：M2 全部任务
  做什么：同 M0-T99；重跑门禁与 live 测试；逐条核对 M2-T15 的分层门槛；复核 I1–I10，重点检查 I5（快照只是缓存）、I6（主循环只有一次主模型调用加最多 2 轮读取工具）、I7、I8、I9；在 `docs/dev/reports/M2.md` 里总结哪些假设被证实、哪些需要调整；确认 M3 的任务清单。
  结果写 `MILESTONE_DONE`。

## M3：Director（DESIGN §8）——由 M3-T00 细化

- [ ] **M3-T00 拆解 M3**。粗粒度条目：线索追踪；重复检测（embedding 版）；节奏状态机；NPC 议程（后台任务）；事件池和卡扩展字段 `extensions.dramaticer`；director 槽位；评测（重复度、伏笔回收率，开启和关闭 Director 的对比回放）。

## 兼容线（DESIGN §6、§9）——由 C-T00 细化，排在 M3 之后

- [ ] **C-T00 拆解兼容线**。粗粒度条目：预设转换成原生模板（条目对应段落、marker 对应槽位）；宏引擎（范围以 M0 报告里的宏统计为准）；正则第一层原样执行；第二层自动升级；MVU 转状态 schema；ACU 表格转初始记忆；导入时生成"跳过了哪些"的清单；**过关标准：58 个预设的可用率达到 M0 报告之后定下的目标**。

## M4：server、web 与工具——由 M4-T00 细化

- [ ] **M4-T00 拆解 M4**。粗粒度条目：server（HTTP 加 SSE，默认只监听 127.0.0.1，局域网模式必须设密码）；web（移动端优先：聊天、分支、预设和模板编辑器、记忆面板、状态面板、导演面板、Trace 面板、渠道管理）；沙箱 iframe 渲染器；写入工具和读取工具接入主循环。**这一步需要人类真实试玩（会新增 HUMAN 事项）。**

## M5：公开 alpha——由 M5-T00 细化
## M6：生图（ComfyUI 优先）——由 M6-T00 细化
## M7：Tauri 打包——由 M7-T00 细化
