# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：9
- 任务：M0-T08 体检报告
- 结果：完成。新增 `packages/st-compat/src/health/`（token 估算、重复度、对话、实体、预设、报告渲染、CLI）和 26 个测试。`pnpm check` 通过（92 个测试）。私有报告 `eval-private/reports/health.md`，统计版 `docs/dev/reports/M0-health.md` 已生成；统计版里没有任何原文或私有文件名。

## 当前状态
- 门禁：`pnpm check` 通过（invariants → typecheck → lint → test）。
- 体检 CLI：`pnpm --filter @dramaticer/st-compat report`。脚本先 `tsc -b` 再运行 `dist/health/cli.js`；从仓库根的 `eval-private/raw/manifest.json` 读文件清单，写上面两份报告。
- 对话指标（`src/health/chat-health.ts`，流式读取）：
  - 楼层数、角色分布、swipe 数、文件字节、头部字节。
  - 正文是当前 `mes`；变量是消息里物理存储的 `variables`（JSON 数组，包含所有 swipe）；其他 = 重新序列化整条消息后减去正文和变量。`fieldBytes` 给出其他字段前 10，已排除 `mes` 和 `variables`。
  - token 估算可替换：`createTokenEstimator` 默认中文 1.5 字符/token、其他 4 字符/token。
  - 主路径快照字节与原生 diff 字节；diff 由 `diffSnapshots` 生成，每条序列化为 `[path, op, value]` 计字节。真实快照总计 1274620 字节快照、609294 字节 diff（47.8%），6675 条主路径 diff。
  - 重复度：相邻 AI 回复的字符 4-gram Jaccard，窗口 20 对、步长 10；持续上升要求连续 5 个窗口不下降、首尾上涨至少 0.02、起点均值不低于 0.03。真实数据里只有第三个对话在第 82 楼触发，另外两个没有。
- 实体指标（`src/health/entity-health.ts`）：卡文本字段字节、标签/开场/内嵌条目；世界书条目、启用/常驻数、主次关键词、去重主关键词、正文字节。真实数据 381 条世界书条目（370 启用、146 常驻）、641 个去重主关键词、328 条卡内嵌条目。
- 预设指标（`src/health/preset-health.ts`）：提示词条目与启用数、marker 数、正文字节/token、宏频率（只统计英文字母开头的标识符，`{{// ...}}` 记为 `//`，其余计入无法识别次数）、正则脚本数、停用数、placement 分布（1 USER_INPUT、2 AI_OUTPUT、3 SLASH_COMMAND、5 WORLD_INFO、6 REASONING）、markdownOnly/promptOnly/runOnEdit、深度限制、findRegex 参数替换方式。真实数据 58 个预设、928 个正则（291 停用）、宏以 setvar/getvar/user 为主。
- 报告渲染（`src/health/report.ts`）：`collectHealthReport` 校验并解析 manifest、拒绝越界路径；`renderPrivateReport` 含角色名/文件名/每对话字段与窗口明细；`renderPublicReport` 只输出匿名“对话 N/卡 N”和统计数字。统计版覆盖检查已用 manifest 里的角色名、文件路径和一条原文做过。
- 重构：diff 规则从 `chat-import.ts` 提取到 `src/state-diff.ts`（`readSnapshot`、`diffSnapshots`、`SnapshotDiff`），`chat-import` 的导入语义不变，已有 7 个测试继续通过；`index.ts` 导出 `state-diff`。
- 依赖与工具链没有变化。`packages/core/src` 仍然不出现 ST 概念（I1）。

## 下一步
- 执行 M0-T09（正则分类器），依赖 M0-T05 已完成。
  - 在 st-compat 里按 DESIGN §6 分类：html_render、html_script、delete（只影响显示/只影响 prompt/带深度限制）、strip_cot、rewrite_capture、text_replace、streaming_variant；再判断每条能否自动升级成块策略。
  - 对 `eval-private/raw/presets/` 的全部预设运行一遍，把统计追加到 `docs/dev/reports/M0-health.md`。可以复用 `analyzePresetFiles`、`StRegexScript` 的字段（`placement`、`markdownOnly`、`promptOnly`、`minDepth`、`maxDepth`、`findRegex`、`replaceString`），并扩展 `src/health/report.ts` 的渲染，避免手工改报告。
  - 验收要求：每个分类都有合成用例；报告里有可升级比例。
- 之后按 TASKS 顺序是 M0-T10（状态题）、M0-T11（LLM 客户端；HUMAN-01 已完成）、M0-T12、M0-T13。
- 硬性提醒：私有数据只用于 `eval-private/`；提交进仓库的报告只能有统计数字。重新生成报告的命令是 `pnpm --filter @dramaticer/st-compat report`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- HUMAN-02（硅基流动 key）仍然阻塞 M2 的 embedding；HUMAN-04 只影响 M1-T01 的 Gemini 原生验证。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
