# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：27
- 任务：M0-T99 M0 验收与 M1 准备
- 结果：完成（`MILESTONE_DONE`）。
  - 重跑 `pnpm --filter @dramaticer/st-compat report`（7.05 秒），体检、BM25 基线、ACU 对照三份结果与提交前一致，统计版报告只变了生成时间。
  - 用编译后的模块做导入验收：3 个对话 1222 楼写成 1279 个节点（57 个其他 swipe 的兄弟节点）、2423 条 diff；沿主路径逐楼回放，与当前 swipe 的 MVU 快照深度比较，0 处差异。
  - 写入 `docs/dev/reports/M0.md`：交付物核对、设计假设的证实与修正、I1–I10 逐条证据、M1 任务清单确认、遗留事项。
  - ADR-0008 记录实测校准：DESIGN §2 的每楼体积与状态来源、§14 的存储目标（单楼不超过 10 KB）、分层召回目标、正则升级率 47.1%；M2 过关标准改为按题型分层；M1-T01 补 pi 安装前提，M1-T02 补事件题生成器的客户端迁移。
- 验证：`pnpm check` 通过（27 个测试文件、225 个测试）；真实快照 67 个文件通过 manifest 校验；导入回放 0 处差异。

## 当前状态
- M0 全部完成，M1 尚未开始。下一会话执行 M1-T01。
- 门禁：`pnpm check` 通过（225 个测试）。
- M0 关键数字（以 `docs/dev/reports/M0.md` 与 `M0-health.md` 为准）：3 个对话 1222 楼、66,397,069 字节；状态 diff 是快照的 20.8%；原生存储估算 10,191,693 字节（ST 文件的 15.3%，6.5 倍），合计平均单楼约 8.3 KB。
- 检索基线（@20）：状态题 BM25 8.1%、ACU 37.3%；事件题 BM25 96.0%（@5 83.3%）、ACU 2.0%。
- 正则：928 条，启用 637 条，可自动升级 300 条（47.1%）。
- 快照读取：唯一入口是 `health/manifest.ts` 的 `openSnapshot`，校验路径、`size` 与 `sha256`；不要直接 `path.join(rawRoot, file.target)`。
- 导入回放：`SnapshotDiff` 的语义见 ADR-0005 与 ADR-0006；比较回放结果时用 `node:util` 的 `isDeepStrictEqual`，不要用 `JSON.stringify`（对象键顺序不同会产生假差异）。
- 题目文件：`readQuestionFile` 拒绝重复 `id`；`sampleDeterministic` 只由题目 `id` 集合决定。
- 评测 CLI：`state-cli.ts` 写 `summary.json`；`event-cli.ts` 的 `--story` 只写故事专属文件；事件题生成命中 `eval-private/llm-cache`，不会重复调用渠道。
- 依赖：两个 PNG 库同时声明在 `packages/st-compat`（runtime）与根目录（dev，供快照脚本）；`pi-ai` 与 `pi-agent-core` **尚未安装**。
- 文档：`docs/dev/reports/M0.md` 是 M0 的验收结论；ADR-0008 是设计数字的当前依据。

## 下一步
- 执行 M1-T01（pi 技术验证）：先用 pnpm 在根目录 devDependencies 安装并锁版本 `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core`，登记到 `DEPENDENCIES.md`；读 `node_modules` 里的 README 与类型定义；在 `spikes/pi/` 验证流式、思考内容、函数调用、abort 后续写，以及 `prepareRequest`、`beforeToolCall`、`finishTurn` 三个钩子；Gemini 原生自定义 baseUrl 一项依赖 HUMAN-04 的 gcli2api（未启动就跳过并记录）。产出 ADR，写明是否采用 pi 与采用范围。
- M1-T02 会把 `evalset/event-questions.ts` 迁移到新的 `core/llm` 接口，之后删除 `packages/core/src/llm/client.ts`；迁移期间保留 `eval-private/llm-cache` 的读取。

## 注意事项
- 报告里的问题行号对应审查时的代码；修复任务会改动这些位置，引用报告时以文件与符号为准。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。M0 的审查与修复不需要调用 LLM。
- `pnpm --filter @dramaticer/st-compat report` 会跑体检、检索基线、ACU 基线，耗时约 7 秒；需要 `eval-private/evalset/` 里已有状态题与事件题。单独重跑只改生成时间时不要把时间差异带进提交。
- `health/cli.ts` 的入口判断是 `import.meta.url === pathToFileURL(process.argv[1]).href`；测试导入它不会执行 `main`。
- `openSnapshot.resolveFile` 会对每个文件重新计算一次 sha256（真实快照合计约 100 MB），CLI 每跑一次都做；如果需要跳过校验，不要在调用侧绕过入口，先写 ADR。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件；需要改时写进 HUMAN.md。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
- 临时脚本放 `.devloop/scratch/`（已被 git 忽略），用完删除；`tsc -b` 会把 `packages/*/dist` 编译出来，可以直接用 `node` 跑 `dist` 里的模块做冒烟验证。
