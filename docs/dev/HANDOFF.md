# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-13 会话 331：完成 C-T02.d 宏与正则。新增 `packages/st-compat/src/st-content/macros.ts`：`createStMacroEngine` 复刻酒馆旧宏引擎（默认关闭实验性引擎时的 `evaluateMacros`）的求值顺序与语义——`<USER>`/`<BOT>`/`<CHAR>`/`<CHARIFNOTGROUP>`/`<GROUP>`、骰子、变量宏（`setvar`/`addvar`/`incvar`/`decvar`/`getvar` 与 global 版本）、`newline`/`trim`/`noop`/`input`、角色卡与用户环境宏（按酒馆对象插入顺序逐个替换，先替换的值里的宏会被后面的宏继续展开）、上下文宏、`random`/`pick`/`roll`、对话宏、时间宏、`outlet`、屏蔽词与注释。新增 `packages/st-compat/src/st-content/regex.ts`：`parseStRegexScript`、`collectStRegexScripts`（全局→角色卡→预设，角色卡与预设默认不执行）、`applyStRegexScripts`（复刻 `getRegexedString` 的位置、只影响显示、只影响 prompt、编辑开关与最小/最大深度筛选）、`runStRegexScript`（`{{match}}`、`$1`、`$<name>`、`trimStrings`、`substituteRegex` 的 RAW/ESCAPED、替换串最后整体做一次宏替换）。`mapStPreset` 新增 `macros` 选项，在写进模板与注入列表前替换预设条目、卡片 marker、人设与作者注释；`activateStWorldInfo` 用同一个 `substitute` 替换关键词与正文，替换后的正文进入递归缓冲与 token 预算，激活结果按 `WORLD_INFO` 位置执行 promptOnly 正则并带条目深度；`createStWorldInfoProviders` 新增 `regexScripts`。新增 23 个测试、ADR-0104，登记 `moment`、`seedrandom`、`droll` 与 `@types/seedrandom`；门禁通过。

## 下一步（会话 332 先做）
1. 按 TASKS 从上往下选：**C-T02.e 对话 jsonl 导入导出**（依赖 C-T02.d，已完成）。
2. C-T02.e：导入导出 `chat_metadata` 与消息数组，保留 swipe、变量快照、头部元数据与未知字段；导出尽力而为；导入的原文不改写。已有 `packages/st-compat/src/chat-jsonl.ts` 与 `chat-jsonl.test.ts`，先看现有能力再补缺口。
3. C-T02.f 兼容报告汇总与 `ST_BENCH_COEXIST_PLUGINS` 接入；同时补带世界书、宏与正则的 C-T01 组合，才能把「与录制一致」落到真实请求。
4. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）；X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T02.d 代码事实
- `packages/st-compat/src/st-content/macros.ts`：
  - 类型：`StMacroSubstitute`、`StMacroSubstituteOptions`（`postProcess`、`charOverride`）、`StMacroVariables`（`local`/`global`，值可以是数字）、`StMacroChatMessage`、`StMacroCardFields`、`StMacroOptions`、`StMacroEngine`。
  - `createStMacroEngine(options)` 返回 `{ variables, substitute, unresolved }`。`variables` 默认新建，也可传入共享对象；`substitute(text, { postProcess, charOverride })` 每次调用重建环境与规则表；`unresolved(text)` 只扫描文本里的宏名，调用方应对替换后的文本调用它。
  - 环境宏顺序：`original`（一次替换只输出一次）、`charPrompt`、`charInstruction`（缺省回退 `charJailbreak`）、`charJailbreak`（缺省回退 `charInstruction`）、`description`、`personality`、`scenario`、`persona`、`mesExamples`、`mesExamplesRaw`、`charVersion`/`char_version`、`charDepthPrompt`、`creatorNotes`、`user`、`char`、`group`、`charIfNotGroup`、`groupNotMuted`、`notChar`、`model`、`extra`。`user`/`char`/`group` 等始终有值（缺省空串）；`group` 缺省等于 `char`，`notChar` 缺省等于 `user`；卡字段只在调用方提供时注册。
  - 变量读取把数值字符串转成数字（`"010"` → `"10"`），`addvar` 对数组追加、对数字求和、其余拼接；`incvar`/`decvar` 返回新值。
  - `{{pick}}` 的种子是 `stStringHash(`${chatIdHash}-${rawContentHash}-${offset}`)`，`chatIdHash` 来自 `stStringHash(chatId ?? "")`；`seedrandom` 生成与酒馆相同的序列。`{{random}}` 用 `options.random`（默认 `Math.random`）。`{{roll}}` 用 `droll`，纯数字公式视为 `1dN`，非法公式输出空串。
  - 时间宏用 `moment`：`time` 是 `LT`、`date` 是 `LL`、`weekday` 是 `dddd`、`isotime` 是 `HH:mm`、`isodate` 是 `YYYY-MM-DD`、`datetimeformat`、`idle_duration`、`time_UTC±n`、`timeDiff`；`now` 可注入固定时钟。
  - `{{trim}}` 连同前后换行一起删除；`{{// ...}}` 注释；`{{banned "x"}}` 输出空串；`{{outlet::名字}}` 在 post 宏序列里按位置替换（在 `timeDiff` 之前），outlet 内容里的 `random`/`pick` 会继续被替换。
  - `stStringHash` 从酒馆 `getStringHash` 原样移植并导出，供 `{{pick}}` 与需要同一哈希的调用方使用。
