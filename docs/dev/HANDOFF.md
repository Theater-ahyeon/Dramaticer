# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-12 会话 328：完成 C-T02.a 角色卡、群聊问候、人设与作者注释映射。C-T02 已分成 a 至 f 六个子任务，本会话只做第一个。新增 `packages/st-compat/src/st-content/`：`card.ts` 按酒馆 marker 输出六类未改写字段，分离单聊与群聊问候，生成不含正文的兼容报告；`persona.ts` 读取活动人设的名字、描述、位置、深度、角色与关联世界书，并把原生模板暂时表达不了的位置、深度、角色和世界书记入 issues；`author-note.ts` 读取聊天元数据里的作者注释。`importCardContent` 返回 `cardMapping`，`dramaticer chat` 导入卡时打印报告摘要，`renderCharacterPrompt` 复用同一字段映射。新增 16 个测试；ADR-0101；门禁通过（199 个测试文件、1759 个测试、5 个跳过）。

## 下一步（会话 329 先做）
1. 按 TASKS 从上往下选：**C-T02.b 预设与 prompt 顺序**（依赖 C-T02.a，已完成）。
2. C-T02.b 做 `prompt_order`、深度注入、角色、预填充、续写预填充、squash、format 字段与采样参数；先写一致性测试。把 `StCardPromptSection.marker`、`StPersonaMapping.marker/placement/depth/role`、`readStAuthorNote` 接入模板与槽位。写作约定段（`protocol`）必须保持在最后；无法映射的条目逐条写入报告。
3. C-T02.c 世界书完整激活语义；C-T02.d 宏与正则；C-T02.e 对话 jsonl 导入导出；C-T02.f 兼容报告汇总与 `ST_BENCH_COEXIST_PLUGINS` 接入。
4. 其余可做任务：H-T00（依赖 R5-T99、R3b-T99、E-T01，均已完成）；X1（依赖 R1-T99.a、R2-T99，均已完成）。M5-T00 依赖 R6-T99；M6-T99 等待 HUMAN-15；P5 依赖 M5-T99。

## C-T02.a 代码事实
- `packages/st-compat/src/st-content/card.ts`：
  - `mapCharacterCard(card)` 返回 `{ name, sections, greetings, creatorNotes, embeddedCharacterBook, extensions, raw, report }`。
  - `sections` 的 marker 与字段：`charDescription`（`description`）、`charPersonality`（`personality`）、`scenario`、`main`（`system_prompt`）、`dialogueExamples`（`mes_example`）、`jailbreak`（`post_history_instructions`）。正文原样保留，不做宏替换或裁剪。
  - `creatorNotes` 只作元数据，`report.creatorNotesChars` 记录字符数；`report.unknownFields` 是 data 节点里不在已知字段表里的键，按码点排序；`report.extensionKeys` 是扩展键名；`report.embeddedBookEntries` 是内嵌世界书条目数。
  - `listCharacterGreetings(card, { group })`：单聊列出非空开场白与备用问候；群聊优先 `group_only_greetings`，没有时退回单聊候选。`selectCharacterGreeting(card, { group, alternateIndex })`：备用问候下标越界或正文为空直接报错；群聊与 `alternateIndex` 同时出现直接报错。
- `packages/st-compat/src/st-content/persona.ts`：
  - `readStPersona(settings)` 兼容 `power_user` 嵌套与扁平结构；活动头像取 `user_avatar`，名字取 `power_user.personas[avatar]`，描述、称号、位置、深度、角色、世界书取 `persona_descriptions[avatar]`，缺失字段回落到 `persona_description*`。位置 0 相对、1 作者注释上方、2 作者注释下方、3 聊天内按深度；角色 0 system、1 user、2 assistant。没有活动人设数据时返回 null；非法类型、越界值与非整数直接抛错并指出字段。
  - `mapStPersona(persona)` 返回 `marker: "personaDescription"`、`text`、`role`、`placement`、`depth` 与 `issues`。issues 代码为 `persona-author-note-top`、`persona-author-note-bottom`、`persona-depth`、`persona-role`、`persona-lorebook`，顺序固定为位置、角色、世界书。
- `packages/st-compat/src/st-content/author-note.ts`：`readStAuthorNote(metadata)` 读取 `note_prompt`、`note_interval`（默认 1，最小 1）、`note_position`（0 replace、1 before、2 after，默认 0）、`note_depth`（默认 4，最小 0）、`note_role`（0/1/2，默认 0）。正文为空、元数据缺失或为 null 时返回 null。
- `packages/st-compat/src/chat/session.ts`：`ImportedCardContent` 新增 `cardMapping: StCardMapping`；`importCardContent` 同时返回报告。`packages/st-compat/src/chat/character.ts` 的 `renderCharacterPrompt` 从 `mapCharacterCard(...).sections` 生成带中文标签的提示词。
- `packages/st-compat/src/chat/cli.ts`：导入角色卡时打印 `角色卡兼容：<spec>，prompt 字段 N 个，未知字段 N 个，群聊问候 N 条，作者注释 N 字符未注入`，再逐条打印映射 issues。
- 测试 `packages/st-compat/test/st-content.test.ts` 16 条：字段映射、作者注释隔离、V1/V3 元数据与未知字段、PNG 与 JSON 一致、内嵌世界书计数、扩展键、单聊与群聊问候、备用问候越界、人设读取、人设映射 issues、聊天作者注释。
- `docs/dev/DECISIONS.md` 的 ADR-0101 记录本次决定。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T04.a）、R3、O、R2、E、R4、R5（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1 续（T03.a、T03.b、T04.b、T05.a、T05.b、T06、T08、T99.a）、R3b-T00 至 R3b-T10.b、R3b-T99.a 与 R3b-T99.b、P1.a、P1.b、P1.c、P2.a 至 P2.g、P3.a 至 P3.f、P4.a 至 P4.f、C-T01.a 至 C-T01.d、C-T02.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- 数据库 schema 版本 43。
- 报告：`docs/dev/reports/P2.md`、`P3.md`、`P4.md`、`C-T01.md`（含「共存开关对照」一节）。
- 插件：声明式插件完成格式、解析、叠加、按故事解析与导入报告，尚未接进运行时装载器；代码插件完成清单、安装确认、worker 运行时、安装/更新/卸载库 API、开发文档与示例，尚未接到启动流程与命令行（P5 或专门任务）。
- 兼容插件线：C-T01 四个子任务全部完成；C-T02 分成 a 至 f，C-T02.a 完成，下一个是 C-T02.b。共存评测适配器注册表仍为空。
- 沙箱现状：`eval-private/st-sandbox/st` 有 36 个预设、68 张卡、89 个非驱动聊天片段；预设连接字段已被驱动改写为录制端点与桩模型，全局 `openai_max_context` 已被驱动改为 2,000,000。需要恢复原始预设时用 `sandbox --replace` 重建。
- 私有比对批次：`compare-smoke4`（5 个组合，修复后）与更早的 `compare-smoke2`、`compare-smoke3`、`session324-sanitize`；每个批次的 `compare/` 下有报告、差异清单与汇总。
- ADR-0088 至 ADR-0101 记录插件、沙箱、比对与兼容内容映射决策。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083、ADR-0084、ADR-0085、ADR-0086、ADR-0087。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 已关闭（2026-11-12：人类取消）：取消 Vertex 真实调用的凭证配置与验证要求；`roles.writer` 继续使用 `main-fallback`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/` 或告知路径。

## 可重复命令
- 门禁：`pnpm check`。
- C-T02.a 目标测试：`pnpm exec vitest run packages/st-compat/test/st-content.test.ts`。
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
