# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 330：完成 C-T02.c 世界书完整激活语义。新增 `packages/st-compat/src/st-content/world-info-activation.ts`：`activateStWorldInfo` 是纯函数，按沙箱版酒馆 `checkWorldInfo` 与 `WorldInfoBuffer` 的语义实现主次关键词、AND_ANY/NOT_ALL/NOT_ANY/AND_ALL、`/pattern/flags` 正则关键词、大小写与整词、递归与 `preventRecursion`/`excludeRecursion`/`delayUntilRecursion`、sticky/cooldown/delay、分组逗号拆分、组内 sticky 优先、`groupOverride`、组内权重随机、组内评分、概率、扫描深度、人设/角色卡/场景/作者注释全局扫描字段、位置与深度角色、outlet、token 预算与时间上限；`createStWorldInfoProviders` 的 `lore` 提供者把 before/after 按 `wi_format` 包裹成 system 消息，历史包装器把深度条目插进历史，两者共用同一次激活并跨轮保存计时状态；`mapStPreset` 把 `worldInfoBefore` 与 `worldInfoAfter` 合并到同一个 `lore` 槽位，返回 `worldInfo.before/after` 开关，第二个 marker 记 `merged-lore`；`StWorldInfoEntry` 补六个扫描范围标志，角色卡内嵌世界书补齐位置、深度、角色、分组、概率、计时效果与 outlet 等字段。新增 23 个测试；ADR-0103；门禁通过。

## 下一步（会话 331 先做）
1. 按 TASKS 从上往下选：**C-T02.d 宏与正则**（依赖 C-T02.c，已完成）。
2. C-T02.d 做完整宏引擎与完整正则语义：宏只作用于来自 ST 的文本；正则区分只影响显示、只影响 prompt、作用范围、深度限制；深度正则与 `getRegexedString` 的 placement 对齐；世界书关键词与正文的宏替换接进 C-T02.c 的 `substitute` 参数。先写一致性测试。
3. C-T02.e 对话 jsonl 导入导出；C-T02.f 兼容报告汇总与 `ST_BENCH_COEXIST_PLUGINS` 接入（同时补带世界书的 C-T01 组合，才能把「与录制一致」落到真实请求）。
4. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）；X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T02.c 代码事实
- `packages/st-compat/src/st-content/world-info-activation.ts`：
  - 常量：`ST_WORLD_INFO_POSITION`（0 before、1 after、2 作者注释上、3 作者注释下、4 按深度、5 扩展上、6 扩展下、7 outlet）、`ST_WORLD_INFO_LOGIC`（0 AND_ANY、1 NOT_ALL、2 NOT_ANY、3 AND_ALL）、`EMPTY_ST_WORLD_INFO_TIMED_EFFECTS`。
  - `collectStWorldInfoEntries(worlds)` 摊平世界书并保留世界名；`stWorldInfoEntryKey` 用 `<world>.<uid|sourceKey>` 作为计时键；`parseStWorldInfoKeyRegex` 与酒馆 `parseRegexFromString` 一致；`formatStWorldInfo(value, wiFormat)` 只替换 `{0}`。
  - `activateStWorldInfo(input)` 输入 `worlds`、倒序楼层 `messages`（第 0 条最新）、`chatLength`、`settings`、`globalScanData`、`timedEffects`、`random`、`now`、`deadline`、`dryRun`、`substitute`；输出 `before/after/authorNoteTop/authorNoteBottom/extensionTop/extensionBottom/depth/outlets/entries/issues/timedEffects/steps/deadlineExceeded/budgetExceeded`。
  - 默认设置：扫描深度 2、递归关、递归上限 0、大小写不敏感、非整词、组评分关、触发类型 `normal`。单条目 `scanDepth` 覆盖全局；大于 1000 截断，0 或负数不扫描。
  - 排序：条目按 `order` 降序（缺省 100），稳定排序保持原顺序；输出数组按酒馆语义逐个 `unshift`，最终是升序。深度分组按相同 `depth` 与 `role` 合并，组内 `unshift`；outlet 组内按降序 `push`。
  - 计时：sticky 在 `chatLength >= start + sticky` 时结束并可立即设置受保护的 cooldown；cooldown 在 `chatLength >= end` 时结束；delay 在 `chatLength < delay` 时抑制。`applyTimedEffects` 对每个新激活条目设置 sticky/cooldown 起点；`dryRun` 不写计时状态。
  - 递归：首轮激活的正文加入递归缓冲（`preventRecursion` 除外），`excludeRecursion` 只在递归轮次跳过；`delayUntilRecursion` 只在递归轮次并在达到延迟级别后激活。每轮开始检查 `deadline` 与 `maxRecursionSteps`。
  - 概率：只有 `useProbability === true` 才掷骰；`probability` 缺省 100；失败条目记入本轮的失败集合，不在后续递归重试。token 预算只在同时提供 `budgetTokens` 与 `estimateTokens` 时执行，口径与酒馆一致（累计正文包含当前条目，达到即停）。
  - 分组：`group` 按 `/,\s*/` 拆分；组内 sticky 条目保留、其余移除；`useGroupScoring` 按主关键词命中数加次关键词命中数评分，AND_ALL 只有全部次关键词命中才加；`groupOverride` 取 `order` 最高者；否则按 `groupWeight`（缺省 100）加权随机。已激活条目所在的组会清空本轮候选。
  - `createStWorldInfoProviders({ worlds, store, settings?, globalScanData?, wiFormat?, includeBefore?, includeAfter?, timeBudgetMs?=50, random?, now?, dryRun?, substitute? })` 返回 `{ lore, wrapHistory, activate }`。`lore` 只输出启用的 before/after，`source` 含各组条数、outlet 数、未映射条数与预算状态；`wrapHistory(base)` 调用 `injectStWorldInfoDepthMessages` 在 `baseLength - depth` 处插入深度消息。`activate` 用 `storyId:nodeId` 缓存同一个 Promise，`packKey` 带激活代数。
  - `injectStWorldInfoDepthMessages(messages, groups)`：深度组按创建顺序插入，组内容用换行连接。
