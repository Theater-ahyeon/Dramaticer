# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：5
- 任务：M0-T04 st-compat 角色卡解析
- 结果：完成。新增 `packages/st-compat/src/character-card.ts`（JSON 与 PNG 卡解析）、`packages/st-compat/src/png-modules.d.ts`（两个 PNG 库的类型声明）；测试辅助 `test/png-fixture.ts` 在测试里生成合法的 1x1 PNG；13 个测试。真实快照的 3 张卡全部解析通过（最大的 27 MB，13 MB base64 文本块，约 1.4 秒）。

## 当前状态
- 门禁：`pnpm check` 通过。顺序是 invariants → typecheck（`tsc -b`）→ lint（`biome check .`）→ test（`vitest run`），当前 25 个测试。
- 角色卡 API（`@dramaticer/st-compat` 入口导出）：
  - `parseCharacterCardJson(text)`：直接解析 JSON 卡文本，自动去前导 BOM。
  - `parseCharacterCardPng(bytes)`：读 PNG 的 `tEXt` 块，**`ccv3` 优先，回退 `chara`**，base64 解码后交给 JSON 解析；同名字段取第一个出现的块。
  - `parseCharacterCardFile(path)`：按文件头判断 PNG，其余按 UTF-8 JSON；错误信息带文件路径。
  - `isPngData(bytes)`：PNG 签名判断。
- 类型：
  - `StCharacterCard`：`spec`（`chara_card_v1`/`v2`/`v3`）、`specVersion`（缺失为 null）、`name`、`description`、`personality`、`scenario`、`firstMessage`、`messageExample`、`creatorNotes`、`systemPrompt`、`postHistoryInstructions`、`alternateGreetings`、`groupOnlyGreetings`、`nickname`（缺失为 null）、`tags`、`creator`、`characterVersion`、`characterBook`（`JsonObject | null`，未经解析）、`extensions`（`JsonObject`）、`raw`（完整卡片对象）。
- 版本判定：`spec` 为 `chara_card_v2`/`chara_card_v3` 时读 `data` 节点；没有 `spec` 但有 `data` 时按 V2 读；两者都没有时按 V1 读根节点。V1 的备注从根节点 `creatorcomment` 取；V1 的 `characterBook` 为 null，`extensions` 为 `{}`。
- 严格读取：已知字段缺失或为 null 时取空串、空数组、null；类型不对（例如 `name` 是数字、`tags` 含非字符串）直接抛错，不做类型转换。未知 `spec`、V2/V3 缺 `data`、JSON 非法、PNG 里没有角色卡文本块都会抛错（错误带 `cause`）。
- `characterBook` 和 `extensions` 与 `raw` 共用同一个对象引用，没有复制字符串。
- 真实数据观测（只给统计）：3 张卡都同时有 `chara`（V2）和 `ccv3`（V3）两个块，内容结构相同；内嵌世界书条目数 92/60/176；`extensions` 键数 6/6/7；解析耗时 39/34/1422 毫秒。世界书条目的键为 `id, keys, secondary_keys, comment, content, constant, selective, insertion_order, enabled, position, use_regex, extensions`；世界书对象本身是 `entries, name, extensions`。
- PNG 库 `png-chunks-extract`、`png-chunk-text` 没有自带类型，用 `src/png-modules.d.ts` 声明；代码里用命名导入（`decode`/`encode`），默认导入在两边行为不同。两个库仍是根目录开发依赖（ADR-0003），workspace 内运行时能解析到。
- 测试：`packages/st-compat/test/character-card.test.ts` 覆盖 V2、V3、V1、字段缺失、BOM、非法 JSON、未知版本、缺 `data`、字段类型错误、PNG 的 `chara`、`ccv3` 优先、无卡文本块、非 PNG、文件自动识别、错误信息带路径。`test/png-fixture.ts` 用 `node:zlib` 的 `crc32` 和 `deflateSync` 组装合法 PNG，`tEXt` 内容用 `png-chunk-text` 的 `encode` 生成。测试临时目录是 `packages/st-compat/test/.tmp-card-*`，已加入 `.gitignore`。
- 工具链不变：tab 缩进，`scripts/**`、`eval-private/**` 被 lint 忽略。
- 顺手产物：`eval-private/scratch/inspect-cards.mjs`（看块的类型与字段名）、`eval-private/scratch/parse-cards.mjs`（用编译后的解析器跑真实卡），都被 git 忽略。

## 下一步
- 执行 M0-T05（st-compat：世界书与预设解析）
  - 世界书：`eval-private/raw/worlds/` 是 3 个世界书 JSON；内嵌世界书用 `parseCharacterCardFile(...).characterBook` 取。条目字段已在上面的观测里列出，还有 `use_regex`、`position`、`extensions`。
  - 预设：`eval-private/raw/presets/` 有 58 个 OpenAI 预设；重点是 `prompts`、`prompt_order`、采样参数、`assistant_prefill`、`extensions.regex_scripts`，未知字段原样保留。
  - 验收要求「解析之后再序列化，和原文件在结构上等价」，因此类型要保留原始结构（可以用 `raw` 加类型化视图，序列化直接写 `raw`）。
  - 可以复用 `src/json.ts` 的 `JsonObject`/`isJsonObject`，以及本次的严格读取风格。

## 注意事项
- 私有数据只在给自己看的报告里引用；提交进仓库的内容只能有统计数字。
- `eval-private/raw/chats/` 里的单个 jsonl 可能有几十 MB，必须流式处理，不要整个读进上下文。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
