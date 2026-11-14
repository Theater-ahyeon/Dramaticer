# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-14 会话 386：修复评测判定与模拟用户的输出预算与重试缺陷，重新申请 R6-T05 长任务。R6-T05-02 退出码 0 但结果不完整：`xianxia` 8/8 对、20 轮；`yuwang` 20 轮、7/8 对（分支点第 6 轮裁判连续三次没有输出合法 JSON）；`yinqi` 第 15 轮后模拟用户连续三次没有输出 `{message}`，运行失败、0 对。缓存里的响应显示：裁判与模拟用户请求固定 512 输出上限，思考模型把预算全部用在思考上、正文为空（`reasoningTokens` 511–512）；重试第 2、3 次请求逐字节相同，配合按请求体的响应缓存必然复现失败。按 ADR-0136 修复：判定与模拟用户调用在未显式配置时不发送 `maxTokens`（路由器使用模型声明上限），重试消息带尝试次数、模拟用户重试附上一次原文要求原样改成 JSON；`deep-eval` 把模拟用户输出失败记为失败轮次；深回合 sidecar 的 `failed` 状态改为续跑并清空上次错误；`r6-deep-cli` 在任一故事失败时退出码为 1。补充了判定输出上限、重试消息、模拟用户失败轮次与深回合 sidecar 续跑的回归断言，门禁通过（260 个测试文件、2,269 个测试、5 个跳过）。`yuwang` 的运行副本已删除重跑（缓存保留），`yinqi` 保留 sidecar 从第 16 轮续跑；写了 `.devloop/jobs/R6-T05-03.json`，本会话结果 `WAITING`。

## 下一步（会话 387 先做）
1. 读 `.devloop/jobs/R6-T05-03.status.json` 与 `.log`。退出码 0 时核对 `eval-private/reports/r6/deep/xianxia.json`、`yuwang.json`、`yinqi.json`：每个故事的 `summary.plannedPairs` 为 8、`summary.turns.completed` 为 20、分支记录齐全；把 R6-T05 标 `[x]` 并写完成记录（真实样本数、配对计数、胜率与区间、失败数、成本）。退出码非 0 时先在日志定位失败阶段（预热、深回合、快回合或判定），修复后换新的任务序号重新申请。`.devloop/scratch/R6-T05/` 下的检查脚本只在本地使用。
2. 然后做 **R6-T06 C1 与 C2 批量运行**（依赖 R6-T02、R6-T03）。按预注册参数运行 C1（3 个故事 × 首中末 3 个分支点 × 2 档位 × 30 轮）与 C2（每故事全部最多 10 个分支点，至少 27 对），输入与结果写 `eval-private/reports/r6/`；写 `.devloop/jobs/R6-T06-01.json` 并结果写 `WAITING`。
3. R6-T06 完成后做 R6-T99：把 C1、C2、C3、G6 的输入交给 `r6-gate` / `evaluateR6Gates`，按预注册判定 G1–G6。预注册文档在第一次批次运行后不得修改。
4. 阻塞检查：M6-T99 仍等 HUMAN-15（ComfyUI 与 API 格式 workflow）；HUMAN-03、HUMAN-16、HUMAN-17、HUMAN-18 不阻塞。

