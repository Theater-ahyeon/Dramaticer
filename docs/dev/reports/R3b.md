# R3b 深回合报告

- 日期：2026-11-12
- 任务：R3b-T99.b R3b 验收（覆盖 R3b-T01 至 R3b-T10.b）
- 路由：助手 `main-fallback`（`auto/deepseek-v4.1-flash`），模拟用户 `background`，裁判 `judge`（`auto/glm-5.3`）
- 配置：结构化输出 `function-call`，工具传输 `native`，回合模式 `deep`；深回合上限为工具调用 40 次、运行时长 600,000 毫秒、工具消息 48,000 token、保留最近 4 个工具步
- 样本：公开合成基准故事 `benchmark-mist-harbor`（80 楼），连续 30 轮深回合；第 1、4、7、11、14、17、20、24、27、30 轮作为分支点
- 私有明细：`eval-private/reports/R3b-deep.jsonl`（逐轮与逐分支）与 `eval-private/reports/R3b-deep.json`（统计）

## 一、验收结论

| 项目 | 结果 |
|---|---|
| 30 轮完成 | 30/30 成功，0 失败，失败率 0%（目标 ≤10%，对照基线 23%） |
| 首字延迟 P50 / P90 / 最大 | 2,566 / 3,584 / 4,990 毫秒 |
| 生成耗时 P50 / P90 / 最大 | 3,261 / 4,208 / 5,579 毫秒 |
| 正文长度 P50 / P90 / 最大 | 131 / 178 / 205 字符 |
| 工具调用 | 总数 0、平均 0、最大 0；30 轮的分布全是 0 次 |
| 模型请求 | 每轮 1 次，共 30 次 |
| token | 输入 39,264、输出 4,221、网关报告总量 97,629；每轮平均总量 3,254.3 |
| 收束原因 | `completed` 30 次；运行状态 `completed` 30 次 |
| 提交方式 | `auto` 30 次；漂移 `missing_commit` 30 次 |
| 截断 | 0/30；上下文省略 0/30 |
| 分支盲评 | 10 个完成、0 失败；深胜 4、快胜 3、平局 0、两次判定相反 3 |

## 二、与 TauriTavern 基线并列

| 指标 | TauriTavern 基线 | 本次深回合 |
|---|---|---|
| 首字 P50 | 66 秒 | 2.57 秒 |
| 首字 P90 | 147 秒 | 3.58 秒 |
| 总时长 P50 | 无对应数字 | 3.26 秒 |
| 总时长 P90 | 无对应数字 | 4.21 秒 |

两边的模型、部署位置和样本规模都不同，这组数字只用于确认延迟量级，不能当作同一产出规模下的提速比例。

## 三、逐轮数据

