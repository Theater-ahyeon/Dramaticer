# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：10
- 任务：M0-T09 正则分类器
- 结果：完成。新增 `packages/st-compat/src/regex-classifier.ts`（分类、标签扫描、捕获组扫描、升级判定）、`src/health/regex-health.ts`（汇总）和 18 个测试。`pnpm check` 通过（110 个测试）。两份体检报告已用 `pnpm --filter @dramaticer/st-compat report` 重新生成。

## 当前状态
- 门禁：`pnpm check` 通过（invariants → typecheck → lint → test）。
- 正则分类（`src/regex-classifier.ts`，从 `index.ts` 导出）：
  - 入口 `classifyRegexScript(script, siblings)`；`siblings` 传同一个预设的正则，用来判断流式版本能否合并进渲染器。
  - 输出 `category`（8 类）、`deleteScope`（display/prompt/both）、`depthScoped`、`rendersHtml`、`hasInlineScript`、`streaming`、`tagName`/`tagNames`、`wholeTagBlock`、`bodyCaptured`、`captureCount`、`captureReferences`、`upgrade: { applicable, strategy }`。
  - 判定顺序：空正则 → unclassified；流式版本 → 内联脚本 → 渲染 HTML → 删除思考链 → 删除内容 → 重排捕获内容 → 文本替换。
  - 流式版本按结构判定（否定前瞻里出现闭合标签且模式以 `[\s\S]*` 收尾）或脚本名含流式标记；二者都没有时按普通分类处理。
  - 升级策略只有四种：`block_policy`（完整标签块 → 块策略）、`renderer`（完整标签块 + 正文落在捕获组 + 替换只引用合法捕获 → HTML 渲染器）、`sandbox_renderer`（含 `<script>`、事件属性、iframe → 沙箱，不可自动升级）、`keep_regex`（保留原正则）。
  - 提前返回：只要 `hasInlineScript` 为真就一律 `sandbox_renderer`，不再看分类。
- 分类结果（928 条正则）：渲染 HTML 214、内联脚本 141、删除内容 319、删除思考链 76、重排捕获内容 99、文本替换 39、流式版本 34、无法分类 6（findRegex 为空）。启用的 637 条里 300 条可自动升级（47.1%）；按策略是块策略 252、渲染器 175、沙箱渲染器 148、保留原正则 353。删除类里只影响显示 54、只影响 prompt 185、两者 156。
- 报告（`src/health/regex-health.ts` + `report.ts`）：`HealthReport` 新增 `regex` 字段；私有版与统计版都有“正则分类”章节（分类表、可升级比例、删除范围、升级策略），私有一版额外给目标标签前 20（标签名属于私有内容，统计版不能出现）。`collectHealthReport` 现在用 `parsePresetFiles` 解析一次预设，`analyzePresets` 与 `analyzeRegexScripts` 共用。
- 依赖与工具链没有变化。`packages/core/src` 仍然不出现 ST 概念（I1）。

## 下一步
- 执行 M0-T10（状态类评测题），依赖 M0-T07 已完成。
  - 从 MVU diff 里按规则出题：第 Y 楼问“第 X 楼之后 <变量路径> 的值”，答案取自快照，证据是第 X 楼；Y − X ≥ 30，挑变化次数少的变量。
  - 每个对话 50 到 100 题，JSONL 写到 `eval-private/evalset/`：`{id, story, askAtNode, question, answer, evidenceNodes, kind:"state"}`。
  - 验收：题量达标；随机抽 10 题核对答案与快照一致。注意评测集属于私有数据，不能进仓库；仓库里只放生成脚本和统计数字。
- 之后按 TASKS 顺序是 M0-T11（LLM 客户端；HUMAN-01 已完成）、M0-T12、M0-T13、M0-T99。
- 硬性提醒：私有数据只用于 `eval-private/`；提交进仓库的报告只能有统计数字。重新生成报告的命令是 `pnpm --filter @dramaticer/st-compat report`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- HUMAN-02（硅基流动 key）仍然阻塞 M2 的 embedding；HUMAN-04 只影响 M1-T01 的 Gemini 原生验证。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
- 分类器对正则做静态分析，不执行正则；遇到 `(?<name>` 命名组、`(?:...)` 非捕获组、`<\/tag>` 转义写法都已处理。新增判定规则时先补合成用例。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
