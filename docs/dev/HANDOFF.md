# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 333：修复门禁。会话开始时的 `pnpm check` 只有 `packages/core/test/code-plugin-worker.test.ts` 的「声明的四类能力正常执行，并各写一条 allowed Trace」失败，`runtime.state` 是 `failed` 而不是 `active`；同一文件单独运行通过，整轮重跑也通过，属于整轮并行时 worker 线程启动与临时目录模块加载被挤占、撞上默认 10 秒激活上限。
- 改动只在测试：`start` helper 统一传 `activationTimeoutMs` 与 `invokeTimeoutMs` 30 秒（显式传入的 100 毫秒超时用例仍然覆盖它），`waitForState` 与 `waitForTrace` 的等待上限从 3 秒放宽到 30 秒，首个断言改成比较完整 `status`（`name`、`state`、`reason`），失败时能直接看到原因。被测的 `code-plugin-worker.ts` 未改动。
- 验证：目标文件 10 个测试通过；整轮门禁通过（203 个测试文件、1828 个测试、5 个跳过，153 秒）。

## 下一步（会话 334 先做）
1. 按 TASKS 从上往下选：**C-T02.f 兼容报告与共存评测接入**（依赖 C-T02.a 至 C-T02.e，均已完成）。
2. C-T02.f：汇总兼容报告（启用条目 token 规模、未识别 marker 与字段、无法映射的深度与角色、重复条目，均不含正文）；在 `ST_BENCH_COEXIST_PLUGINS` 注册 `st-content` 适配器；跑开启与关闭对照评测，四项原生指标要有数字与样本量，变差时列出项目。报告与评测写法参考 ADR-0100 与 `st-bench/coexist.ts`。
3. C-T02.f 之前或同时，C-T01.b 的批次组合需要补带世界书、宏与正则的卡与预设，否则「与录制一致」仍然只能以沙箱源码行为为准（C-T02.c、C-T02.d 的现状）。
4. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）；X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T02.e 代码事实
- `packages/st-compat/src/chat-jsonl.ts`：
  - `StChatDocument { header: StChatHeader; messages: readonly StChatMessage[] }`。`StChatMessage.raw` 是整条原始记录；`text` 是 `mes`，可能与 `swipes[swipeId]` 不同（编辑过的消息）。
  - `collectChatDocument(entries)`、`parseChatDocument(chunks)`、`parseChatDocumentFile(path)` 复用 `parseChatJsonl` 的字段与校验；第二个头部直接报错。
  - `createChatDocument(headerRaw, messageRaws)` 用原始对象构造文档，内部走与解析相同的 `toHeader`/`toMessage`，`strictSwipeId` 为 true。
  - `serializeChatJsonl(document)` 按 `header.raw`、每条 `message.raw` 逐行 `JSON.stringify`，末尾带换行；`writeChatJsonlFile(path, document)` 写 UTF-8。解析与序列化的往返逐字节一致。
- `packages/st-compat/src/chat-import.ts`：
  - `ChatImportResult.document` 是导入时看到的头部与消息原文，用于导出补回 store 不保存的字段。
  - 导入仍然把 `message.text`（`mes`）写成主路径楼层原文，其他 swipe 作为同一父楼层的兄弟节点；MVU 快照按 `diffSnapshots` 写入 `mvu` 命名空间。
  - 主路径节点 id 为 `<前缀>:m<消息序号>:s<swipe 下标>`；导出的排序依赖这个形式。
- `packages/st-compat/src/chat-export.ts`：
  - `ExportChatOptions { storyId; source?: StChatDocument; header?: { userName; characterName; chatMetadata } }`；`exportChatDocument`、`exportChatJsonl`、`exportChatFile`。
  - 只导出当前 head 路径：路径上一个楼层一条消息；同一 `parentId` 下的兄弟楼层作为 swipe，路径上的楼层是当前 swipe。其他分支不进入导出。
  - `swipe_id` 是当前楼层在排序后兄弟列表里的下标；兄弟列表先尝试按 id 里的 swipe 下标排序，任一楼层 id 不匹配或下标记重复时退回 `listStoryNodes` 的创建顺序。
  - `variables` 是每个兄弟楼层的 `getStateSnapshot(nodeId).state.mvu`（不是对象时写 `{}`）；`source.raw.variables` 存在、兄弟多于一个、或任一楼层状态与父楼层不同时写出该数组。源值是 `{}` 或 `null` 且该楼层状态与父楼层一致时写回原标记，其余写 store 快照。
  - `source` 按消息下标对齐。头部从 `source.header.raw` 复制，`character_name` 取选项、源、故事设置 `cardName`、故事标题中第一个非空值，`user_name` 缺省 `User`；`chat_metadata` 只在选项或源里有该键时写出。
  - 消息从 `source.raw` 复制，再覆盖 store 已知字段：`name` 只在源没有该键时按角色生成（user → 用户名，assistant → 角色名，system → `System`）；`is_user` / `is_system` 在角色匹配或源里有该键时写出；`send_date` 在有源文档且源缺该键时留空，无源文档时写楼层创建时间；`mes` 永远是楼层原文。
  - `swipes` 与 `swipe_id` 在兄弟多于一个、或源里有这两个键时写出。源有 `swipes` 且源 `mes` 与楼层原文一致时，按源数组恢复 swipe 文本（保留编辑消息的 `swipes[swipe_id]`），否则用兄弟楼层原文。导出前切换过分支时源文档的未知字段可能对应不上，调用方应重新导入或只在导入后立即导出时传 `source`。
  - 没有 `source` 时头部只写 `character_name`、`user_name`，消息只有 store 能提供的字段；这是「导出尽力而为」的边界，不猜未知字段、`swipe_info` 与 `extra`。
  - 故事不存在、没有楼层时直接报错；导出只读 store 与状态快照，不写回任何内容。
