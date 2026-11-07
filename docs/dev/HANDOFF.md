# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加）。

## 最近一次会话
- 会话：62
- 任务：M3-T06 重复检测（embedding 版）
- 结果：完成（`DONE`）。
  - `StoryStore.listChunkVectorsForNode(nodeId)` 从 `chunk_vectors` 读出楼层的块向量（float32 小端 blob 解码），按块 `ordinal` 排序，返回 `{chunkId, ordinal, vector}`；楼层不存在直接抛错。
  - core 新增 `director/repetition.ts`，机制名 `repetition`，默认注册在 `clue` 之后、`event_pool` 之前。
  - 节拍只取当前路径上的已确认助手楼层；楼层向量是该楼层全部块向量的平均值；没有向量的楼层跳过，计入 `signals.repetition.missingVectors`。相邻节拍余弦构成相似度序列。
  - 窗口与上升规则沿用 `health/duplication.ts` 的语义：窗口 20 对、步长 10、`riseWindows` 5、`riseDelta` 0.02、`riseMinimum` 0.03；最后一个上升窗口均值必须高于 0.73。单个高值不触发。
  - 场景序列逐节拍读取：配置 `scenePath` 时读该楼层状态快照；取不到时用该楼层最后一条带地点的事件；两者都没有计为缺失并在缺失处中断连续段。最长连续段超过 `sceneRepeatThreshold`（默认 7）时建议换场景。
  - 两类信号同时命中时按优先级只输出一条：文字重复 40、场景停滞 25（线索年龄 30、线索数量 20、事件池 10）。`signals.repetition` 保存节拍、相似度序列、窗口均值、上升段、场景序列、缺失计数与 `thresholdSource: "ADR-0025"`。
  - 配置新增 `similarityThreshold`、`similarityWindow`、`similarityStep`、`similarityRiseWindows`、`similarityRiseDelta`、`similarityRiseMinimum`、`scenePath`（可选）、`sceneRepeatThreshold`，默认值按 ADR-0025 写入 `DEFAULT_DIRECTOR_CONFIG`；非法窗口、阈值或场景配置在评估时抛错。
  - `readStateValue` 从 `tools/read-tools.ts` 抽到 `state.ts`，读取工具改用同一实现。
  - 测试：新增 `packages/core/test/repetition.test.ts`（9 个，含块向量读取、平均向量与余弦、连续上升与单峰、缺失向量、状态与事件两种场景来源、两类信号只取一条、默认参数、非法配置）。既有导演测试与 `chat-cli` 的机制列表断言补上 `repetition`。门禁 `pnpm check` 通过（68 个测试文件、552 个测试；3 个 live 跳过）。

## 当前状态
- M0、M1、M2、D-T01 至 D-T04、M3-T00 至 M3-T06 完成。
- 门禁：`pnpm check` 通过（552 个测试）；live 测试需要 `DRAMATICER_LIVE=1`。
- 数据库 schema 版本 16。
- 快照：`eval-private/raw/` 有 94 个文件；manifest 记录 `corpus` 与 `sourceMtime`。`eval-private/reference/` 有 5 部参照小说。
- 事件表仍未建立；记忆评测的事件路记 0，M3 不要引用这组事件数字。
- HUMAN-03（事件题抽查）仍未完成，不阻塞任何任务；其余 HUMAN 条目均已完成。

## 下一步
- **M3-T07**（下一个会话）：节奏状态机。张力值优先读可配置 `tensionPath`（0 到 1）；取不到时用最近 3 个已确认助手楼层的状态 diff 数量、新建剧情笔记数量与最近事件重要度加权并截断到 0 到 1，公式与权重写入配置与 ADR。阶段取 `setup`、`escalate`、`climax`、`breathe`，按张力与距上次阶段变化的楼层数转移；`pace` 越大进入升级与高潮所需楼层越少；`climax` 最多 7 楼后进入 `breathe`，`breathe` 持续 6 楼后回到 `setup`。每个阶段固定一条指令，阶段与张力写进决策记录 `signals`，从当前路径的决策记录恢复状态，不新增表；没有历史时从 `setup` 开始；分支切换后只读当前路径。
- 然后 M3-T08（开启与关闭导演的对比回放）。注意 T08 依赖 T07 与 T06，且需要真实渠道生成，报告写 `eval-private/reports/m3-director.md` 与 `docs/dev/reports/M3-director.md`。
- ADR-0025 有全部参照阈值，M3-T07 直接读它，不要重新从语料推导。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 事件抽取每次约 1,219 个请求；后台渠道实测约 2.7 次/分钟，不要在一个会话里等待它跑完。
- `memory-eval` 默认删除临时库；`--db` 指定仓库内路径时同样在结束时删除。embedding 缓存保留。
- 状态题 JSONL 必须带 `path`（非空字符串数组）；事件题不要带这个字段。
- 统计版报告不能出现私有故事名、原文或题目文本；参照统计版不能出现版权作品名、文件名或原文。写入前先检查。
- 参照报告默认读取 `eval-private/reports/reference-cosine.json` 里的余弦校准；更换 embedding 模型或维度后要重新运行 `reference:cosine`。
- 新语料的两个对话共用一份世界书，manifest 只保留首次出现的 `character`；按卡里的 `extensions.world` / `character_book` 解析配对。
- 预设从 58 个变为 74 个，其中一个旧预设被人类改过；不要假设预设哈希与 M0 一致。
- 不要把 `eval-private/memory-cache/`、`eval-private/reports/`、临时数据库、`eval-private/raw/`、`eval-private/reference/` 加进提交。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除。
- 安装依赖时用 `HTTP_PROXY= HTTPS_PROXY= pnpm install`。
- 渠道行为（ADR-0009、ADR-0011）：`reasoning:"off"` 在该渠道仍会输出思考并消耗输出 token；abort 后 `usage` 全为 0；gcli2api 必须把 Gemini API 路径挂在 baseUrl 根下；该渠道不支持预填充。
- live 测试用 `DRAMATICER_LIVE=1` 开启；`*.live.test.ts` 会被门禁的 I10 扫描排除。
- Director 机制新增时同步更新既有测试里的机制列表断言：`director.test.ts`、`director-event-pool.test.ts`、`lore.test.ts`、`packages/st-compat/test/chat-cli.test.ts`。
