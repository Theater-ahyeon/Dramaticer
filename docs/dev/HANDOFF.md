# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-14 会话 392：门禁修复。上一个会话结束后 devloop 的 autosave 把残留的一次性截图脚本 `packages/web/.v4shot.mjs`（`@playwright/test` 驱动、写死 `E:/agentcoding/Dramaticer/docs/proposals/v4-ui.html`，共 9 行）提交进仓库，`biome check` 在该文件上报 4 个 `useTemplate`、1 个格式错误、1 个其它格式项，`pnpm run lint` 失败，整条 `pnpm check` 因此失败。该脚本没有被任何文档、脚本或包配置引用（全仓搜索无命中），是给 v4 界面原型拍截图的临时工具，已从仓库删除。
- 门禁现在通过：261 个测试文件、2,292 个测试、5 个跳过（耗时 170 秒）。类型检查与不变量检查没有被本次改动影响。
- 本会话没有选任务；分拣了会话进行中人类新写入的 INBOX 条目（卡面图与人物立绘）为 W0-T01，依赖 W0-T00。

## 下一步（会话 393 先做）
1. **W0-T00**（v4 设计合并）：人类在会话 391 进行中把 v4 提案写进 INBOX，已分拣为 TASKS 的 W 阶段任务——写 ADR、合并进 DESIGN、细化 W1–W9，并落实四条约束（不变量不动、场记先做对照、R6 额度批次先后写 ADR 与不阻塞的 HUMAN 确认、界面以 `docs/proposals/v4-ui.html` 为参考）。这是设计文档任务，不需要额度。
2. 之后做 **W0-T01**（卡面图与人物立绘）：人类在会话 392 进行中写入的 INBOX 条目，卡片 PNG 作故事封面、资源表立绘进人物档案、认证媒体接口、无图卡用占位图。排在界面改版之前，代码任务不需要额度。
3. 之后做 R6-T07.b（重 roll 点回放批次）；HUMAN-19 只阻塞真实批次，代码与假客户端测试不需要额度。
4. R6-T07.b 要点：
   - 新增 `evalset/r6-replay.ts` 与 CLI：从 `eval-private/world-model-compare/source/<slug>.db` 规划重 roll 点（`xianxia` 24、`yuwang` 8、`yinqi` 11），被接受的是 head 路径上的助手兄弟楼层（43 个点都是最大 swipe 下标），放弃侧取下标紧邻其下的那条，另有 5 条更早的放弃 swipe 只报告。
   - 每个点复制数据库、head 移到父玩家楼层、预热 12 楼，先按种子 1 生成一次原生续写（同时是 G1 的续写与 A/A 的第一次生成），再按种子 2 生成一次（只用于 A/A）；同一请求体只差种子，会命中响应缓存（ADR-0136）。
   - 每次生成后写 A/A 样本 JSONL（格式见下面「注意事项」），再调用 `runR6AaInstrument`（`dir` 用自己的运行目录）得到 G0 的 A/A 侧；G1 的两组配对（对放弃侧、对接受侧）各两种顺序判一次，汇总产出 `R6ReplayGateInput`。
   - sidecar 校验故事、分支点、玩家消息、swipe 下标、模型与种子；`done` 复用，`running` 与 `failed` 续跑；失败样本单独计数。
5. 额度恢复（2026-11-17T11:44:35Z 之后）后，再申请 C1 长任务（`R6-T06-03`，9 个分支点 × 2 档位 × 30 轮）与 R6-T07.b 的批次长任务。
6. 阻塞检查：M6-T99 仍等 HUMAN-15；HUMAN-03、HUMAN-16、HUMAN-17、HUMAN-18 不阻塞；HUMAN-19 阻塞真实批次。

