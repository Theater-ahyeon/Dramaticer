# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 329：完成 C-T02.b 预设与 prompt 顺序。新增 `packages/st-compat/src/st-content/preset-mapping.ts`：`mapStPreset` 按 `prompt_order`（100001 优先）生成原生模板，普通条目变静态段、`chatHistory` 变 history 槽位、`worldInfoBefore` 变 lore 槽位，卡片 `system_prompt` 与 `post_history_instructions` 覆盖 `main` 与 `jailbreak`；`scenario_format` 与 `personality_format` 替换占位符，其余宏记问题留给 C-T02.d；绝对位置条目收集为深度注入，`createStHistoryProvider` 按酒馆语义叠加到历史消息，包装器用内容哈希更新 `packKey`；作者注释三种位置与玩家楼层间隔、人设提示词内/聊天内位置接入模板与槽位；采样只映射 temperature、openai_max_tokens 与可识别的 reasoning_effort；写作契约固定最后；`selectStPromptOrderGroup` 移到 `preset.ts`。新增 14 个测试；ADR-0102；门禁通过。

## 下一步（会话 330 先做）
1. 按 TASKS 从上往下选：**C-T02.c 世界书完整激活语义**（依赖 C-T02.b，已完成）。
2. C-T02.c 做世界书的主次关键词与逻辑、正则关键词、递归、sticky/cooldown/delay、分组与组内权重、概率、扫描深度、位置/深度/角色、outlet；`worldInfoAfter` 的映射问题与 `wi_format` 由这一任务接管。先写一致性测试。
3. C-T02.d 宏与正则；C-T02.e 对话 jsonl 导入导出；C-T02.f 兼容报告汇总与 `ST_BENCH_COEXIST_PLUGINS` 接入。
4. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）；X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T02.b 代码事实
- `packages/st-compat/src/st-content/preset-mapping.ts`：
  - `mapStPreset({ preset, card, structuredOutput, persona?, authorNote?, playerMessageCount?, templateId? })` 返回 `{ template, entries, injections, sampling, prefill, formats, authorNote, issues }`。
  - 顺序组由 `selectStPromptOrderGroup` 选择（100001 → 100000/null → 第一组）；该函数在 `packages/st-compat/src/preset.ts`，`st-bench/faithful.ts` 的 `selectPromptOrderGroup` 只是转调。
  - 模板段 id 为 `st:<序号>:<identifier>`；ST 内容静态段优先级 10，history 100，lore 80，作者注释静态段 10；写作契约从 `createDefaultContextTemplate` 复制并固定最后，返回前调用 `assertContextTemplate`。
  - marker 映射：`charDescription`、`charPersonality`、`scenario`、`main`、`dialogueExamples`、`jailbreak`、`personaDescription`；`main` 的卡片 `system_prompt` 与 `jailbreak` 的 `post_history_instructions` 在 `forbid_overrides` 为 false 时覆盖条目正文。`chatHistory` → `history` 槽位；`worldInfoBefore` → `lore` 槽位；两个世界书 marker 同时出现时第二个记 `world-info-after`。
  - `scenario_format` / `personality_format` 只替换 `{{scenario}}` / `{{personality}}`；文本里剩余的 `{{…}}` 记 `macro` 问题，不做宏展开。`formats.worldInfo` 原样保留 `wi_format`。
  - 绝对位置（`injection_position === 1`）条目要求非负整数 `injection_depth`，`injection_order` 缺省 100；`StDepthInjection.source` 为 `preset` 或 `extension`。
  - `injectStDepthMessages(messages, injections)`：深度 0 在最后一条之后，深度 n 在倒数第 n 条之前；同一深度按 `order` 升序、组内按 assistant、user、system 排序；`extension` 内容接在同组同角色预设正文之后，用换行连接。`createStHistoryProvider(base, injections)` 保留原 `source`，并把注入哈希写进 `packKey`。
  - 作者注释：位置 0 在主提示之后、2 在主提示之前、1 按深度扩展注入；间隔按玩家楼层数取模，间隔大于 1 且缺少楼层数记 `author-note-interval`。人设位置 0/1 输出静态段、4 深度注入、2/3 记 `persona-author-note-top` / `persona-author-note-bottom`、9 跳过。
  - 采样：映射 `temperature`、`openai_max_tokens`、可识别的 `reasoning_effort`；`top_p`、`top_k`、`top_a`、`min_p`、`frequency_penalty`、`presence_penalty`、`repetition_penalty`、`seed`、`n`、`openai_max_context` 进 `sampling.unsupported` 并写 `sampling:<字段>` 问题。预填充、续写、squash、assistant impersonation 保留原值并逐条说明原生回合暂不消费。
  - 清单 `entries` 与问题 `issues` 只含标识、启用状态、类别、角色、字符数与原因，不含正文。
- `packages/st-compat/src/st-content/persona.ts`：位置枚举已按酒馆实际值修正为 0 提示词内、1 旧版角色之后、2 作者注释上方、3 作者注释下方、4 聊天内按深度、9 不注入；`mapStPersona` 在聊天内时不再写 depth/role 问题，只对作者注释上下方与关联世界书写问题。
- `packages/st-compat/src/st-content/author-note.ts`：`StAuthorNotePlacement` 为 `in-prompt`、`in-chat`、`before-prompt`，对应 `note_position` 0/1/2，默认 `in-chat`。
- 测试 `packages/st-compat/test/st-content-preset.test.ts` 14 条：模板顺序与契约最后、100001 优先、关闭/缺失/无法映射报告、深度注入分组、历史包装器、无历史注入报告、作者注释与同深度扩展拼接、作者注释三种位置与间隔、无主提示、采样映射、预填充/squash、未知思考档位、报告不含正文。
- `docs/dev/DECISIONS.md` 的 ADR-0102 记录本次决定；ADR-0101 的人设与作者注释位置枚举已同步为酒馆实际值。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a、C-T02.b。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`（含「共存开关对照」一节）。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 四个子任务全部完成；C-T02 分成 a 至 f，a 与 b 完成，下一个是 C-T02.c。共存评测适配器注册表仍为空。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0102 记录插件、沙箱、比对与兼容内容映射决策。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
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