- `packages/st-compat/src/st-content/regex.ts`：
  - `StRegexScript` 复用 `packages/st-compat/src/preset.ts` 的既有类型（含 `raw`），不要在这里再定义一份。
  - `ST_REGEX_PLACEMENT`：`markdownDisplay` 0、`userInput` 1、`aiOutput` 2、`slashCommand` 3、`worldInfo` 5、`reasoning` 6；`ST_SUBSTITUTE_REGEX`：`none` 0、`raw` 1、`escaped` 2。
  - `parseStRegexScript(raw)` 宽松解析；缺少 `findRegex` 或不是 JSON 对象时返回 null。`collectStRegexScripts({ global, scoped, preset, allowScoped, allowPreset })` 顺序为全局、角色卡、预设，角色卡与预设要显式允许。
  - `applyStRegexScripts(text, placement, options)` 的脚本执行条件：`markdownOnly && isMarkdown`、`promptOnly && isPrompt`、或两者都不设且既非 `isMarkdown` 也非 `isPrompt`；`isEdit && !runOnEdit` 跳过；深度筛选只在传入 `depth` 时生效（`minDepth >= -1` 且 `depth < minDepth` 跳过，`maxDepth >= 0` 且 `depth > maxDepth` 跳过）；`placement.includes(placement)`。
  - `runStRegexScript`：`{{match}}` 先换成 `$0`，再按 `$1`、`$<name>` 取捕获组；捕获值用 `trimStrings` 删除（`trimStrings` 本身先做宏替换，`{{char}}` 用当前角色名覆盖），替换串最后整体做一次宏替换。未传 `substitute` 时使用空上下文宏引擎，与酒馆始终调用 `substituteParams` 一致。
  - `stRegexFromString` 与酒馆 `regexFromString` 相同（`/pattern/flags` 或普通字符串，编译失败返回 null）。
- `packages/st-compat/src/st-content/preset-mapping.ts`：`StPresetMappingInput` 新增 `macros?: StMacroEngine`；预设条目、卡片 marker、静态段、深度注入、人设注入与作者注释都在写入前替换；替换后仍含 `{{...}}` 的文本继续记 `macro` 问题（`detail` 是条目标识）。
- `packages/st-compat/src/st-content/world-info-activation.ts`：`StWorldInfoActivationInput` 的 `substitute` 类型改为 `StMacroSubstitute`，新增 `regex?: StWorldInfoRegexOptions`（`scripts` 与 `substitute`）；激活循环在概率检查通过后执行 `item.content = substitute(item.content)`，递归缓冲与 token 预算使用替换后的正文；`buildActivation` 在构建 before/after、作者注释上下、扩展上下、深度分组与 outlet 时执行 `WORLD_INFO` 位置的 promptOnly 正则，深度条目带自己的深度，正则后为空的内容不进入输出。`StWorldInfoProviderOptions` 新增 `regexScripts` 并交给同一次激活。
- 测试 `packages/st-compat/test/st-content-macros-regex.test.ts` 23 条：环境宏与展开顺序、变量、随机与抽取、骰子、对话宏、时间宏、工具宏、空闲时长、原句、未识别宏与后处理；正则位置、显示/prompt 互斥、关闭与编辑、深度范围、替换组与 trimStrings、`substituteRegex`、非法正则、来源顺序；预设/卡片/人设/作者注释宏替换、未识别宏报告、世界书关键词与递归缓冲宏替换、世界书 prompt 正则与深度筛选。
- **依赖**：`packages/st-compat` 新增运行时 `moment@^2.30.1`、`seedrandom@^3.0.5`、`droll@^0.2.1` 与开发依赖 `@types/seedrandom`；`droll` 没有类型声明，`packages/st-compat/src/droll.d.ts` 提供 `validate`/`roll` 的最小声明。
- **录制现状**：C-T01 的批次请求没有世界书、宏与正则组合，入口基线把 `world-info` 列为不支持。C-T02.d 的一致性规格来自沙箱版 `eval-private/st-sandbox/st/public/scripts/macros.js`、`variables.js`、`extensions/regex/engine.js` 与 `script.js` 的 `substituteParams`；要让「与录制一致」有真实请求证据，需要在 C-T01.b 的组合里补带这些内容的卡与预设，C-T02.f 的共存适配器也应使用同一批组合。
- `docs/dev/DECISIONS.md` 的 ADR-0104 记录本次决定。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a 至 C-T02.d。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`（含「共存开关对照」一节）。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 四个子任务全部完成；C-T02 分成 a 至 f，a、b、c、d 完成，下一个是 C-T02.e。共存评测适配器注册表仍为空。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0104 记录插件、沙箱、比对与兼容内容映射决策。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
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
- `packages/st-compat` 与 `packages/server` 的测试通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这些包的测试前先执行 `pnpm run typecheck`。
- 结构化 JSON 请求一律使用 `NO_CONTINUATION`；正文写作与散文类后台输出保留续写。
- web 源码不能 import `@dramaticer/core` 的运行时值（会把 `better-sqlite3` 与 `node:*` 打进前端包导致整页白屏），类型导入可以。
- 插件模块静态初始化时不要调用会反向 import 当前模块的注册表；槽位名等基础常量放在叶子模块。
- 新增的格式化与 lint 用 `pnpm exec biome check --write <文件>`，不要手写格式。
- 修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 的请求写进 HUMAN.md。
- 不变量：I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖其他工作区包，I17 回合内插件钩子有时间预算，I18 插件权限必须声明。