## 当前状态
- 已完成：F0、M0–M3、D、M4-T00 至 M4-T06、R0、R1（含 R1-T99、R1-T99.a）、R3、O、R2、E、R4、R5、V-T01、M6-T00 至 M6-T05、R3b、P1–P4、C-T01 至 C-T05、H-T00 至 H-T99、X1.a 至 X1.e、X2.a 至 X2.d、R6-T00、R6-T01、R6-T02、R6-T03、R6-T04。R6-T05 实现完成，等长任务 R6-T05-03。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成（含一致性测试与共存评测）。
- 数据库 schema 版本 50。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`、`H.md`、`X1.md`、`X2.md`。
- R6 预注册：`docs/dev/R6-PREREG.md` v1、ADR-0135、DESIGN §14.2；门槛常量与判定由 R6-T01 实现，`R6_GATE_VERSION` 为 `v1`；C1 运行器由 R6-T02、B1 批次由 R6-T03、偏好一致率由 R6-T04、深回合批次由 R6-T05 实现，结果写入门槛版本。
- R6-T05 的真实运行：`.devloop/jobs/R6-T05-03.json` → `node .devloop/scratch/R6-T05/run-deep.mjs`，串行跑 `xianxia`、`yuwang`、`yinqi` 三个故事。源数据库是 `eval-private/world-model-compare/source/<slug>.db`；每个故事的结果在 `eval-private/reports/r6/deep/<slug>.json` 与 `.md`，运行副本和 sidecar 在 `eval-private/reports/r6/deep/<slug>/`。预热按显式预热楼层构建结算窗口，每 4 楼一次请求，不再从最早未结算楼层开始。`xianxia` 复用上一轮完成的运行；`yuwang` 的运行副本已删除重跑；`yinqi` 从第 16 轮续跑。
- 世界模型：默认 `ledger`；`wiki` 与 `temporal_graph` 已经可用，由故事设置 `worldModel` 选择，只有 `temporal_graph` 支持 `atStoryTime`。
- 导演组织方式：默认 `mechanisms`（现有机制序列）；`bits` 已可用，由故事设置 `directorOrganization` 选择。X2 判定见 ADR-0134 与 `docs/dev/reports/X2.md`。
- X2 的输入与运行脚本在 `.devloop/scratch/X2.d/`：`inputs/`（消息、小品、条件样本）、`run-compare.mjs`、`summarize.mjs`、`runs/<slug>/`（复制数据库、缓存与 sidecar）、`smoke/`（2 轮冒烟结果）。长任务状态在 `.devloop/jobs/X2.d-01.status.json`（退出码 0）与 `.log`。
- X1 的原始数据在 `eval-private/reports/world-model-compare/`（含故事标题与回复，不进入仓库）；长任务脚本与 sidecar 在 `.devloop/scratch/X1.e/`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`。
- ADR-0088 至 ADR-0136 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染、覆盖率口径、应用内助手、世界模型接口、实体档案、时序图谱、对比运行器、X1 判定、导演组织方式、剧情小品、X2 对比运行器、X2 判定、R6 预注册与评测调用输出预算的决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16、HUMAN-17、HUMAN-18 待处理（不阻塞）：临时目录清理、ST-Prompt-Template 与酒馆助手上游许可证确认。

