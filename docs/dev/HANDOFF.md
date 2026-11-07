# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：26
- 任务：M0-FIX-11 依赖声明与文档同步
- 结果：完成。
  - `packages/st-compat/package.json` 把 `png-chunks-extract` 与 `png-chunk-text` 声明为运行时依赖；根目录的 devDependencies 保留给 `scripts/snapshot-private-data.mjs`。
  - `docs/dev/DEPENDENCIES.md` 每行增加“位置”列，并说明 `workspace:*` 工作区依赖不登记。
  - JSON 类型与守卫合并：`packages/core/src/json.ts` 定义 `JsonValue`、`JsonObject`、`isJsonObject`；删除 `packages/st-compat/src/json.ts`，st-compat 各模块从 `@dramaticer/core` 导入，`packages/st-compat/src/index.ts` 再导出同一组符号；`packages/core/src/llm/client.ts` 的 `isRecord` 改名为 `isJsonObject`。
  - 删除零消费者的 `MemoryEvent`；`docs/DESIGN.md` §5 的 `state_diffs` 示例改为 `path`。
  - ADR-0003 记录两个 PNG 库在 st-compat 的运行时声明。
  - TASKS 与 LOG 的 M0-T07、M0-T10 测试数改为 11、10，M0-T08 的 diff/快照改为 20.8%。
- 验证：`pnpm install --frozen-lockfile` 与 `pnpm check` 通过（225 个测试）；`packages/st-compat/node_modules` 里有两个 PNG 库的链接；源码里的裸 import 只有 `@dramaticer/core`、`better-sqlite3`、两个 PNG 库与 `node:` 内置模块。

## 当前状态
- 门禁：`pnpm check` 通过（225 个测试）。
- 快照读取：唯一入口是 `health/manifest.ts` 的 `openSnapshot`，校验路径、`size` 与 `sha256`；任何直接 `path.join(rawRoot, file.target)` 读 raw 的写法都违反完整性校验。
- fixture 维护：修改 fixture 里的聊天、卡、世界书、预设文件后，必须同步更新对应 manifest 的 `size` 与 `sha256`。
- JSON 守卫：只有 `packages/core/src/json.ts` 一份实现；st-compat 从 `@dramaticer/core` 导入，不要再建本地 `json.ts`。
- 题目文件：`readQuestionFile` 拒绝重复 `id`；`sampleDeterministic` 的结果只由题目 `id` 集合决定。
- 事件题：解析阶段的坏条目会进入 `failures`；`EventQuestionStats` 只保留 CLI 读取的字段。
- 评测 CLI：`state-cli.ts` 承载状态题生成与 `summary.json` 写出；`event-cli.ts` 的 `--story` 不覆盖全局抽查与汇总。
- 环境加载：`evalset/env.ts` 的 `loadDotEnv` 要求 `.env` 存在，错误信息包含绝对路径。
- 体检报告：统计版单列头部字节；每对话字段统计是全量，合计表取前 10；比率为 0/0 时显示 `—`；`runHealthCli` 可注入路径与时间；token 估算把谚文计入 CJK。
- 正则分类：升级判断只把启用的兄弟脚本视为渲染器；分类结果没有 `unclassified` 兜底分支。
- 存储：schema 迁移列表版本号必须从 1 连续递增；`getStateDiffs` 与 `getStateDiffsAlongPath` 对不存在的楼层都抛错；diff 的 `path` 在写入与读取两侧都校验。
- ACU 对照组：快照是单元格值列表，逐值规范化后判断包含；提问楼层不在对话里直接抛错。
- 检索：写入与查询共用 `normalizeRetrievalText`；检索评测按 `nodeId` 去重；`askAtNode` 越界抛错。
- 聊天解析：`parseChatJsonl` 只剥离首行的 BOM；`parseChatJsonlFile` 的错误包装为“解析聊天文件失败：<path>”。
- 角色卡：PNG 文本块先做 base64 规范化回环校验，再做 JSON 解析。
- LLM 客户端：`LlmRequest.signal` 贯穿请求、退避与限速等待；缓存键包含 `baseUrl` 与 api key 的 sha256 摘要。
- 依赖：两个 PNG 库同时声明在 `packages/st-compat`（runtime）与根目录（dev，供快照脚本）；`DEPENDENCIES.md` 按声明位置分列登记。
- TASKS：M0-FIX-1 到 M0-FIX-11 已标记 `[x]`；M0-T99 依赖全部 M0 任务。

## 下一步
- 执行 M0-T99（M0 验收）：运行所有报告；在 `docs/dev/reports/M0.md` 总结被数据证实或推翻的设计假设（推翻的写 ADR 并更新 DESIGN）；逐条审查不变量 I1–I10；确认 M1 任务清单还适用。结果写 `MILESTONE_DONE`。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以报告里的文件与符号为准。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 10 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。单独重跑只改生成时间时不要把时间差异带进提交。
- `health/cli.ts` 的入口判断是 `import.meta.url === pathToFileURL(process.argv[1]).href`；测试导入它不会执行 `main`。`evalset/event-cli.ts` 仍在导入时执行，只测试它拆出的 `env.ts` 与 `event-output.ts`。
- `openSnapshot.resolveFile` 会对每个文件重新计算一次 sha256（真实快照合计约 100 MB），CLI 每跑一次都做；如果需要跳过校验，不要在调用侧绕过入口，先写 ADR。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