- `packages/st-compat/src/st-content/preset-mapping.ts`：`StPresetMapping` 新增 `worldInfo: { before, after }`；两个世界书 marker 只生成一个 `lore` 段，第二个条目报告 `merged-lore` 并写 `world-info-after` 问题。
- `packages/st-compat/src/world-info.ts`：`StWorldInfoEntry` 新增 `matchPersonaDescription`、`matchCharacterDescription`、`matchCharacterPersonality`、`matchCharacterDepthPrompt`、`matchScenario`、`matchCreatorNotes`，从 `extensions` 的 `match_*` 布尔字段读取。`worldInfoFromCharacterBook` 按酒馆 `convertCharacterBook` 补齐位置、深度、角色、分组与权重、概率、扫描深度、大小写、整词、组评分、计时效果、outlet、触发类型与六个扫描范围标志，未知字段保留在原始对象里。
- 测试 `packages/st-compat/test/st-content-world-info.test.ts` 23 条：内嵌世界书字段、大小写、整词、正则、四种次关键词逻辑、装饰器、扫描深度、全局字段、递归与 prevent/exclude/delayUntilRecursion、sticky/cooldown/delay、分组覆盖与权重、评分、概率、位置与顺序、outlet、token/时间预算、`wi_format`、provider 的 before/after、只启用 before、深度历史包装与激活复用。
- **录制现状**：C-T01 的批次请求没有世界书组合，入口基线把 `world-info` 列为不支持。C-T02.c 的一致性规格来自沙箱版 `eval-private/st-sandbox/st/public/scripts/world-info.js` 的运行时行为；要让「激活结果与录制一致」有真实请求证据，需要在 C-T01.b 的组合里补带世界书的卡与预设，C-T02.f 的共存适配器也应使用同一批组合。
- `docs/dev/DECISIONS.md` 的 ADR-0103 记录本次决定；ADR-0102 的世界书 marker 描述已同步为合并到 `lore` 槽位。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.c。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`（含「共存开关对照」一节）。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 四个子任务全部完成；C-T02 分成 a 至 f，a、b、c 完成，下一个是 C-T02.d。共存评测适配器注册表仍为空。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0103 记录插件、沙箱、比对与兼容内容映射决策。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
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
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