- 测试 `packages/st-compat/test/chat-export.test.ts` 9 条：文档序列化逐字节一致与未知字段、文件写入与重解析、导入返回源文档、带源文档的完整往返（含编辑消息的 swipes、`swipe_info`、`send_date`）、无源文档的 store 导出（消息、swipe、变量）、重新导入后的楼层与快照一致、store 新增 MVU 事实进入导出、导出文件可解析、未知故事与空故事报错。
- `docs/dev/DECISIONS.md` 的 ADR-0105 记录本次决定。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.e。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43（C-T02.e 与会话 333 都没有改 core 与 schema）。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`（含「共存开关对照」一节）。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 四个子任务全部完成；C-T02 分成 a 至 f，a 至 e 完成，下一个是 C-T02.f。共存评测适配器注册表仍为空。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0105 记录插件、沙箱、比对与兼容内容映射决策。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T02.e 目标测试：`pnpm exec vitest run packages/st-compat/test/chat-export.test.ts packages/st-compat/test/chat-jsonl.test.ts packages/st-compat/test/chat-import.test.ts`。
- C-T02.d 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-macros-regex.test.ts`。
- C-T02.c 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-world-info.test.ts`。
- C-T02.b 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content-preset.test.ts packages/st-compat/test/st-content.test.ts`。
- C-T02.a 与导入相关测试：`pnpm exec vitest run packages/st-compat/test/st-content.test.ts packages/st-compat/test/character-card.test.ts packages/st-compat/test/chat-cli.test.ts`。
- 共存评测目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts`。
- C-T01 目标测试：`pnpm exec vitest run packages/st-compat/test/st-bench-coexist.test.ts packages/st-compat/test/st-bench.test.ts packages/st-compat/test/st-bench-compare.test.ts packages/st-compat/test/st-bench-driver.test.ts`。
- 重建沙箱数据：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js sandbox --source "D:/SillyTavern" --replace`。
- 配置真实沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899 --endpoint http://127.0.0.1:8130/v1 --configure-only`。
- 生成组合清单：`node packages/st-compat/dist/st-bench/cli.js plan --sandbox eval-private/st-sandbox/st --batch <批次>`。
- 驱动组合生成：`pnpm --filter @dramaticer/st-compat build && node packages/st-compat/dist/st-bench/cli.js drive --sandbox eval-private/st-sandbox/st --batch <批次> --limit <数量> --port 8899`。
- 逐条比对：`node packages/st-compat/dist/st-bench/cli.js compare --sandbox eval-private/st-sandbox/st --batch <批次> [--limit <数量>]`。
- 共存评测：`node packages/st-compat/dist/st-bench/cli.js coexist --config <配置.json> [--out <目录>]`（当前没有已注册插件）。
- 单独启动录制：`node packages/st-compat/dist/st-bench/cli.js record --dir eval-private/st-sandbox/runs/<批次> --port 8130`。
- 单独启动沙箱：`node packages/st-compat/dist/st-bench/cli.js serve --sandbox eval-private/st-sandbox/st --port 8899`。
- P4 目标测试：`pnpm exec vitest run packages/core/test/code-plugins.test.ts packages/core/test/code-plugin-installations.test.ts packages/core/test/code-plugin-worker.test.ts packages/core/test/code-plugin-installer.test.ts packages/core/test/code-plugin-examples.test.ts`（45 个测试）。
- 不变量检查：`node scripts/check-invariants.mjs`。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- ST 的原始安装目录只读：不得修改，不得复制出 `secrets.json`、`settings.json`、`cookie-secret.txt`；沙箱里不得配置真实模型端点，录制服务不持有模型客户端（I14）。
- 测试文件里不能出现 I10 拦截的地址：只允许 `localhost`、`127.0.0.1`、`example.com`/`example.org`/`example.invalid` 作为主机名，不能出现 `eval-private` 字面量（用 `stBenchPaths(repoRoot).privateRoot`）。
- Windows 上并行跑测试会显著变慢；`vitest.config.ts` 默认 `testTimeout` 60 秒；`afterEach` 删除临时目录用 `rmSync` 时必须带 `maxRetries` 与 `retryDelay`。
- 整轮并行门禁连跑或与大量临时目录写入同时进行时，Windows 的系统扫描会拖慢文件与 SQLite 操作，出现过后台 worker 激活超时与 `gap-pass-compare` 的 30 秒用例超时；这些用例单独运行都通过。门禁失败先看失败是否只在整轮并行时出现，不要连续并发跑多轮整仓测试。
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
