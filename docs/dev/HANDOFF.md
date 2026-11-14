# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-14 会话 389：读取 R6-T06-01 的状态：B1 三故事批次在 37.5 分钟后退出码 1，`xianxia` 的 6 个样本（56、112、169、224、282、338 楼）已完成并写 sidecar，第 393 楼的预热结算被 `parseSettleResponse` 拒绝。失败的 `nodeId` 是 `<故事>:m386:s0`，该楼层在数据库里是**玩家**楼层，属于提示词里「冲突检查窗口」的楼层：独立结算提示词给冲突检查窗口的每个楼层也标了 `id`，模型把它当成了可写楼层。生产 `settle` 任务遇到窗口外 `nodeId` 整次拒绝、由任务框架退回 `pending`（`MAX_BACKGROUND_JOB_ATTEMPTS` 为 3），评测预热没有这一层重试，一个坏响应直接终止整条故事批次；同一条请求体重发还会命中响应缓存（ADR-0136），原样重试只会拿回同一份坏输出。
- 修复（ADR-0137）：`buildUserContent` 的冲突检查窗口不再输出楼层 `id`，段首写明它只用来核对冲突、不是可写入的楼层（与 `gap_pass` 的 ADR-0056 一致）；`warmupR6Copy` 的结算改成 `requestSettlement`，最多尝试 `MAX_BACKGROUND_JOB_ATTEMPTS`（3）次，第 2、3 次在请求末尾追加一条玩家消息，带上一次的错误与结算窗口里可写入的楼层 id，请求体因此每次不同、不会命中缓存；`settleRequests` 按实际请求计数；三次都失败时抛出最后一次的错误、不写结算记录。
- 新增测试：core 断言可写入的楼层 id 只出现在结算窗口里（冲突检查窗口不带 id）；`r6-compare` 断言首次输出非法时重试并附上错误与可写入 id（4 次请求）、连续三次非法时预热失败（3 次请求）。两个用例都用默认 30 楼的 fixture；先前用 200 楼时整轮并行门禁会撞上 vitest 的 `Timeout calling "onTaskUpdate"`（详见注意事项）。
- 已提交长任务 `.devloop/jobs/R6-T06-02.json`（`node .devloop/scratch/R6-T06/run-b1.mjs`，180 分钟），本会话结果写 `WAITING`。门禁通过（260 个测试文件、2,272 个测试、5 个跳过）。

## 下一步（会话 390 先做）
1. 读 `.devloop/jobs/R6-T06-02.status.json` 与 `.log`。退出码非 0 时先看日志定位失败样本；B1 的 sidecar 在 `eval-private/reports/r6/b1/<slug>/runs/<故事安全名>/<楼层>/b1.json`（`done` 与 `failed` 复用、`running` 续跑），修好后重新申请新的序号（`R6-T06-04.json` 之类），不要覆盖旧状态文件。
2. 核对 `eval-private/reports/r6/b1/{xianxia,yuwang,yinqi}.json`：每个故事 `plannedPairs` 为 9、`completedPairs` 合计 27、`failures` 有原因、`summary.stories` 的完成数合计等于配对合计；记录胜/负/平/换序不一致、胜率与 Wilson 区间、排除比例、裁判失败比例、历史回复模型清单与成本。G1 要求 27 对全部完成且 3 个故事全覆盖，任何失败都会使样本不足，按预注册口径处理，不改门槛。
3. B1 核对完成后跑 **C1**：`.devloop/scratch/R6-T06/run-compare.mjs` 已写好（三个故事串行调用 `dist/evalset/r6-compare-cli.js`，`--rounds 30`，不传 `--branches`，每故事默认取首、中、末 3 个分支点，合计 9 个 × 2 档位 = 540 轮；`--dir eval-private/reports/r6/c1/<slug>`、`--json <base>.json`、`--report <base>.md`；写作 `main-fallback`、模拟用户与后台 `background`、裁判 `judge`）。先按注意事项里的“运行前先构建 core”确认 `packages/core/dist` 是新代码，再申请 `.devloop/jobs/R6-T06-03.json`（超时 600 分钟），结果写 `WAITING`。C1 每轮都有后台任务与探针，预计明显长于 B1。
4. C1 跑完后在下一会话核对两份三个故事的 JSON（每档位至少 240 个相邻回复对与推进度样本，探针每运行最多 5 次、原生档可判定探针至少 30 条），再进入 **R6-T99**：把 C1、C2、C3（R6-T05，已就绪）与 G6 的输入交给 `r6-gate` / `evaluateR6Gates`，按预注册判定 G1–G6。G5 的初次判定已知未通过（换序不一致 41.7%、Wilson 下界 38.8%），按预注册第四节写 `docs/dev/R6-ROUND-1.md` 与 `R6-F1-*` 改进任务。预注册文档在第一次批次运行后不得修改。
5. 阻塞检查：M6-T99 仍等 HUMAN-15（ComfyUI 与 API 格式 workflow）；HUMAN-03、HUMAN-16、HUMAN-17、HUMAN-18 不阻塞。

