# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：11
- 任务：M0-T10 评测集：状态类题目
- 结果：完成。新增 `packages/st-compat/src/evalset/state-questions.ts`（按稳定区间出题、回放快照核对）与 `evalset/cli.ts`（写出 JSONL 和 summary）。3 个对话共 236 题（71/65/100），生成后用原始聊天逐题核对，全部一致。`pnpm check` 通过（119 个测试）。
- 顺带修正：真实数据里没有变量更新的楼层把 `variables` 写成 `[{}]`，解析后是空对象。旧的 `readSnapshot` 把它当成“清空全部变量”，在用户楼层制造大量 delete。ADR-0006 把空对象与 `null` 一样视为没有更新；`chat-import` 和 `chat-health` 现在共用 `state-diff.ts` 的 `readSnapshot`。体检报告已重新生成，diff/快照从 47.8% 降到 20.8%，diff 条数从 6675 降到 2233，这个数字更接近真实增量。

## 当前状态
- 门禁：`pnpm check` 通过（invariants → typecheck → lint → test，119 个测试）。
- 楼层 id：`src/node-id.ts` 统一生成 `${前缀}:m<消息序号>:s<swipe 下标>`，导入器和评测集共用；`parseMessageIndex` 负责反向解析。
- 状态题生成（`src/evalset/state-questions.ts`，从 `index.ts` 导出）：
  - 入口 `buildStateQuestions(entries, options)`、`buildStateQuestionsFromFile(path, options)`；`verifyStateQuestions` / `verifyStateQuestionsFromFile` 重新解析聊天并核对题目。
  - 语义：空对象或 `null` 快照表示没有更新；每次有效更新把整份快照展开成叶子路径，与上一份比较。数组作为整体比较，不按下标展开；`["值", "说明"]` 形式的二元字符串数组只把第一个元素当成值。
  - 出题：对每个叶子路径的每次有效赋值，找下一次变化之前的最后一个楼层 Y，要求 Y − X ≥ 30（`minGap`），答案是该值，证据是第 X 楼。变化次数超过 10 的路径（每楼都在变）直接排除；路径深度最多 5 段（包含 `stat_data`）；答案序列化后最多 80 字节；`schema`、`initialized_lorebooks`、`display_data`、`delta_data` 和以下划线开头的键不参与出题。
  - 选择：优先变化次数 ≥ 2 的路径，按路径轮转取题，最多 100 题；不足 50 题直接抛错，不静默降级。题目 id 是 `state:<故事>:<提问楼层号>:<JSON 路径>`。
  - 题目字段：任务要求的 `{id, story, askAtNode, question, answer, evidenceNodes, kind:"state"}`，另加 `path`（完整状态路径）供评测器核对和定位变量。
- CLI：`pnpm --filter @dramaticer/st-compat evalset`。读取 `eval-private/raw/manifest.json` 里的 chat，给每个对话生成 `eval-private/evalset/state-<角色>.jsonl` 和 `eval-private/evalset/summary.json`。生成后逐题核对，并随机抽 10 题打印 id；任何一题不一致都会让命令失败。
- 评测集数量：仙侠 71 题（候选 71）、欲望世界 65 题（候选 65）、银麒赎世 100 题（候选 557）；合计 236 题，核对 236 题全部一致。
- 体检报告已用新语义重新生成：`pnpm --filter @dramaticer/st-compat report`，统计版在 `docs/dev/reports/M0-health.md`。
- 依赖与工具链没有变化。`packages/core/src` 仍然不出现 ST 概念（I1）。

## 下一步
- 执行 M0-T11（LLM 最小客户端与事件类题目），依赖 M0-T07、HUMAN-01（已完成）。
  - core 里写一个薄 OpenAI 兼容客户端，渠道从 `.env` 的 `DRAMATICER_BG_*` 读取；带限速、重试和缓存。
  - 用后台模型按窗口阅读对话，生成 `kind:"event"` 的题目，每对话 50 题；随机抽 20% 写到 `eval-private/evalset/spotcheck.md`。
  - 在 HUMAN.md 新增可选事项 HUMAN-03 请人类抽查。
- 之后按 TASKS 顺序是 M0-T12（BM25 基线）、M0-T13（ACU 对照组）、M0-T99（M0 验收）。
- 硬性提醒：评测集属于私有数据，不能进仓库；仓库里只放生成脚本和统计数字。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- HUMAN-02（硅基流动 key）仍然阻塞 M2 的 embedding；HUMAN-04 只影响 M1-T01 的 Gemini 原生验证。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
- 状态题核对依赖“空对象表示没有更新”的语义（ADR-0006）；改动 `readSnapshot` 或快照展开规则时，必须同时重新跑 `evalset`，它会逐题核对并暴露不一致。
- 分类器对正则做静态分析，不执行正则；新增判定规则时先补合成用例。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