| 轮 | 首字 (ms) | 生成 (ms) | 工具调用 | 输入 token | 输出 token | 网关总量 token | 正文长度 | 提交 | 漂移 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2977 | 4087 | 0 | 218 | 239 | 2633 | 205 | auto | missing_commit |
| 2 | 1971 | 3001 | 0 | 726 | 151 | 2669 | 181 | auto | missing_commit |
| 3 | 2602 | 3377 | 0 | 839 | 136 | 2767 | 145 | auto | missing_commit |
| 4 | 2259 | 2827 | 0 | 930 | 93 | 2815 | 112 | auto | missing_commit |
| 5 | 2735 | 3529 | 0 | 1006 | 169 | 2967 | 142 | auto | missing_commit |
| 6 | 2675 | 3256 | 0 | 1112 | 114 | 3018 | 111 | auto | missing_commit |
| 7 | 4990 | 5579 | 0 | 1179 | 104 | 3075 | 136 | auto | missing_commit |
| 8 | 2442 | 3096 | 0 | 1254 | 117 | 3163 | 146 | auto | missing_commit |
| 9 | 2212 | 2840 | 0 | 1367 | 111 | 3270 | 122 | auto | missing_commit |
| 10 | 3495 | 4210 | 0 | 1483 | 116 | 3391 | 117 | auto | missing_commit |
| 11 | 3693 | 4204 | 0 | 1558 | 100 | 3450 | 92 | auto | missing_commit |
| 12 | 2722 | 3121 | 0 | 1491 | 113 | 3396 | 77 | auto | missing_commit |
| 13 | 2868 | 3862 | 0 | 1429 | 139 | 3360 | 176 | auto | missing_commit |
| 14 | 2322 | 3018 | 0 | 1459 | 93 | 3344 | 121 | auto | missing_commit |
| 15 | 2404 | 2949 | 0 | 1477 | 109 | 3378 | 97 | auto | missing_commit |
| 16 | 2875 | 3846 | 0 | 1440 | 210 | 3442 | 162 | auto | missing_commit |
| 17 | 3584 | 4208 | 0 | 1474 | 237 | 3503 | 101 | auto | missing_commit |
| 18 | 2901 | 3595 | 0 | 1477 | 143 | 3412 | 102 | auto | missing_commit |
| 19 | 2261 | 3016 | 0 | 1440 | 78 | 3310 | 110 | auto | missing_commit |
| 20 | 2462 | 3267 | 0 | 1426 | 107 | 3325 | 134 | auto | missing_commit |
| 21 | 2476 | 2976 | 0 | 1440 | 59 | 3291 | 89 | auto | missing_commit |
| 22 | 2368 | 2783 | 0 | 1431 | 54 | 3277 | 78 | auto | missing_commit |
| 23 | 3083 | 3883 | 0 | 1428 | 183 | 3403 | 131 | auto | missing_commit |
| 24 | 1692 | 2267 | 0 | 1406 | 79 | 3277 | 110 | auto | missing_commit |
| 25 | 2352 | 3185 | 0 | 1390 | 96 | 3278 | 134 | auto | missing_commit |
| 26 | 2245 | 3201 | 0 | 1421 | 146 | 3359 | 171 | auto | missing_commit |
| 27 | 2430 | 3261 | 0 | 1417 | 113 | 3322 | 149 | auto | missing_commit |
| 28 | 2982 | 3872 | 0 | 1459 | 163 | 3414 | 161 | auto | missing_commit |
| 29 | 2566 | 3705 | 0 | 1520 | 157 | 3469 | 178 | auto | missing_commit |
| 30 | 4281 | 5271 | 0 | 1567 | 492 | 3851 | 186 | auto | missing_commit |

网关总量包含缓存与思考计费口径，与输入加输出不等；每轮平均按总量计算。

## 四、分支盲评

每个分支点在同一个玩家楼层上由深回合与快回合各生成一次回复，裁判按“深在前”与“快在前”两种顺序各评一次，两次结论一致才计为深胜或快胜，平局与相反结论分别计数。

| 轮 | 深回合长度 | 快回合长度 | 结论 |
|---|---|---|---|
| 1 | 205 | 152 | 深胜 |
| 4 | 112 | 134 | 快胜 |
| 7 | 136 | 174 | 两次相反 |
| 11 | 92 | 83 | 两次相反 |
| 14 | 121 | 108 | 深胜 |
| 17 | 101 | 110 | 快胜 |
| 20 | 134 | 106 | 深胜 |
| 24 | 110 | 85 | 两次相反 |
| 27 | 149 | 150 | 快胜 |
| 30 | 186 | 133 | 深胜 |

7 个可判定分支中深胜 4、快胜 3；3 个分支两次顺序给出相反结论。本样本没有显示深回合优于快回合。

## 五、逐条核对验收标准