## 当前状态
- 已完成：F0、M0–M3、D、M4-T00 至 M4-T06、R0、R1（含 R1-T99、R1-T99.a）、R3、O、R2、E、R4、R5、V-T01、M6-T00 至 M6-T05、R3b、P1–P4、C-T01 至 C-T05、H-T00 至 H-T99、X1.a 至 X1.e、X2.a 至 X2.d、R6-T00、R6-T01、R6-T02、R6-T03、R6-T04、R6-T05。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- R6-T06 标 `[~]`：B1 重跑长任务 `R6-T06-02` 已申请，C1 待 B1 核对后申请 `R6-T06-03`。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成（含一致性测试与共存评测）。
- 数据库 schema 版本 50。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`、`H.md`、`X1.md`、`X2.md`。
- R6 预注册：`docs/dev/R6-PREREG.md` v1、ADR-0135、DESIGN §14.2；门槛常量与判定由 R6-T01 实现，`R6_GATE_VERSION` 为 `v1`；C1 运行器由 R6-T02、B1 批次由 R6-T03、偏好一致率由 R6-T04、深回合批次由 R6-T05 实现，结果写入门槛版本。
- R6-T05 的真实结果在 `eval-private/reports/r6/deep/<slug>.json` 与 `.md`：24 对，胜 9、负 5、平 0、换序不一致 10；`xianxia` 4/3/0/1、`yuwang` 3/1/0/4、`yinqi` 2/1/0/5；深回合 60 轮全部完成、截断 2 轮（`yinqi`）；G5 初次判定未通过（换序不一致 41.7% > 30%，Wilson 下界 38.8% ≤ 50%）。
- R6-T05 的运行目录 `eval-private/reports/r6/deep/<slug>/` 里有 `runs/<故事安全名>-<hash>/deep.json` sidecar 与 `deep.db`；重跑复用 `done`，`failed` 与 `running` 续跑。`xianxia` 的 sidecar 来自 ADR-0136 修复前已完成的运行，8 对判定齐全；`yuwang` 与 `yinqi` 按修复后的参数运行。
- R6 的结算提示词在本轮改过一次（ADR-0137）：冲突检查窗口不再带楼层 id。R6-T05 的深回合批次在改前完成，B1 的 `xianxia` 前 6 个样本也在改前完成；预热结算只写各样本自己的副本，不跨样本复用。
- R6 B1 的运行目录 `eval-private/reports/r6/b1/<slug>/` 里 `runs/<故事安全名>/<楼层>/` 保存 `b1.json` 与 `native.db`；故事安全名对中文标题会退化成 `_`，所以同一故事内路径是 `runs/_/<楼层>/`，三个故事分属不同 `<slug>` 目录。
- R6 B1 缩样结果在 `.devloop/scratch/R6-T06/smoke/yuwang.json` 与 `.md`（1 对，胜 1，预热 0 楼）；批量脚本与分支计划脚本在同一目录（`run-b1.mjs`、`run-compare.mjs`、`plan-branches.mjs`）。`.devloop/` 已被 git 忽略。
- 世界模型：默认 `ledger`；`wiki` 与 `temporal_graph` 已经可用，由故事设置 `worldModel` 选择，只有 `temporal_graph` 支持 `atStoryTime`。
- 导演组织方式：默认 `mechanisms`（现有机制序列）；`bits` 已可用，由故事设置 `directorOrganization` 选择。X2 判定见 ADR-0134 与 `docs/dev/reports/X2.md`。
- X2 的输入与运行脚本在 `.devloop/scratch/X2.d/`：`inputs/`（消息、小品、条件样本）、`run-compare.mjs`、`summarize.mjs`、`runs/<slug>/`（复制数据库、缓存与 sidecar）、`smoke/`（2 轮冒烟结果）。长任务状态在 `.devloop/jobs/X2.d-01.status.json`（退出码 0）与 `.log`。
- X1 的原始数据在 `eval-private/reports/world-model-compare/`（含故事标题与回复，不进入仓库）；长任务脚本与 sidecar 在 `.devloop/scratch/X1.e/`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`。
- ADR-0088 至 ADR-0137 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染、覆盖率口径、应用内助手、世界模型接口、实体档案、时序图谱、对比运行器、X1 判定、导演组织方式、剧情小品、X2 对比运行器、X2 判定、R6 预注册、评测调用输出预算与结算提示词的楼层 id 的决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16、HUMAN-17、HUMAN-18 待处理（不阻塞）：临时目录清理、ST-Prompt-Template 与酒馆助手上游许可证确认。