## 当前状态
- 已完成：F0、M0–M3、D、M4-T00 至 M4-T06、R0、R1（含 R1-T99、R1-T99.a）、R3、O、R2、E、R4、R5、V-T01、M6-T00 至 M6-T05、R3b、P1–P4、C-T01 至 C-T05、H-T00 至 H-T99、X1.a 至 X1.e、X2.a 至 X2.d、R6-T00 至 R6-T05、R6-T07、R6-T07.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- R6-T06 标 `[!]`（HUMAN-19）：剩余 C1 的 540 轮；B1 已完成的 `xianxia` 9 对作为参考样本，`yuwang` 与 `yinqi` 不补。
- W0-T00 待做（`[ ]`），W1–W9 还未拆分；W0-T01（卡面图与人物立绘）依赖 W0-T00；R6-T07.b 至 R6-T07.d 待做；R6-T99 依赖它们与 R6-T06。
- 兼容插件线：`st-content`、`st-mvu`、`st-ejs`、`st-helper-host` 全部完成（含一致性测试与共存评测）。
- 数据库 schema 版本 50。本轮没有新增依赖。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`、`C-T02.md`、`C-T03.md`、`C-T04.md`、`C-T05.md`、`H.md`、`X1.md`、`X2.md`。
- R6 预注册：`docs/dev/R6-PREREG.md` v2（v1 归档在 `docs/dev/R6-PREREG-V1.md`）、ADR-0135、ADR-0138、DESIGN §14.2；门槛常量与判定由 R6-T01 实现并在 R6-T07 升到 v2，`R6_GATE_VERSION` 为 `v2`；C1 运行器由 R6-T02、B1 批次由 R6-T03（现为参考样本）、偏好一致率由 R6-T04、深回合批次由 R6-T05、G0 的两件仪器由 R6-T07.a 实现。
- R6-T05 的真实结果在 `eval-private/reports/r6/deep/<slug>.json` 与 `.md`：24 对，胜 9、负 5、平 0、换序不一致 10；`xianxia` 4/3/0/1、`yuwang` 3/1/0/4、`yinqi` 2/1/0/5；深回合 60 轮全部完成、截断 2 轮（`yinqi`）、工具调用 0。v2 下这组数据对应的 G5 状态是「不可测」。
- R6-T05 的运行目录 `eval-private/reports/r6/deep/<slug>/` 里有 `runs/<故事安全名>-<hash>/deep.json` sidecar 与 `deep.db`；重跑复用 `done`，`failed` 与 `running` 续跑。
- R6 B1 的参考数据在 `eval-private/reports/r6/b1/xianxia.json` 与 `.md`（9 对、胜率 42.9%）；运行目录 `runs/<故事安全名>/<楼层>/b1.json` 与 `native.db`。故事安全名对中文标题会退化成 `_`。
- R6 B1 缩样结果在 `.devloop/scratch/R6-T06/smoke/yuwang.json` 与 `.md`；批量脚本在同一目录（`run-b1.mjs`、`run-compare.mjs`、`plan-branches.mjs`）。`.devloop/` 已被 git 忽略。
- R6 的结算提示词在本轮改过一次（ADR-0137）：冲突检查窗口不再带楼层 id。R6-T05 的深回合批次与 B1 的 `xianxia` 前 6 个样本在改前完成；预热结算只写各样本自己的副本。
- 世界模型：默认 `ledger`；`wiki` 与 `temporal_graph` 已经可用，由故事设置 `worldModel` 选择，只有 `temporal_graph` 支持 `atStoryTime`。
- 导演组织方式：默认 `mechanisms`（现有机制序列）；`bits` 已可用，由故事设置 `directorOrganization` 选择。X2 判定见 ADR-0134 与 `docs/dev/reports/X2.md`。
- X2 的输入与运行脚本在 `.devloop/scratch/X2.d/`：`inputs/`、`run-compare.mjs`、`summarize.mjs`、`runs/<slug>/`、`smoke/`。长任务状态在 `.devloop/jobs/X2.d-01.status.json`（退出码 0）。
- X1 的原始数据在 `eval-private/reports/world-model-compare/`（含故事标题与回复，不进入仓库）；长任务脚本与 sidecar 在 `.devloop/scratch/X1.e/`。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`。
- ADR-0088 至 ADR-0138 记录插件、沙箱、比对、兼容内容映射、EJS、沙箱执行、时间预算、流水线接入、模板生成、一致性评测、酒馆助手宿主、iframe 沙箱、STscript 子集、生成后台化、HTML 渲染、覆盖率口径、应用内助手、世界模型接口、实体档案、时序图谱、对比运行器、X1 判定、导演组织方式、剧情小品、X2 对比运行器、X2 判定、R6 预注册（v1 与 v2 改写）、评测调用输出预算、结算提示词楼层 id 的决策。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。
- HUMAN-16、HUMAN-17、HUMAN-18 待处理（不阻塞）。
- HUMAN-19 待处理（阻塞真实批次）：`bg` 渠道 402 `insufficient_balance`，额度 2026-11-17T11:44:35Z 重置；或把 `roles.settler`/`roles.planner` 指到可用路由。

