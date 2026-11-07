# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：50
- 任务：M2-T15 记忆引擎评测
- 结果：完成（`DONE`），门槛未全部通过，结论与阻塞已写入 ADR-0023 与 HUMAN-08。
  - 新增 `pnpm --filter @dramaticer/st-compat memory-eval`：
    - `packages/st-compat/src/evalset/memory-eval.ts`：按 manifest 导入 3 个对话（当前 swipe 为主路径，其他 swipe 为兄弟节点），从角色卡与世界书导入实体，按主路径的块生成向量；每题用 core 的 `rankMemoryRoutes` 取每一路名次，用 `fuseRetrievalRoutes` 做 RRF 融合，再按命中@5/10/20 分题型、分对话计分。
    - `packages/st-compat/src/evalset/memory-cache.ts`：按文本内容缓存 embedding，一条文本一个 JSON 文件，每 256 条落一次盘；中断后重跑只补缺失文本。
    - `packages/st-compat/src/evalset/memory-report.ts`：私有版写 `eval-private/reports/m2-retrieval.md`，统计版写 `docs/dev/reports/M2-retrieval.md`；统计版只用“对话 N”，不出现私有故事名或原文。
    - `packages/st-compat/src/evalset/memory-cli.ts`：`--events` 用生产的事件抽取处理器沿主路径建事件，`--viewpoint` 启用知情者过滤，`--db` 覆盖临时库路径；默认不建事件。
  - core 的 `retrieval/hybrid.ts` 拆出 `rankMemoryRoutes`（每一路原始名次）与 `fuseRetrievalRoutes`；`retrieveMemory` 行为不变。实体命中排序改为按规范化实体名称，导入生成的随机实体 id 不再影响排名，重复运行数字一致。
  - 语料：3 个对话 579/412/231 楼，13,818 个块，13,818 条向量，实体 105/61/218。embedding 缓存在 `eval-private/memory-cache/embeddings`，重跑约 2 分钟且不再调用渠道。
  - 结果（融合）：状态题命中@20 32/236（13.6%）；事件题命中@5 125/150（83.3%）、命中@10 141/150（94.0%）、命中@20 147/150（98.0%）。每一路：BM25 状态 33/236@20、事件 128/150@5；向量 31/236@20、124/150@5；实体 9/236@20、16/150@5；事件路由未建立。
  - 门槛：状态题 45% @20 未通过；事件题 @5 88% 未通过；事件题 @20 97% 通过；9 个分对话非回归门槛中 7 个通过，对话 1（74.0% vs BM25 80.0%）与对话 3（78.0% vs 82.0%）的事件题 @5 未通过。重复运行两次数字完全一致。
  - 为什么事件表没有建立：后台渠道实测约 2.7 次/分钟，主路径 1,219 个已确认楼层需要 7 小时以上；`--events` 的中断续跑依赖 `eval-private/memory-cache/llm`，但本次没有完成。报告明确写“事件表未建立”，事件路单独成绩记 0，没有拿空路冒充结果。
  - 为什么状态题远低于门槛：状态题的证据楼层是 MVU 变量产生变化的楼层，原文通常只有动作，变量路径与值在楼层快照里；`retrieveMemory` 没有状态层。45% 门槛来自 ACU 37.3% 与 BM25 8.1% 的并集，隐含了 `getStateSnapshot`/`state_get`。ADR-0023 记录不建议把状态路径匹配塞进 `retrieveMemory`。
  - 测试：`memory-eval.test.ts` 7 个（打分与分路、知情者过滤、向量不重复调用、事件抽取、embedding 缓存、统计版不含私有名、manifest 端到端），`hybrid-retrieval.test.ts` 新增 1 个。门禁 `pnpm check` 通过（58 个测试文件、461 个测试，3 个 live 测试跳过）。

## 当前状态
- M0、M1 完成；M2-T01 至 M2-T15 完成；M2-T99 被 HUMAN-08 阻塞。
- 门禁：`pnpm check` 通过；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 12；运行时检索索引在 `StoryStore` 内（`searchChunks`、`searchVectors`），融合与知情者过滤在 `retrieveMemory`。
- 记忆评测：`packages/st-compat/src/evalset/memory-*.ts`；报告已生成。embedding 缓存与事件模型缓存都在 `eval-private/memory-cache/`（被 git 忽略）。
- 事件抽取的模型回复缓存格式与 `eval-private/llm-cache` 相同（渠道、模型与请求内容寻址）；`--events` 重跑会先读缓存。
- 实体匹配的排序已固定为“命中别名长度降序、规范化实体名称升序”，不要改回按随机 id 排序。
- 运行时 BM25 索引包含 system 楼层；M0 离线基线跳过了 system 楼层，所以对话 2 状态题的 BM25 从 M0 的 1.5% 升到本次的 23.1%。报告中的分对话非回归比较使用的是本次重算的 BM25，M0 数字只作历史对照。
- HUMAN-08 待人类确认：状态题是继续要求文本召回 45%，还是改用状态层答案正确率。确认前不要执行 M2-T99。
- HUMAN-07 仍阻塞 D-T04；D-T01 至 D-T03 可做。

## 下一步
- HUMAN-08 未解除时，从 TASKS 从上往下选 D-T01（`scripts/snapshot-private-data.mjs` 按修改时间取最新对话，manifest 增加语料分组），再做 D-T02、D-T03。
- HUMAN-08 解除后执行 M2-T99：重跑门禁与 live 测试，复核 I1–I10（重点 I5、I6、I7、I8、I9），按 ADR-0023 的口径核对 M2-T15 的门槛，把结论写进 `docs/dev/reports/M2.md`。
- 如果要补事件表，先确认后台渠道的实际吞吐与费用；`memory-eval --events` 可以中断续跑，别重新设计事件抽取流程。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次 1,219 个请求；后台渠道 20 次/分钟的上限与实测延迟会叠加，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- 统计版报告不能出现私有故事名、原文或题目文本；新增渲染内容时先检查。
- `rankMemoryRoutes` 的 limit 同时约束每一路和融合前的候选列表；`retrieveMemory` 只是在融合后按 limit 截断，行为与旧实现一致。
- 不要为了过门槛把 `retrieveMemory` 改成会读状态快照的混合函数；状态层由状态槽位与 `state_get` 承担（ADR-0023）。
- 事件题 @5 的缺口是真实结果：融合在对话 1 与对话 3 上把 BM25 的 @5 从 80.0%/82.0% 拉到 74.0%/78.0%，说明当前 RRF 让向量与实体候选挤掉了 BM25 的前几名；补齐事件表后需要重新跑并调整融合权重，不能引用当前事件路 0 命中的数字做设计判断。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