| 验收项 | 结果 | 证据 |
|---|---|---|
| 深回合循环与两个防失控上限 | 通过 | `packages/core/src/chat/deep-turn.ts`；`packages/core/test/turn-mode.test.ts`（12 条，含“第 41 次工具调用被拒绝”“假时钟越过时长上限后不再发出请求”“上限以内的工具调用不受限制”）；迁移 v39 |
| 工具集、权限与进度事件 | 通过 | `packages/core/src/tools/registry.ts`、`read-tools.ts`、`write-tools.ts`；`packages/core/test/deep-tools.test.ts`（9 条，含权限拒绝、`ledger_write` 逐条校验、两种传输结果一致） |
| 运行日志只追加 | 通过 | 迁移 v40 的 `turn_runs` 与 `turn_run_events`（更新与删除由触发器拒绝）；`packages/core/test/turn-runs.test.ts`；`packages/core/test/explain.test.ts`；本次 30 次运行共 120 条事件，全部为 `model.request`、`model.response`、`draft.replace`、`draft.commit` 各 30 条 |
| 草稿与提交 | 通过 | `packages/core/src/chat/draft.ts`；`packages/core/test/draft-commit.test.ts`（5 条，含提交前不写楼层、无提交自动提交并记录漂移、中止不产生楼层、提交后拒绝继续写入） |
| 导演手记 | 通过 | `packages/core/src/director/notes.ts`；`packages/core/test/director-notes.test.ts`（8 条，含沿路径累加、分支隔离、提交前不可见、快回合不注入） |
| 上下文卫生成对省略 | 通过 | `packages/core/src/chat/context-window.ts`；`packages/core/test/deep-context.test.ts`（8 条，含成对省略、保留最近步数、Trace 数字一致、快回合不套用） |
| 模板里的深回合配置 | 通过 | `packages/core/test/deep-template-config.test.ts`（12 条，含白名单外调用被拒绝、上限覆盖顺序、模板变化后上下文包重新组装） |
| 原生元数据保真 | 通过 | `packages/core/test/native-metadata.test.ts`（3 条，含 Gemini 签名逐字节一致）；`native-metadata.live.test.ts` 默认跳过 |
| 运行中追加要求 | 通过 | `packages/core/test/turn-guidance.test.ts`（2 条）；server `turns.test.ts` 的 steering 用例（404/409/400/202） |
| 失败率 ≤10% | 通过 | 30/30 成功，0 失败；基线 23% |
| 漂移率、工具调用与 token 记录 | 通过 | 漂移 30/30（全部 `missing_commit`），工具调用 0，token 见第三节 |
| 首字与总时长分布 | 通过 | 见第一节与第三节 |
| 至少 10 个分支点两两盲评 | 通过 | 10 个分支点，deep 4 / fast 3 / tie 0 / inconsistent 3 |

## 六、不变量复核

| 不变量 | 结果 | 证据 |
|---|---|---|
| I6 两种模式只由玩家切换，程序不自动切换 | 通过 | 模式只在 `resolveTurnMode` 解析（`packages/core/src/chat/turn.ts` 的 `runChatTurn` 与 `generateAssistantTurn`，`packages/server/src/turns.ts` 写楼层前校验）；写入 `turnMode` 的位置只有故事设置与单轮请求；web 的模式下拉框是唯一交互入口；本次 30 轮没有任何代码路径根据轮数、工具调用、错误或预算改变模式 |
| I13 不强制模型每轮调用工具或输出固定结构 | 通过 | 深回合只注册工具定义并只设两个防失控上限，没有剧本式提示词；本次 30 轮里 12 个工具对模型可见、传输为 `native`，模型一次也没有调用，运行仍以 `completed` 结束；没有提交时按 `missing_commit` 自动提交，不判失败 |
| I12 台账唯一事实来源，所有写入经过校验 | 通过 | `ledger_write` 逐条 `validateLedgerDiff` 后只收集，楼层事务写入；后台结算器仍对模型写入校验与修复；导演手记写在 `director_notes`，不进入台账路径 |
| I4 楼层原文不可修改 | 通过 | 草稿提交只新建助手楼层，提交后正文与草稿逐字节一致且只写一次；运行日志的草稿事件只记版本号与长度 |
| I7 后台工作不阻塞回合 | 通过 | 深回合过程只写运行事件与草稿快照；结算、抽取等后台任务不在回合内等待 |

## 七、观察与限制

- 30 轮全部是“一次模型请求、零工具调用、自动提交”。模型拿到了 12 个工具（读取类、写入类、草稿类与提交工具），但既没有读取工具，也没有调用 `draft_write` 或 `commit_draft`；`missing_commit` 兜底路径承担了全部 30 次提交。深回合的“模型自行决定步骤”这次没有展开，深回合相对快回合的差别只剩协议段与工具可见性。
- 因此分支盲评衡量的是两条路径在一次调用下的输出质量：7 个可判定分支深胜 4、快胜 3，另有 3 个分支两次顺序结论相反。这个样本不能支撑“深回合优于快回合”的结论，只能确认深回合没有带来失败率或延迟的退化。
- 失败率 0/30 明显低于 23% 基线；但本批没有触发任何工具或上限路径，失败率主要反映单次调用与自动提交的稳定性。
- 输入 token 从第 1 轮的 218 涨到第 30 轮的 1,567，随楼层累积缓慢上升；没有触发 48,000 token 的工具消息上限，上下文省略计数为 0。
- 私有明细与判词只留在 `eval-private/reports/`，本文只含统计数字与模型别名。
