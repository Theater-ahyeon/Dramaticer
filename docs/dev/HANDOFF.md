# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：64
- 任务：M3-T08 Director 开关对比评测
- 结果：完成（`DONE`）。
  - 新增 `pnpm --filter @dramaticer/st-compat director-eval`：从 `eval-private/raw/` 的 3 个 legacy 对话导入楼层树，沿主路径按 `interval`（默认 100）取已确认助手楼层作为分支点，要求后面还有至少 `rounds` 条真实用户消息；每个对话最多 `maxBranchPointsPerStory` 个（默认 2）。
  - 回放：每个对话建一次种子数据库（对话、卡、世界书、实体、块与向量），每个回放复制种子库并把 head 指到分支点；只用后续真实用户消息，助手回复由当前模型重新生成。开启与关闭导演使用同一前缀、同一模型与同一结构化输出模式。种子库不建事件表与摘要；生成楼层的块向量在下一轮导演评估前写入。
  - 度量：相邻块 Jaccard 复用参照文本统计（每行一个块、字符 4-gram），节拍余弦复用 M3-T06 的块向量平均与相邻余弦；线索兑现按后续回复包含笔记正文连续 4 个规范化字符判定，同一轮笔记不参与；机制触发来自决策记录，被选中来自 Trace 的 `director:<mechanism>`。
  - 真实运行：`--interval 100 --rounds 5 --pairs 3 --max-points 1`，18 次回放、90 个生成楼层、0 失败。Jaccard 均值开启 0.0915、关闭 0.0940；余弦均值开启 0.9018、关闭 0.9053。每个对话的 Jaccard 方向不一致（对话 1、2 开启更高，对话 3 开启更低）。pacing 触发 9 次并且 9 次被选中；关闭模式 0 条决策记录、0 条导演消息。
  - 模型在 90 轮里没有输出 `plot_note`，新建/兑现笔记为 0/0，兑现率按无样本记为 `—`；报告在限制里写明。线索回收率这次没有可用样本，M3-T99 不能据此确认“开启后线索回收率提高”。
  - 新增 `chat/session.ts` 抽出卡内容导入与槽位组装，`dramaticer chat` 与回放共用；core 导出 `meanVector` 与 `cosineSimilarity` 供评测复用。新增 `director-replay.ts`、`director-eval.ts`、`director-report.ts`、`director-cli.ts` 与 9 个测试；ADR-0027。
  - 两份报告：`eval-private/reports/m3-director.md`（逐次回放）与 `docs/dev/reports/M3-director.md`（只有数字、对话编号、模型别名与配置）；门禁 `pnpm check` 通过（70 个测试文件，567 个测试通过，3 个 live 跳过）。

## 当前状态
- M0、M1、M2、D-T01 至 D-T04、M3-T00 至 M3-T08 完成；M3-T99 待做。
- 门禁：`pnpm check` 通过（567 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 16。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。
- `director-eval` 的模型回复缓存已关闭，保证 `pairs` 是独立样本；embedding 内容缓存保留在 `eval-private/memory-cache/embeddings/`。一次完整运行（默认 2 个分支点）会明显长于本次的 18 次回放，注意时间。

## 下一步
- **M3-T99**（下一个会话）：M3 验收。依赖 M3 全部任务。
  - 重跑 `pnpm check` 与 live 测试；逐条核对 I1–I10，重点 I6（主循环只有一次主模型调用加最多 2 轮读取工具，导演不增加调用）、I7、I9（导演实时决策不调用 LLM）。
  - 逐条核对 M3-T08 的门槛：统计版报告里 Jaccard 与余弦的开启/关闭分布、每个对话的方向、机制触发数；本次 Jaccard 与余弦的差距很小且分对话方向不一致，M3-T99 需要如实判断“显著低于”是否成立，不能把 0.0915 对 0.0940 写成显著下降。
  - 线索回收率本次没有样本（模型没有输出 `plot_note`），报告为 0/0 与 `—`；M3-T99 要写明这一限制，不能据此声称线索回收率提高。
  - 复核 `director-eval` 的失败处理、报告脱敏、缓存关闭与统计口径；确认 M4 的条目（M4-T00 拆解）。
  - 结论写入 `docs/dev/reports/M3.md`，结果写 `MILESTONE_DONE`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- `director-eval` 的 `workDir` 默认在 `eval-private/memory-cache/tmp/director-eval`，结束时整目录删除；种子库与每次回放库都在这里。
- 状态题 JSONL 必须带 `path`（非空字符串数组）；事件题不要带这个字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。`director-eval` 的统计版只用“对话 N”，不写实际故事 id。
- 参照报告默认读取 `eval-private/reports/reference-cosine.json` 里的余弦校准；更换 embedding 模型或维度后要重新运行 `reference:cosine`。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除（本次的 `director-eval.log` 已删除）。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。
