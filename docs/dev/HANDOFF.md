# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：6
- 任务：M0-T05 st-compat 世界书与预设解析
- 结果：完成。新增 `packages/st-compat/src/world-info.ts`（ST 世界书）、`packages/st-compat/src/preset.ts`（OpenAI 预设）、`packages/st-compat/src/field-readers.ts`（两个解析器共用的严格字段读取）；测试 `test/world-info.test.ts` 8 个、`test/preset.test.ts` 13 个。真实快照的 3 个世界书和 58 个预设全部解析通过，逐文件核对「解析后写回 JSON → 再解析」与原文件结构相等。

## 当前状态
- 门禁：`pnpm check` 通过（invariants → typecheck → lint → test），46 个测试。
- 世界书 API（`@dramaticer/st-compat` 入口导出）：
  - `parseWorldInfoJson(text)`、`parseWorldInfoFile(path)`；`parseWorldInfoFile` 遇到任何错误（包括读文件失败）都会包成 `解析世界书失败：<路径>`。
  - `StWorldInfo`：`name`（文件路径去 `.json` 的名字，文本解析为 null）、`entries`、`originalData`（部分世界书带的角色卡内嵌世界书格式数据，没有为 null）、`raw`。
  - `StWorldInfoEntry`：`sourceKey`（`entries` 对象的键）、`uid`、`keys`（JSON 的 `key`）、`secondaryKeys`（`keysecondary`）、`comment`、`content`、`constant`、`selective`、`selectiveLogic`、`insertionOrder`（JSON 的 `order`）、`position`、`depth`、`probability`、`useProbability`、`disabled`（JSON 的 `disable`）、`excludeRecursion`、`preventRecursion`、`delayUntilRecursion`（`number | boolean`）、`group`、`groupOverride`、`groupWeight`、`scanDepth`、`caseSensitive`、`matchWholeWords`、`useGroupScoring`、`automationId`、`role`、`sticky`、`cooldown`、`delay`、`displayIndex`、`vectorized`、`ignoreBudget`、`outletName`、`triggers`、`extensions`、`raw`。
- 预设 API：
  - `parsePresetJson(text)`、`parsePresetFile(path)`；文件错误的包装是 `解析预设失败：<路径>`。
  - `StPreset`：`name`、`temperature`、`topP`、`topK`、`topA`、`minP`、`frequencyPenalty`、`presencePenalty`、`repetitionPenalty`、`maxTokens`（JSON 的 `openai_max_tokens`）、`contextSize`（JSON 的 `openai_max_context`）、`seed`、`n`、`reasoningEffort`、`assistantPrefill`、`assistantImpersonation`、`prompts`、`promptOrder`、`regexScripts`、`extensions`、`raw`。
  - `StPresetPrompt`：`identifier`、`name`、`content`、`role`、`systemPrompt`、`marker`、`enabled`、`forbidOverrides`、`injectionPosition`、`injectionDepth`、`injectionOrder`、`injectionTrigger`、`attachIndex`、`attachRole`、`attachSide`、`extra`、`raw`。
  - `StPromptOrderGroup`：`characterId`（`character_id`）、`order`、`raw`；`StPromptOrderEntry`：`identifier`、`enabled`、`raw`。
  - `StRegexScript`：`id`、`scriptName`、`findRegex`、`replaceString`、`trimStrings`、`placement`、`disabled`、`markdownOnly`、`promptOnly`、`runOnEdit`、`substituteRegex`、`minDepth`、`maxDepth`、`raw`。
- 严格读取规则：
  - 文本字段缺失或 null 时取空串；数组缺失取空数组；其余可选标量（数字、布尔、对象、字符串）缺失取 null。`constant`、`selective`、`disable` 缺失取 false；prompt 的 `enabled` 和 prompt_order 条目的 `enabled` 缺失取 true（与酒馆行为一致）。
  - 类型不对立刻抛错，错误信息带上下文和字段名，例如 `世界书条目 "0"字段 "key[1]" 不是字符串`、`预设字段 "prompt_order[0].order" 不是数组`。`entries` 不是对象、单个条目不是对象、`prompts`、`prompt_order`、`extensions.regex_scripts`、`prompt_order[i].order` 的形状不对都会抛错。
  - 酒馆有预设把 `openai_max_context` 存成数字字符串（真实快照里 `夏瑾 Pro 比邻星 1.90.json` 是 `"666693"`），`preset.ts` 的 `readConfigNumber` 接受 `^-?\d+(?:\.\d+)?$` 的字符串并转成数字；raw 里仍保留原字符串。世界书字段不适用这条规则。
  - `raw`、条目/提示/脚本的 `raw`、`extensions`、`originalData` 都是原对象的同一引用，没有复制；导出时直接写回 `raw`。测试与真实快照都验证了 `JSON.parse(JSON.stringify(raw))` 与原始文件结构相等。
- 真实数据观测（只给统计）：世界书条目数 104/60/217，常驻（constant）44/32/78，禁用 3/3/5，带主关键词 66/52/141，带次关键词 0/1/9，position 分布 0/1/2/4 都有；解析耗时 1/1/4 毫秒。预设 58 个文件，prompt 共 8004 条（启用 2361，marker 485，带注入位置 7706），prompt_order 共 82 组、7310 条，正则脚本 928 条（禁用 291，promptOnly 449，markdownOnly 657），最慢一个 12 毫秒。
- 角色卡内嵌世界书仍以 `characterBook` 的原始对象形式保留（M0-T04 的接口未改动）；它的条目是数组，字段名（`keys`、`secondary_keys`、`insertion_order`、`enabled`、`position` 字符串）与这次解析的独立世界书不同。M0-T08 统计实体时可以直接读这份 raw，或者另加内嵌世界书的类型化解析。
- 工具链不变：tab 缩进，`scripts/**`、`eval-private/**` 被 lint 忽略。
- 顺手产物：`eval-private/scratch/inspect-worlds.mjs`、`inspect-presets.mjs`、`inspect-preset-shapes.mjs`、`inspect-preset-values.mjs`、`inspect-card-book.mjs`、`parse-worlds-presets.mjs`，都被 git 忽略。

## 下一步
- 执行 M0-T06（core：原生领域模型与存储，M0 子集，DESIGN §5、§7），依赖 M0-T01 已满足。
  - 定义 Story、TimelineNode（`parentId` 加不可修改的 raw）、StateDiff、MemoryEvent 类型。
  - better-sqlite3 尚未安装；ADR-0001 允许在安装失败时改用 `node:sqlite`。建表前要确认 FTS5 可用（`CREATE VIRTUAL TABLE ... USING fts5`），Node 内置 SQLite 的 FTS5 情况需要用最小 spike 验证；不通过就写 ADR 换方案。
  - 表：nodes、state_diffs、node_text（FTS5）；schema 版本号与迁移机制。
  - 存储层不提供修改 `raw` 的接口（不变量 I4），写测试确保。
  - 验收：能建库、插入节点和 diff、按根到节点的路径读取、FTS5 查询可用。

## 注意事项
- 私有数据只在给自己看的报告里引用；提交进仓库的内容只能有统计数字。
- `eval-private/raw/chats/` 里的单个 jsonl 可能有几十 MB，必须流式处理。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