## 可重复命令
- 门禁：`pnpm check`。
- `docs/proposals/` 下的原型页面用浏览器直接打开即可，不需要构建；仓库里不保留截图脚本。
- G0 仪器目标测试：`pnpm exec vitest run packages/st-compat/test/r6-instrument.test.ts`。
- R6 门槛与指标的目标测试：`pnpm exec vitest run packages/st-compat/test/gates.test.ts packages/st-compat/test/metrics.test.ts`。
- R6 深回合目标测试：`pnpm exec vitest run packages/st-compat/test/r6-deep.test.ts packages/st-compat/test/deep-eval.test.ts`。
- R6 B1 批次目标测试：`pnpm exec vitest run packages/st-compat/test/r6-b1.test.ts`（约 10 秒）。
- R6 C1 运行器目标测试：`pnpm exec vitest run packages/st-compat/test/r6-compare.test.ts`（约 55 秒）。
- R6 偏好一致率目标测试：`pnpm exec vitest run packages/st-compat/test/r6-preference.test.ts`（约 2 秒）。
- R6 分支计划（三故事，打印每故事的 9 个分支点楼层）：`node .devloop/scratch/R6-T06/plan-branches.mjs`。
- R6 B1 三故事长任务：`node .devloop/scratch/R6-T06/run-b1.mjs`（复用 sidecar；`done` 与 `failed` 的样本直接复用，`running` 续跑）。
- R6 C1 三故事长任务：`node .devloop/scratch/R6-T06/run-compare.mjs`（复用 sidecar；`done` 复用，`running` 与 `failed` 续跑）。
- R6 B1 单个故事：`pnpm --filter @dramaticer/st-compat r6-b1 --db <源库> --story <id> --dir <运行目录> --json <结果 json> --report <报告 md> [--historical-models <映射 json>]`。
- R6 C1 单个故事（默认 30 轮、首中末 3 个分支点）：`pnpm --filter @dramaticer/st-compat r6-compare --db <源库> --story <id> --dir <运行目录> --json <结果 json> --report <报告 md>`。
- R6 C1 缩样：在上面命令上加 `--rounds 2 --branches <楼层>`（`--branches` 只能配一个故事，楼层必须是规划结果里的助手楼层）。
- R6 深回合单故事（默认 20 轮、8 个分支点）：`pnpm --filter @dramaticer/st-compat r6-deep --db <源库> --story <id> --dir <运行目录> --json <结果 json> --report <报告 md>`。
- R6 深回合三故事长任务：`node .devloop/scratch/R6-T05/run-deep.mjs`（复用 sidecar）。
- G0 两件仪器：`pnpm --filter @dramaticer/st-compat r6-instrument --aa <aa-samples.jsonl> [--pairs <pairs>] [--label-records <judge>] [--dir <运行目录>] [--json <结果>] [--report <报告>]`。
- R6 偏好一致率：先 `pnpm --filter @dramaticer/st-compat preferences export --db <源库> --out <导出目录>`，再 `pnpm --filter @dramaticer/st-compat r6-preference --db <源库> --pairs <导出目录> --dir <运行目录> --json <结果 json> --report <报告 md>`。
- 判定与模拟用户重试目标测试：`pnpm exec vitest run packages/st-compat/test/pairwise.test.ts packages/st-compat/test/playtest.test.ts packages/st-compat/test/probe.test.ts`。
- X2.d 重跑（断点续跑）：`node .devloop/scratch/X2.d/run-compare.mjs`；指标汇总：`node .devloop/scratch/X2.d/summarize.mjs`。
- X2.c 目标测试：`pnpm exec vitest run packages/st-compat/test/director-organization-compare.test.ts`。
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
- 一次性脚本不要提交：devloop 的 autosave 会把仓库里的残留文件一起提交，残留文件会进 `biome check` 并让门禁失败。`.devloop/scratch/` 下的脚本放在被忽略的目录里。
- R6 预注册 v2 在第一次 v2 批次运行后冻结：门槛、样本、指标、模型与种子都不改；必须调整时另写 v3、记 ADR、把评测轮次计数重置为 0。门槛常量与 `docs/dev/R6-PREREG.md` 必须逐项一致，`evaluateR6Gates` 不允许缺项回落。
- v2 的判定状态：`pass`、`fail`、`insufficient`、`not-measurable`；G0 未通过或样本不足时 G1 与 G5 被替换成 `invalid`。`passed` 只在 G0 pass、G1–G4 pass、G5 pass 或不可测、G6 pass 或未证实时为 true；`unproven` = G5 不可测 + G6 未证实。
- G0 的两项：A/A（43 个点、种子 1 与 2、完成 ≥ 36、Wilson 区间含 50%、换序不一致 ≤ 20%、排除 ≤ 30%、判定失败 ≤ 10%）与真人标注（F0-T03 同一批 195 对、完成 ≥ 165、一致率 ≥ 65%、Wilson 下界 > 50%、位置偏差 ≤ 10 个百分点、判定失败 ≤ 10%）。G0 失败时改进任务只指向裁判。
- R6-T07.a 的 A/A 样本文件格式（R6-T07.b 按此写出）：每行 `{"sampleId","story","context","seed1":{"status":"done","text"} 或 {"status":"failed","error"},"seed2":{…}}`；`context` 是父玩家楼层最近对话的已格式化文本。文本变化会让旧 sidecar 拒绝复用（按 `sampleHash` 比对），重新生成后需要删除 `<dir>/aa.jsonl`。
- A/A 的判定槽位固定为每对 2 个（两种顺序各一次）；生成失败与两次文本相同也各占 2 个失败槽位，因此 `judgments.failed` 包含它们，`judgeFailureShare` 是全部仪器失败的比例，「两次相同」的比例另列。
- 真人标注分支读 F0-T03 判定记录里的配对 id（195 个），配对文本必须齐全；sidecar 里出现计划外配对或换裁判模型都直接抛错。
- 43 个重 roll 点的统计来自 `eval-private/world-model-compare/source/<slug>.db`：`xianxia` 24、`yuwang` 8、`yinqi` 11；可用点的父楼层是玩家楼层且原文非空，同一楼层下至少有一条被放弃的助手兄弟楼层。
- 兄弟楼层的 swipe 下标只能从节点 id 后缀 `:s<N>` 读；同一楼层的兄弟 `created_at` 完全相同，按创建时间排序会得到错误的「被接受」判定。本批 43 个点的被接受节点都是最大下标。
- A/A 的两次生成只差种子；请求体相同会命中响应缓存（ADR-0136），两次文本完全相同的配对按失败计数并单独报告比例。
- R6-T05 的深回合数据带 `gateVersion: v1`，在 v2 里只作为 G5 的输入证据；它的工具调用合计为 0，因此 G5 记「不可测」。
- B1 只作参考样本，`r6-b1` 不再导出门槛输入；`R6_B1_MIN_COMPLETED_PAIRS` 仍用于它自己的样本不足说明。
- `gates.ts` 的 G6 少于 30 对时状态为 `insufficient`，同时进入 `unproven`；G5 工具调用为 0 时状态为 `not-measurable`，也进入 `unproven`。其他门槛的 `insufficient` 会让 `passed` 为 false。
- `evaluateR6Gates` 要求七项输入齐全，缺项直接抛错；单测门槛时构造完整的 `{instrument, replay, repetition, progression, contradiction, deep, preference}`。
- 重 roll 点的生成与 B1 不同：B1 在分支助手楼层之后追加真实玩家消息，回放在父玩家楼层上直接生成；两者都复用 `prepareR6RunCopy` 与 `warmupR6Copy`。
- B1 的计划配对来自 `planR6B1Samples`：每个故事按路径深度取最多 10 个分支点，保留其后有非空玩家消息与历史回复的点；三个源故事各得 9 个。第一个分支点（`yuwang` 57）之前只有 1 个助手楼层，预热 0 楼属于正常结果。
- B1 的 sidecar 在 `<dir>/runs/<故事安全名>/<楼层>/b1.json`，数据库是同目录的 `native.db`；`done` 与 `failed` 直接复用，`running` 续跑，重试需要删除对应 sidecar。CLI 一次只读一个源库，三故事串行跑。
- B1 每个分支点只生成一轮：复制源数据库、预热 12 楼后，用分支点之后第一条非空玩家消息跑一次原生续写，回合后不执行后台任务。
- R6 的胜率都按配对计数：两种展示顺序各判一次，胜率分母只含胜与负，平与换序不一致不计入分母；Wilson 95% 区间用配对计数计算。
- R6 的分支点按路径深度取：主路径长度的 10% 到 100%，每个比例取最近的助手楼层，保留其后有非空玩家消息与历史回复的点，去重后每故事最多 10 个；C1 取首、中、末 3 个。`--branches` 只接受规划结果里出现的助手楼层。
- R6 的 C1 两档必须共用同一串玩家消息：原生档先生成并写入 sidecar，朴素档逐字重放；sidecar 校验故事、分支点、轮数、种子、写作/用户/裁判模型，朴素档还校验消息哈希。
- R6-T02 的 sidecar 在 `<dir>/runs/<故事>/<楼层>/<档位>.json`，数据库是同目录的 `<档位>.db`；状态 `running` 时续跑，`done` 与 `failed` 直接复用。续跑按记录里的 `assistantNodeId` 把 head 对齐到记录末尾。
- R6-T02 的预热逐楼把 head 移到预热楼层再调用 `settle`，把结算窗口限制在该楼层以内，结束后恢复到分支点；`scene` 对已有分析的楼层跳过。预热请求（`settleRequests` + `sceneRequests`）单列，不计入每轮成本。
- R6 的预热结算按后台任务的次数重试：第 2、3 次请求末尾追加一条玩家消息，带上一次的错误与结算窗口里可写入的楼层 id（ADR-0137）。`settleRequests` 按实际请求计数。
- R6-T02 的探针只对原生档：每 6 轮一次、事实年龄至少 10 楼、每次运行最多 5 次；答题用写作客户端，判定用裁判客户端，两者的请求都记在 `probeRequests`。
- 预热的结算窗口用 `prepareSettlementForNodes` 按预热楼层显式构建，每 4 楼一次请求；不要改回后台结算处理器。
- `prepareSettlementForNodes` 只校验窗口大小与楼层存在，调用方要先把 head 移到窗口最后一楼，并按从旧到新的顺序传楼层。
- R6-T05 每个故事一个副本，运行从该故事的 head 开始；预热 head 之前最近 12 楼，再跑 20 轮深回合。分支点是轮次；sidecar 在 `<dir>/runs/<故事安全名>-<hash>/deep.json`，数据库是同目录的 `deep.db`；`done` 复用，`running` 与 `failed` 都续跑。
- R6-T05 的续跑按最后一条已完成深回合的 `nodeId` 对齐 head；分支记录按 `sampleId` 去重；深回合连续失败 3 轮终止该次运行。
- R6-T05 的配对归一只看 `judgements`：`deep-first` 的 A、`fast-first` 的 B 属于深回合侧，反之为快回合侧；两种顺序的侧再交给 `normalizePairOutcome`。
- `metrics.ts` 的 `measureReplyRepetition` 是 R6 的相邻回复口径；`measureBlockRepetition` 是按行切块的 X2 与记分牌口径。两个口径不要混用。
- 评测里的结构化判定与模拟用户调用（`pairwise`、`quality`、`turn-judge`、`probe` 裁判、`generateUserMessage`）默认不发送 `maxTokens`，由路由器使用模型在渠道里声明的上限（ADR-0136）；判定重试带尝试次数，模拟用户重试还会附上上一次原文。
- `r6-deep-cli` 在任一故事状态为 `failed` 时退出码为 1；长任务脚本按退出码停止。
- 长任务脚本只构建 `st-compat`，不会重建 `packages/core/dist`。改过 core 之后必须先跑 `pnpm run typecheck`（`tsc -b` 会重建 core 的 `dist`），再申请长任务。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒、`maxWorkers` 8；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁会撞上 vitest 的 `[vitest-worker]: Timeout calling "onTaskUpdate"`：先看是不是某个用例单文件耗时过长（`vitest run <文件>` 对照），不要连续无改动地跑整仓测试，也不要靠改门槛绕过。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- `.devloop/scratch/R6-T06/*.mjs` 直接 import `../../../packages/core/dist/index.js`，因为 `.devloop/` 下解析不到工作区包名；长任务脚本每次先构建 `st-compat`。
- EJS 沙箱的时间预算按墙钟计；测试不要用接近 worker 启动耗时的预算，要验证超时终止用 2 秒以上。
- `pnpm exec biome check --write <文件>` 处理格式；不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。上下文摘要按结构化请求处理。
- 世界模型只用故事设置 `worldModel` 选择；状态槽位的 `packKey` 必须带种类（`state:<kind>`）。
- 导演组织方式只用故事设置 `directorOrganization` 选择；导演槽位持有 `DirectorEngine`，单轮强度覆盖用 `engine` 重建槽位。
- `DirectorEngine.evaluate` 负责写本楼层的决策记录；导演关闭时返回 null 且不写记录。
- 剧情小品的条件是 `{kind:"text", text}` 或 `{kind:"ledger", query}`；兜底小品必须省略条件，普通小品必须提供条件；`after` 的悬空引用与顺序环在导入时拒绝。
- `replaceDirectorBits` 是整批替换，用于卡导入。
- X2.c 运行器只在复制数据库里写 `directorOrganization` 与小品；源库只读；小品指纹进入 sidecar 校验。
- X2.d 的 8 轮实跑里 `xianxia` 的对照没有新建笔记、`bits` 3/3 兑现，`yuwang` 2/3 对 1/2，`yinqi` 对照没有新建、`bits` 1/2；兑现率分母只有 1–3 条。
- `WorldModel.read` 的 `atStoryTime` 只有 `temporal_graph` 支持；台账与 wiki 会直接抛错。
- 实体档案（`wiki`）的写入路径是 `["profile", "<人物>"]`；`world_wiki_revisions` 只追加；`WorldModel.write` 先逐条 `validateLedgerDiff` 再写，剧情结算仍走 `applySettlementProposals`。
- X1.d 的源数据库只读打开一次用于挑探针；重跑复用 sidecar。X1 的源数据库用 ASCII 文件名（全角文件名在 Windows 的 `fs.rmSync` 上会以 `0xC0000409` 终止进程）。
- X1 的矛盾率分母是召回探针加记忆题里被判为一致或矛盾的记录；比较时同时看样本数。
- MVU 引擎的 `[值, 说明]` 判定与 MVU 一致：长度为 2 且第二个元素是字符串的普通数组也会被当成值加说明。
- 显示状态只在当前会话；需要跨进程显示时由台账快照重新渲染。
- 共存适配器在 `apply` 之后按轮调用 `afterTurn`；插件写错直接让运行失败。
- 共存评测的关闭组：适配器提供 `baseline` 时用 `<runDir>/<pluginId>/off`；不提供时用 `<runDir>/baseline/off`。
- `st-helper-host` 的共存批次不执行脚本：Node 里没有 iframe。
- EJS 模板里再写 `<%` 会被外层标签解析截断：内层模板通过变量或 `evalTemplate` 的第二参数传入。
- `st-ejs` 的激活正则默认一次性生效；注入标记与 `@INJECT` 必须独占一行才会被识别。
- 沙箱里模板函数是同步的；函数参数与返回值必须能 JSON 化；`define` 只在一次执行内有效，`include` 不可用。
- 回合预算只从调用方传进来：槽位提供者用 `request.budget`，直接调用运行时用 `render(text, { budget })`。
- `StEjsVariableStore` 接入 `backend` 后，不指定作用域的写进入 `initial`（台账 `mvu`）。
- 模板生成只登记请求：`generate` 返回 id 不返回正文，宿主用 `createStEjsBackgroundGenerationRunner` 接后台客户端并在间隙 `drain`。
- 酒馆助手的沙箱 API 全部异步；事件监听用整数 token；超时由宿主 `sweepTimeouts()` 驱动。
- STscript：`triggerSlash` 只执行 `ST_HELPER_SLASH_COMMANDS` 里的命令；变量命令默认作用域与上游一致（`setvar` 是 chat/local）；`/gen` 与 `/genraw` 只登记后台请求。
- HTML 状态栏与开场页的渲染结果只在插件显示状态；状态栏自动重渲染由变量写入触发，默认上限 8 次。
- 酒馆助手的 API 覆盖率快照以本机 JS-Slash-Runner 4.8.10 为准；升级上游版本时要重新生成名字清单。
- 助手任务不要复用 `turn_runs`；助手运行状态与事件在 `assistant_conversations`、`assistant_events` 里。
- 助手接口的请求与响应类型放在 `packages/protocol`；助手并发启动有 server 与 store 两层保护；提案工具对所有会话注入，靠白名单过滤。
- `assistant_actions` 的待定唯一索引以规范化 JSON 载荷为键；批准顺序是先校验、再调用领域写入、最后改状态。
- 技能注册表以 `packages/core/src/assistant/skills.ts` 为唯一来源；技能白名单里的工具名必须在本次运行实际注册。
- `AssistantDocsIndex.load` 每次 `startServer` 都会读取并切分文档（约 1.6 MB）。
- `summarize_recent` 只读现有压缩与摘要；联网搜索只由 `--assistant-web-search` 开启。
- 渠道读取不返回密钥值；`propose_channels_change` 四个段必须给全。
- 抽屉的持久状态只有 localStorage 里的活动会话 id；重连轮询必须在改状态之前把会话详情与消息写入状态。
- 压缩记录只追加；自动压缩在 server 的消息接口里执行；压缩失败的自动运行仍然返回模型回答。
- 待确认数量与待确认视图必须同源：`refreshPendingActions` 同时读动作与变更卡。
- 审阅面板的渠道字段只能渲染白名单字段；e2e 的审阅种子按 Playwright 项目名分开。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以；助手类型从 `@dramaticer/protocol` 取。