## 可重复命令
- 门禁：`pnpm check`。
- R6 分支计划（三故事，打印每故事的 9 个分支点楼层）：`node .devloop/scratch/R6-T06/plan-branches.mjs`。
- R6 门槛与指标的目标测试：`pnpm exec vitest run packages/st-compat/test/gates.test.ts packages/st-compat/test/metrics.test.ts`。
- R6 深回合批次目标测试：`pnpm exec vitest run packages/st-compat/test/r6-deep.test.ts packages/st-compat/test/deep-eval.test.ts`。
- R6 深回合单故事（默认 20 轮、8 个分支点）：`pnpm --filter @dramaticer/st-compat r6-deep --db <源库> --story <id> --dir <运行目录> --json <结果 json> --report <报告 md>`。
- R6 深回合缩样：在上面命令上加 `--rounds 2 --branches 2`。
- R6 深回合三故事长任务：`node .devloop/scratch/R6-T05/run-deep.mjs`（复用 sidecar；`done` 的跳过，`failed` 与 `running` 续跑）。
- R6 C1 运行器目标测试：`pnpm exec vitest run packages/st-compat/test/r6-compare.test.ts`（约 55 秒）。
- R6 B1 批次目标测试：`pnpm exec vitest run packages/st-compat/test/r6-b1.test.ts`（约 15 秒）。
- R6 偏好一致率目标测试：`pnpm exec vitest run packages/st-compat/test/r6-preference.test.ts`（约 2 秒）。
- 判定与模拟用户重试目标测试：`pnpm exec vitest run packages/st-compat/test/pairwise.test.ts packages/st-compat/test/playtest.test.ts packages/st-compat/test/probe.test.ts`。
- R6 B1 三故事长任务：`node .devloop/scratch/R6-T06/run-b1.mjs`（复用 sidecar；`done` 与 `failed` 的样本直接复用，`running` 续跑）。
- R6 C1 三故事长任务：`node .devloop/scratch/R6-T06/run-compare.mjs`（复用 sidecar；`done` 复用，`running` 与 `failed` 续跑）。
- R6 B1 单个故事：`pnpm --filter @dramaticer/st-compat r6-b1 --db <源库> --story <id> --dir <运行目录> --json <结果 json> --report <报告 md> [--historical-models <映射 json>]`。
- R6 B1 缩样：在上面命令上加 `--branches <楼层>`（只能配一个故事，楼层必须是规划结果里的助手楼层，例如 `yuwang` 的 57）。
- R6 C1 单个故事（默认 30 轮、首中末 3 个分支点）：`pnpm --filter @dramaticer/st-compat r6-compare --db <源库> --story <id> --dir <运行目录> --json <结果 json> --report <报告 md>`。
- R6 C1 缩样：在上面命令上加 `--rounds 2 --branches <楼层>`（`--branches` 只能配一个故事，楼层必须是规划结果里的助手楼层）。
- R6 偏好一致率：先 `pnpm --filter @dramaticer/st-compat preferences export --db <源库> --out <导出目录>`，再 `pnpm --filter @dramaticer/st-compat r6-preference --db <源库> --pairs <导出目录> --dir <运行目录> --json <结果 json> --report <报告 md>`；记录在 `<运行目录>/records.jsonl`。
- X2.d 重跑（断点续跑，已完成候选用 sidecar）：`node .devloop/scratch/X2.d/run-compare.mjs`。
- X2.d 指标汇总：`node .devloop/scratch/X2.d/summarize.mjs`。
- X2.d 单个故事：`node packages/st-compat/dist/evalset/director-organization-compare-cli.js --db <源库> --story <故事> --messages .devloop/scratch/X2.d/inputs/<slug>.messages.json --bits .devloop/scratch/X2.d/inputs/<slug>.bits.json --conditions .devloop/scratch/X2.d/inputs/<slug>.conditions.json --rounds 8 --repeat 3 --seed 1 --model main-fallback --judge-model judge --background-model background --dir .devloop/scratch/X2.d/runs/<slug>`。
- X2.d 冒烟：把上面命令的 `--rounds` 改 2、`--repeat` 改 1、`--dir` 改 `.devloop/scratch/X2.d/smoke`。
- X2.c 目标测试：`pnpm exec vitest run packages/st-compat/test/director-organization-compare.test.ts`。
- X2.b 目标测试：`pnpm exec vitest run packages/st-compat/test/director-bits.test.ts packages/core/test/director-organization.test.ts packages/core/test/card-extension.test.ts packages/core/test/plugin-background-tools.test.ts packages/st-compat/test/dramaticer-extension.test.ts packages/server/test/stories.test.ts`。
- X1 长任务（重跑会复用 sidecar）：`node .devloop/scratch/X1.e/run-compare.mjs`。
- X1 目标测试：`pnpm exec vitest run packages/st-compat/test/world-model-compare.test.ts`。
- H-T99 真实渠道验收：`node .devloop/scratch/H-T99/live.mjs`。
- 不变量检查：`node scripts/check-invariants.mjs`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。X1、X2 与 R6 的 JSON 含回复与答案，只能放在私有目录；`eval-private/reports/r6/b1/<slug>.md` 含故事标题，属于私有报告，仓库报告只能用 slug。
- R6 预注册 v1 在第一次批次运行后冻结：门槛、样本、指标、模型与种子都不改；必须调整时另写 v2、记 ADR、把评测轮次计数重置为 0。门槛常量与 `docs/dev/R6-PREREG.md` 必须逐项一致，`evaluateR6Gates` 不允许缺项回落。
- `gates.ts` 的 G6 少于 30 对时状态为 `insufficient`，报告里同时出现在 `insufficient` 与 `unproven`；其他门槛 `insufficient` 会让 `passed` 为 false。G1 的故事覆盖按 `completedPairs > 0` 计数，故事完成数合计必须等于配对合计，否则输入校验抛错。
- `evaluateR6Gates` 要求六项输入齐全，缺项直接抛错；单测门槛时构造完整的 `{b1, repetition, advancement, contradiction, deep, preference}`，不要只传一项。
- B1 的计划配对来自 `planR6B1Samples`：每个故事按路径深度取最多 10 个分支点，保留其后有非空玩家消息与历史回复的点；三个源故事各得 9 个，计划 27 对。第一个分支点（`yuwang` 57）之前只有 1 个助手楼层，预热 0 楼属于正常结果，报告会写预热楼层数。
- B1 的 sidecar 在 `<dir>/runs/<故事安全名>/<楼层>/b1.json`，数据库是同目录的 `native.db`；`done` 与 `failed` 直接复用，`running` 续跑，重试需要删除对应 sidecar。CLI 一次只读一个源库，三故事串行跑；`--branches` 只能配一个故事。
- B1 每个分支点只生成一轮：复制源数据库、预热 12 楼后，用分支点之后第一条非空玩家消息跑一次原生续写，回合后不执行后台任务；失败样本计入 `failures`，`outcome` 为 null。
- B1 的历史回复模型从 DB 里读不到；`--historical-models` 接受 `{节点 id 或 "<故事>:<楼层>": "模型名"}` 的 JSON 映射，没有映射时家族清单为空并写明未记录。本批次没有提供映射。
- R6 的胜率都按配对计数：两种展示顺序各判一次，胜率分母只含胜与负，平与换序不一致不计入分母；Wilson 95% 区间用配对计数计算。
- R6 的分支点按路径深度取：主路径长度的 10% 到 100%，每个比例取最近的助手楼层，保留其后有非空玩家消息与历史回复的点，去重后每故事最多 10 个；C1 取首、中、末 3 个，B1 取全部。`--branches` 只接受规划结果里出现的助手楼层。
- R6 的 C1 两档必须共用同一串玩家消息：原生档先生成并写入 sidecar，朴素档逐字重放；sidecar 校验故事、分支点、轮数、种子、写作/用户/裁判模型，朴素档还校验消息哈希，输入变化时失败并提示删除。
- R6-T02 的 sidecar 在 `<dir>/runs/<故事>/<楼层>/<档位>.json`，数据库是同目录的 `<档位>.db`；状态 `running` 时续跑，`done` 与 `failed` 直接复用。续跑按记录里的 `assistantNodeId` 把 head 对齐到记录末尾，避免进程在写 sidecar 前退出造成重复楼层。
- R6-T02 的预热逐楼把 head 移到预热楼层再调用 `settle`，把结算窗口限制在该楼层以内，结束后恢复到分支点；`scene` 对已有分析的楼层跳过。预热请求（`settleRequests` + `sceneRequests`）单列，不计入每轮成本。
- R6 的预热结算现在按后台任务的次数重试：第 2、3 次请求末尾追加一条玩家消息，带上一次的错误与结算窗口里可写入的楼层 id（ADR-0137）。重试会命中响应缓存之外的新请求体；`settleRequests` 按实际请求计数。
- R6-T02 的探针只对原生档：每 6 轮一次、事实年龄至少 10 楼、每次运行最多 5 次；答题用写作客户端，判定用裁判客户端，两者的请求都记在 `probeRequests`。
- R6-T02 的报告把同一故事同一档位下所有运行的重复度与推进度原始值池化后取均值（sidecar 保存逐值），失败轮次不进入这两个指标。
- R6 的每个运行副本在开跑前对分支点之前最近 12 个已生成完成的助手楼层执行 `settle` 与 `scene`，只写复制库；台账覆盖范围只到预热窗口，报告必须单列这一限制。
- 预热的结算窗口用 `prepareSettlementForNodes` 按预热楼层显式构建，每 4 楼一次请求；不要改回后台结算处理器，它会按“沿路径最远的未结算楼层优先”取窗口，长历史下预热楼层轮不到，现场分析会一直退回 pending。
- `prepareSettlementForNodes` 只校验窗口大小与楼层存在，不校验角色、落定状态与 head 路径；调用方要先把 head 移到窗口最后一楼，并按从旧到新的顺序传楼层。
- R6-T05 每个故事一个副本，运行从该故事的 head 开始；预热 head 之前最近 12 楼，再跑 20 轮深回合。分支点是轮次，不是源数据库里的楼层；`selectBranchRounds(completedRounds.length, 8)` 在全部轮次完成时等于 `selectBranchRounds(20, 8)`。sidecar 在 `<dir>/runs/<故事安全名>-<hash>/deep.json`，数据库是同目录的 `deep.db`；`done` 复用，`running` 与 `failed` 都续跑。
- R6-T05 的续跑按最后一条已完成深回合的 `nodeId` 对齐 head；分支记录按 `sampleId`（`<故事>#round-<轮次>`）去重，已完成的样本不重复判定，失败的分支记录会在续跑时重试。深回合连续失败 3 轮终止该次运行（模拟用户输出失败也算一轮失败），`deep-eval` 的可选 `maxConsecutiveFailures` 默认不终止。
- R6-T05 的配对归一只看 `judgements`：`deep-first` 的 A、`fast-first` 的 B 属于深回合侧，反之为快回合侧；两种顺序的侧再交给 `normalizePairOutcome`。计划配对是故事数 × 分支数，`failures = plannedPairs - completedPairs`，报告同时给出分支失败与缺失配对。
- R6-T05 的报告成本只统计写作、用户、裁判与预热的请求数，token 来自深回合记录；快回合的 token 没有单独记录，写作请求数包含快回合。仓库报告不得出现故事标题或正文。
- `metrics.ts` 的 `measureReplyRepetition` 是 R6 的相邻回复口径；`measureBlockRepetition` 是按行切块的 X2 与记分牌口径。两个口径不要混用，X2 的数字用后者保持不变。
- 评测里的结构化判定与模拟用户调用（`pairwise`、`quality`、`turn-judge`、`probe` 裁判、`generateUserMessage`）默认不发送 `maxTokens`，由路由器使用模型在渠道里声明的上限（ADR-0136）；判定重试带尝试次数，模拟用户重试还会附上上一次原文。
- `r6-deep-cli` 在任一故事状态为 `failed` 时退出码为 1；长任务脚本按退出码停止，不要再用日志里的“全部完成”判断成功。
- 长任务脚本只构建 `st-compat`（`pnpm --filter @dramaticer/st-compat build` 是普通的 `tsc`），不会重建 `packages/core/dist`。改过 core 之后必须先跑 `pnpm run typecheck`（`tsc -b` 会重建 core 的 `dist`），再申请长任务，否则评测跑的是旧的 core。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁会撞上 vitest 的 `[vitest-worker]: Timeout calling "onTaskUpdate"`（worker 等主进程回 `onTaskUpdate` 超过 60 秒，测试本身全过、进程仍以退出码 1 结束）。本轮的证据：新加的两个预热用例用 200 楼 fixture 时，8 worker 连续两次出现该错误；改用默认 30 楼 fixture 后 `pnpm check` 退出码 0；同一批代码用 `--maxWorkers=4` 也一次通过。再遇到时先看是不是某个用例单文件耗时过长（`vitest run <文件>` 对照），不要连续无改动地跑整仓测试，也不要靠改门槛绕过。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- `.devloop/scratch/R6-T06/*.mjs` 直接 import `../../../packages/core/dist/index.js`，因为 `.devloop/` 下解析不到工作区包名；长任务脚本每次先构建 `st-compat`。
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