## 可重复命令
- 门禁：`pnpm check`。
- R6 门槛与指标的目标测试：`pnpm exec vitest run packages/st-compat/test/gates.test.ts packages/st-compat/test/metrics.test.ts`。
- R6 深回合批次目标测试：`pnpm exec vitest run packages/st-compat/test/r6-deep.test.ts packages/st-compat/test/deep-eval.test.ts`。
- R6 深回合单故事（默认 20 轮、8 个分支点）：`pnpm --filter @dramaticer/st-compat r6-deep --db <源库> --story <id> --dir <运行目录> --json <结果 json> --report <报告 md>`。
- R6 深回合缩样：在上面命令上加 `--rounds 2 --branches 2`。
- R6 深回合三故事长任务：`node .devloop/scratch/R6-T05/run-deep.mjs`（复用 sidecar；`done` 的跳过，`failed` 与 `running` 续跑）。
- R6 C1 运行器目标测试：`pnpm exec vitest run packages/st-compat/test/r6-compare.test.ts`（约 60 秒）。
- R6 B1 批次目标测试：`pnpm exec vitest run packages/st-compat/test/r6-b1.test.ts`（约 15 秒）。
- R6 偏好一致率目标测试：`pnpm exec vitest run packages/st-compat/test/r6-preference.test.ts`（约 2 秒）。
- 判定与模拟用户重试目标测试：`pnpm exec vitest run packages/st-compat/test/pairwise.test.ts packages/st-compat/test/playtest.test.ts packages/st-compat/test/probe.test.ts`。
- EJS 沙箱与预算目标测试：`pnpm exec vitest run packages/st-compat/test/st-ejs-sandbox.test.ts packages/st-compat/test/st-ejs-budget.test.ts`。
- R6 C1 单个故事（默认 30 轮、首中末 3 个分支点）：`pnpm --filter @dramaticer/st-compat r6-compare --db <源库> --story <id> --dir <运行目录> --json <结果 json> --report <报告 md>`。
- R6 C1 缩样：在上面命令上加 `--rounds 2 --branches <楼层>`（`--branches` 只能配一个故事，楼层必须是规划结果里的助手楼层）。
- R6 B1 全部样本：`pnpm --filter @dramaticer/st-compat r6-b1 --db <源库> --story <id> --dir <运行目录> --json <结果 json> --report <报告 md> [--historical-models <映射 json>]`。
- R6 B1 缩样：在上面命令上加 `--branches <楼层>`（只能配一个故事，楼层必须是规划结果里的助手楼层）。
- R6 偏好一致率：先 `pnpm --filter @dramaticer/st-compat preferences export --db <源库> --out <导出目录>`，再 `pnpm --filter @dramaticer/st-compat r6-preference --db <源库> --pairs <导出目录> --dir <运行目录> --json <结果 json> --report <报告 md>`；记录在 `<运行目录>/records.jsonl`。
- X2.d 重跑（断点续跑，已完成候选用 sidecar）：`node .devloop/scratch/X2.d/run-compare.mjs`。
- X2.d 指标汇总：`node .devloop/scratch/X2.d/summarize.mjs`。
- X2.d 单个故事：`node packages/st-compat/dist/evalset/director-organization-compare-cli.js --db <源库> --story <故事> --messages .devloop/scratch/X2.d/inputs/<slug>.messages.json --bits .devloop/scratch/X2.d/inputs/<slug>.bits.json --conditions .devloop/scratch/X2.d/inputs/<slug>.conditions.json --rounds 8 --repeat 3 --seed 1 --model main-fallback --judge-model judge --background-model background --dir .devloop/scratch/X2.d/runs/<slug>`。
- X2.d 冒烟：把上面命令的 `--rounds` 改 2、`--repeat` 改 1、`--dir` 改 `.devloop/scratch/X2.d/smoke`。
- X2.c 目标测试：`pnpm exec vitest run packages/st-compat/test/director-organization-compare.test.ts`。
- X2.b 目标测试：`pnpm exec vitest run packages/core/test/director-bits.test.ts packages/core/test/director-organization.test.ts packages/core/test/card-extension.test.ts packages/core/test/plugin-background-tools.test.ts packages/st-compat/test/dramaticer-extension.test.ts packages/server/test/stories.test.ts`。
- X1 长任务（重跑会复用 sidecar）：`node .devloop/scratch/X1.e/run-compare.mjs`。
- X1 目标测试：`pnpm exec vitest run packages/st-compat/test/world-model-compare.test.ts`。
- H-T99 真实渠道验收：`node .devloop/scratch/H-T99/live.mjs`。
- 不变量检查：`node scripts/check-invariants.mjs`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。X1、X2 与 R6 的 JSON 含回复与答案，只能放在私有目录。
- R6 预注册 v1 在第一次批次运行后冻结：门槛、样本、指标、模型与种子都不改；必须调整时另写 v2、记 ADR、把评测轮次计数重置为 0。门槛常量与 `docs/dev/R6-PREREG.md` 必须逐项一致，`evaluateR6Gates` 不允许缺项回落。
- `gates.ts` 的 G6 少于 30 对时状态为 `insufficient`，报告里同时出现在 `insufficient` 与 `unproven`；其他门槛 `insufficient` 会让 `passed` 为 false。G1 的故事覆盖按 `completedPairs > 0` 计数，故事完成数合计必须等于配对合计，否则输入校验抛错。
- `metrics.ts` 的 `measureReplyRepetition` 是 R6 的相邻回复口径；`measureBlockRepetition` 是按行切块的 X2 与记分牌口径。两个口径不要混用，X2 的数字用后者保持不变。
- R6 的分支点按路径深度取：主路径长度的 10% 到 100%，每个比例取最近的助手楼层，保留其后有非空玩家消息与历史回复的点，去重后每故事最多 10 个；C1 取首、中、末 3 个，B1 取全部。`--branches` 只接受规划结果里出现的助手楼层。
- R6 的 C1 两档必须共用同一串玩家消息：原生档先生成并写入 sidecar，朴素档逐字重放；sidecar 校验故事、分支点、轮数、种子、写作/用户/裁判模型，朴素档还校验消息哈希，输入变化时失败并提示删除。
- R6-T02 的 sidecar 在 `<dir>/runs/<故事>/<楼层>/<档位>.json`，数据库是同目录的 `<档位>.db`；状态 `running` 时续跑，`done` 与 `failed` 直接复用。续跑按记录里的 `assistantNodeId` 把 head 对齐到记录末尾，避免进程在写 sidecar 前退出造成重复楼层。
- R6-T02 的预热逐楼把 head 移到预热楼层再调用 `settle`，把结算窗口限制在该楼层以内，结束后恢复到分支点；`scene` 对已有分析的楼层跳过。预热请求（`settleRequests` + `sceneRequests`）单列，不计入每轮成本。
- R6-T02 的探针只对原生档：每 6 轮一次、事实年龄至少 10 楼、每次运行最多 5 次；答题用写作客户端，判定用裁判客户端，两者的请求都记在 `probeRequests`。
- R6-T02 的报告把同一故事同一档位下所有运行的重复度与推进度原始值池化后取均值（sidecar 保存逐值），失败轮次不进入这两个指标。
- R6 的每个运行副本在开跑前对分支点之前最近 12 个已生成完成的助手楼层执行 `settle` 与 `scene`，只写复制库；台账覆盖范围只到预热窗口，报告必须单列这一限制。
- 预热的结算窗口用 `prepareSettlementForNodes` 按预热楼层显式构建，每 4 楼一次请求；不要改回后台结算处理器，它会按“沿路径最远的未结算楼层优先”取窗口，长历史下预热楼层轮不到，现场分析会一直退回 pending。
- `prepareSettlementForNodes` 只校验窗口大小与楼层存在，不校验角色、落定状态与 head 路径；调用方要先把 head 移到窗口最后一楼，并按从旧到新的顺序传楼层。
- R6 的胜率都按配对计数：两种展示顺序各判一次，胜率分母只含胜与负，平与换序不一致不计入分母；Wilson 95% 区间用配对计数计算。
- R6 的 G6 是条件门槛：真实偏好配对少于 30 对时记未证实；B2 只在 B1 未通过且完成一轮改进后申请，单次不超过 60 次生成，必须先得到 HUMAN.md 确认。
- R6-T03 的 B1 每个分支点只生成一轮：复制源数据库、预热 12 楼后，用分支点之后第一条非空玩家消息跑一次原生续写，回合后不执行后台任务；sidecar 在 `<dir>/runs/<故事>/<楼层>/b1.json`，数据库是同目录的 `native.db`。
- R6-T03 的配对结果只用两种顺序都完成的样本：生成失败与判定失败都记入排除计数，`outcome` 为 null；质量评分失败只计入质量失败，不改变配对结果。历史回复模型从 DB 里读不到，CLI 的 `--historical-models` 接受 `{节点 id 或 "<故事>:<楼层>": "模型名"}` 的 JSON 映射；没有映射时家族清单为空并写明未记录。
- R6-T04 用 `preferences export` 的 `.pairs.jsonl`，记录在 `<dir>/records.jsonl`，按样本与顺序续跑；失败记录同样复用，重试需要删除记录文件。已有记录的裁判模型与本次不一致时直接失败。记录不属于当前样本（导出变化）时也直接失败，提示删除记录文件。
- R6-T04 的 G6 输入只含配对数：一致、不一致、平、换序不一致与失败；一致率分母只含完成配对，少于 30 对时 `insufficient` 为 true，判定留给 `evaluateR6Gates` 的 `unproven`。仓库报告不列样本 id、正文或错误原文。
- R6-T05 每个故事一个副本，运行从该故事的 head 开始；预热 head 之前最近 12 楼，再跑 20 轮深回合。分支点是轮次，不是源数据库里的楼层；`selectBranchRounds(completedRounds.length, 8)` 在全部轮次完成时等于 `selectBranchRounds(20, 8)`。sidecar 在 `<dir>/runs/<故事安全名>-<hash>/deep.json`，数据库是同目录的 `deep.db`；`done` 复用，`running` 与 `failed` 都续跑。
- R6-T05 的续跑按最后一条已完成深回合的 `nodeId` 对齐 head；分支记录按 `sampleId`（`<故事>#round-<轮次>`）去重，已完成的样本不重复判定，失败的分支记录会在续跑时重试。深回合连续失败 3 轮终止该次运行（模拟用户输出失败也算一轮失败），`deep-eval` 的可选 `maxConsecutiveFailures` 默认不终止。
- R6-T05 的配对归一只看 `judgements`：`deep-first` 的 A、`fast-first` 的 B 属于深回合侧，反之为快回合侧；两种顺序的侧再交给 `normalizePairOutcome`。计划配对是故事数 × 分支数，`failures = plannedPairs - completedPairs`，报告同时给出分支失败与缺失配对。
- R6-T05 的报告成本只统计写作、用户、裁判与预热的请求数，token 来自深回合记录；快回合的 token 没有单独记录，写作请求数包含快回合。仓库报告不得出现故事标题或正文。
- 评测里的结构化判定与模拟用户调用（`pairwise`、`quality`、`turn-judge`、`probe` 裁判、`generateUserMessage`）默认不发送 `maxTokens`，由路由器使用模型在渠道里声明的上限（ADR-0136）；判定重试带尝试次数，模拟用户重试还会附上上一次原文。
- `r6-deep-cli` 在任一故事状态为 `failed` 时退出码为 1；长任务脚本按退出码停止，不要再用日志里的“全部完成”判断成功。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁连跑或与大量临时目录写入同时进行时，Windows 的系统扫描会拖慢文件与 SQLite 操作，出现过后台 worker 激活超时与 `gap-pass-compare` 的 30 秒用例超时；这些用例单独运行都通过。门禁失败先看失败是否只在整轮并行时出现，不要连续并发跑多轮整仓测试；`gap-pass-compare` 的 3 个用例上限已放宽到 180 秒。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- EJS 沙箱的时间预算按墙钟计，`StEjsSandbox.run` 从 dispatch 开始计时，包含新建 worker 与 worker 里 `require("ejs")` 的耗时；`runTurnHook` 的 `remainingMs()` 同样扣掉这部分。测试不要用接近 worker 启动耗时的预算（300 毫秒在整轮并行下会误判超时），要验证超时终止用 2 秒以上。
- `pnpm exec biome check --write <文件>` 处理格式；不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。上下文摘要按结构化请求处理，也使用 `NO_CONTINUATION`。
- 世界模型只用故事设置 `worldModel` 选择；新增调用方传 `settings.worldModel`，不要自己判断种类或回落到台账。状态槽位的 `packKey` 必须带种类（`state:<kind>`），否则不同表示会共用上下文包指纹。
- 导演组织方式只用故事设置 `directorOrganization` 选择；新增调用方传 `settings.directorOrganization`。导演槽位持有 `DirectorEngine`，`packKey` 带组织方式与机制名；单轮强度覆盖用 `engine` 重建槽位，不要重新按种类构造，否则会丢掉引擎里的缓存状态。
- `DirectorEngine.evaluate` 负责写本楼层的决策记录；导演关闭时返回 null 且不写记录。`mechanisms` 引擎的决策记录仍由 `evaluateDirector` 生成；`bits` 引擎自己写逐条小品记录与 `signals.selected`。
- 剧情小品的条件是 `{kind:"text", text}` 或 `{kind:"ledger", query}`；`query` 复用模板条件语言，但每条 `state.path[0]` 必须是台账命名空间。兜底小品必须省略条件；普通小品必须提供条件。`after` 引用同一批小品里的 id，悬空引用与顺序环在导入时拒绝。
- `director_bits` 后台任务（入队 `settled`、间隙档）一次调用判断本楼层全部文本条件；结果写入 `story_director_bit_judgments`，带文本条件指纹。引擎读当前路径上最近的判断记录，指纹不匹配就当缺失。条件文本改动后不需要删缓存。
- `bits` 引擎在同一层只返回一条建议：普通小品按优先级选，普通小品都没有命中时才比较兜底小品；决策记录为每个小品写一条原因。没有小品时写一条名为 `bits` 的未触发记录。
- `replaceDirectorBits` 是整批替换，用于卡导入；不要逐条 upsert 后留下旧条目。导入结果里 `bits.replaced` 表示替换后的小品数。
- X2.c 运行器只在复制数据库里写 `directorOrganization` 与小品；源库只读。`--bits` 不传时使用源库已有小品，两个候选共用同一批。小品指纹进入 sidecar 校验，改小品后旧运行结果会要求删除重跑。
- X2.c 的 `bits` 候选在开跑前对起始楼层判断一次，每轮结束对新助手楼层判断一次，走的是 `createDirectorBitJudgmentsHandler` 同一入口；判断请求计入每轮成本。判断失败只记错误，候选继续运行。
- X2.c 的条件样本核对会为每条样本建独立临时故事，人工标注为准；`missing` 与 `failed` 都计入准确率分母，样本的 `bit.id` 必须等于样本 `id`，否则引擎明细按 id 取不到，会记为 `missing`。基础 fixture 是 `packages/st-compat/test/fixtures/director-conditions.json`，改动或追加样本不要引用私有原文。
- X2.c 的推进度从第 2 轮起算：第 1 轮没有前文基准，不进入分母。线索兑现只看运行内新建的剧情笔记，运行前已有笔记不计入；结构化输出为 function-call 时，模型不调用写入工具就产生 0 条笔记，两边都可能是 null。
- X2.d 的 8 轮实跑里 `xianxia` 的对照没有新建笔记、`bits` 3/3 兑现，`yuwang` 2/3 对 1/2，`yinqi` 对照没有新建、`bits` 1/2；兑现率分母只有 1–3 条，判读时同时看分母（ADR-0134）。
- X2.d 的盲测判定失败 3 条（`yuwang` 1、`yinqi` 2），只记入报告，不计入胜负与平局；裁判位置互换一致率为 `xianxia` 75.0%、`yuwang` 34.8%、`yinqi` 63.6%，盲测只作辅助证据。
- `WorldModel.read` 的 `atStoryTime` 只有 `temporal_graph` 支持；台账与 wiki 会直接抛错。时间点标签必须是在当前路径上出现过的文字，顺序按首次出现建立（ADR-0128）；评测探针不要假设它等价于真实时间轴。
- 时序图谱的失效段只在当前视图的 `sections` 里；时间点查询的 `state` 由命中的版本累加，`sections` 为空。`versions(nodeId)` 是调试与评测入口，不在状态槽位里使用。
- 实体档案（`wiki`）的写入路径是 `["profile", "<人物>"]`，其余路径按台账 diff 校验；档案实体必须是台账 `character` 里的人物，人物字段逐项写，整对象写人物会被 `validateLedgerDiff` 拒绝。
- `world_wiki_revisions` 只追加：没有更新与删除接口，修改由触发器拒绝；读取按当前路径的递归 CTE，分支切换不跨分支。
- `WorldModel.write` 先逐条 `validateLedgerDiff` 再写，供对比运行器使用；剧情结算仍走 `applySettlementProposals`，不要用这个接口绕过结算器（I12）。
- X1.d 的源数据库只读打开一次用于挑探针，随后关闭；所有写入都在复制出来的数据库里。重跑复用 `runs/<候选>/<序号>.json`，修改玩家消息或种子会导致校验失败并提示删除 sidecar。
- X1.d 的盲测上下文只用玩家消息前缀，不包含候选各自的正文；两轮文本完全相同时裁判直接判平局，不调用模型。
- X1.d 的每轮成本只统计写作客户端的非缓存请求与 Trace 耗时；记忆题、探针与盲测裁判的请求单独发生，不计入每轮成本。
- X1 的源数据库用 ASCII 文件名：全角文件名在 Windows 的 Node `fs.rmSync` 上会直接以 `0xC0000409` 终止进程。
- X1 的矛盾率分母是召回探针加记忆题里被判为一致或矛盾的记录；不同候选的可判定记录数不同（97、77、81），比较时同时看样本数。
- MVU 引擎的 `[值, 说明]` 判定与 MVU 一致：长度为 2 且第二个元素是字符串的普通数组也会被当成值加说明，测试与真实卡都要避开这种歧义；需要真正两个元素的列表时用三个元素或开启 `strictSet` 后显式写结构。
- 显示状态只在当前会话；需要跨进程显示时由台账快照重新渲染，不要把它写成楼层原文或台账事实。
- 共存适配器在 `apply` 之后按轮调用 `afterTurn`；插件写错直接让运行失败，不要吞掉错误。`st-mvu` 适配器要求卡里有 `[initvar]` 世界书或开场白 `<initvar>`。
- 共存评测的关闭组：适配器提供 `baseline` 时用 `<runDir>/<pluginId>/off`；不提供时用 `<runDir>/baseline/off`。`afterTurn` 只在开启组执行。
- 共存盲测的平局不计入胜负；两份文本完全相同时 `judgePairwise` 不调用裁判、直接判平局。
- `st-helper-host` 的共存批次不执行脚本：Node 里没有 iframe；开启组只做脚本库发现与状态栏渲染请求，两组提示词逐字节相同。脚本执行由沙箱单元测试与浏览器 e2e 覆盖。
- EJS 模板里再写 `<%` 会被外层标签解析截断：内层模板通过变量或 `evalTemplate` 的第二参数传入。
- `st-ejs` 的激活正则默认一次性生效（命中后停用）；注入标记与 `@INJECT` 必须独占一行才会被识别。
- 沙箱里模板函数是同步的（远程调用会阻塞模板线程），函数参数与返回值必须能 JSON 化；`define` 只在一次执行内有效，`include` 不可用。
- 回合预算只从调用方传进来：槽位提供者用 `request.budget`，直接调用运行时用 `render(text, { budget })`。
- `StEjsVariableStore` 接入 `backend` 后，不指定作用域的写进入 `initial`（台账 `mvu`），global/message/local 仍是插件内存。
- 模板生成只登记请求：`generate` 返回 id 不返回正文，宿主用 `createStEjsBackgroundGenerationRunner` 接后台客户端并在间隙 `drain`。
- 酒馆助手的沙箱 API 全部异步：`postMessage` 不能同步取返回值，脚本必须 `await`。事件监听用整数 token；超时由宿主 `sweepTimeouts()` 驱动。
- STscript：`triggerSlash` 只执行 `ST_HELPER_SLASH_COMMANDS` 里的命令，未知命令按名字失败。变量命令默认作用域与上游一致（`setvar` 是 chat/local）。
- `/gen` 与 `/genraw` 只登记后台请求并返回请求 id，不返回正文，回合内不等待。
- HTML 状态栏与开场页的渲染结果只在插件显示状态（`PluginDisplayState`）；要把它们接入界面时读 `readStHelperHtmlPage`，不要写回楼层原文或台账。
- 状态栏自动重渲染由变量写入触发，连续自动刷新默认上限 8 次；开场页不参与自动重渲染。
- 酒馆助手的 API 覆盖率快照以本机 JS-Slash-Runner 4.8.10 为准；升级上游版本时要重新生成 `coverage.ts` 的名字清单并同步报告与测试断言。
- 助手任务不要复用 `turn_runs`；助手运行状态与事件在 `assistant_conversations`、`assistant_events` 里。批准助手动作时调用现有写入函数。
- 助手接口的请求与响应类型放在 `packages/protocol`，不要从 web 直接 import `@dramaticer/core` 的运行时。
- 助手并发启动有两层保护：server 的 `AssistantRunCoordinator` 返回 409，store 的 `startAssistantConversationRun` 在同一事务里拒绝第二个 running。
- 助手工具的 `permission` 是助手自己的三级权限判定；传给深回合执行器时统一为 `read`。
- `assistant_actions` 的待定唯一索引以规范化 JSON 载荷为键；同会话同种类同载荷复用已有待定动作。批准顺序是先校验、再调用领域写入、最后改状态。
- 台账变更卡来源增加 `assistant` 后，`assistantConversationId` 只允许助手来源填写；批准仍走 `approveLedgerChangeCard`，任何权限级别都不能自动批准。
- 技能注册表以 `packages/core/src/assistant/skills.ts` 为唯一来源；新增技能在注册表里登记，server 端创建与 PATCH 会话都按注册表返回 400。
- 技能白名单里的工具名必须在本次运行实际注册；未注入时带该名字的技能会让 `runAssistantTurn` 在切换运行状态前抛错。
- `AssistantDocsIndex.load` 每次 `startServer` 都会读取并切分文档（约 1.6 MB），server 测试的启动耗时会增加数百毫秒。
- 提案工具在 server 里对所有会话注入，靠白名单过滤；不要按权限过滤工具名。
- 台账变更卡 id 包含当前 head：同一内容在 head 未变时复用同一张卡，head 变化后会生成新卡。
- `summarize_recent` 只读现有压缩与摘要；新增摘要仍然走后台任务。
- 联网搜索只由 `--assistant-web-search` 开启；测试只注入假客户端。
- 渠道读取不返回密钥值；`propose_channels_change` 四个段必须给全，批准时仍由 `readChannelsUpdate`、`applyChannelsUpdate` 与 `parseChannelsConfig` 校验并写文件。
- 抽屉的持久状态只有 localStorage 里的活动会话 id；消息、状态与事件都以 server 为准，不要缓存正文。
- 重连轮询必须在改状态之前把会话详情与消息写入状态；`status` 变化会触发 effect 清理。
- 关闭抽屉的焦点恢复要等两帧；触发按钮用选择器 `.assistant-open-button` 查找。
- 压缩记录只追加；需要重新压缩只能新增一条，最新一条生效。
- 自动压缩在 server 的消息接口里执行，`runAssistantTurn` 自身不触发压缩。
- 压缩失败的自动运行仍然返回模型回答；不要因为压缩失败把会话标成失败或丢弃消息。
- 待确认数量与待确认视图必须同源：`refreshPendingActions` 同时读动作与变更卡。
- 审阅面板的渠道字段只能渲染白名单字段；原始载荷不要直接 `JSON.stringify` 到界面。
- e2e 的审阅种子按 Playwright 项目名分开（`e2e-assistant-review-mobile`、`e2e-assistant-review-desktop`）。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以；助手类型从 `@dramaticer/protocol` 取。
