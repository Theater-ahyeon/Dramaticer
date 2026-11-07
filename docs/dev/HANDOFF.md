# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：4
- 任务：M0-T03 st-compat 聊天 jsonl 解析
- 结果：完成。新增 `packages/st-compat/src/chat-jsonl.ts`（流式逐行解析）、`packages/st-compat/src/json.ts`（JSON 值类型与对象判定）、合成测试数据与 10 个测试；真实快照 3 个对话共 1222 条消息全部解析，头部、swipe、变量、推理字段都正确。

## 当前状态
- 门禁：`pnpm check` 通过。顺序是 invariants → typecheck（`tsc -b`）→ lint（`biome check .`）→ test（`vitest run`），当前 12 个测试。
- 聊天解析 API：
  - `parseChatJsonl(chunks)`：接受 `AsyncIterable<string> | Iterable<string>`，逐行抛出 `StChatEntry`（`kind: "header"` 一条，之后 `kind: "message"` 若干）。
  - `parseChatJsonlFile(path)`：`createReadStream(..., { encoding: "utf8" })` 包装，错误会再包一层文件路径。
  - `splitChatLines(chunks)` 单独导出，负责跨块切行、CRLF 和末尾无换行符。
  - 单行长度没有上限，整个文件不会被一次性读入内存。
- 类型（都在 `@dramaticer/st-compat` 的入口导出）：
  - `StChatHeader`：`characterName`、`userName`、`chatMetadata`（原样）、`raw`（原始对象）。
  - `StChatMessage`：`index`（从 0 开始，不含头部）、`name`、`isUser`、`isSystem`、`sendDate`（string | number | null）、`text`（即 `mes`，可能与当前 swipe 不同，因为消息被编辑过）、`swipes`（`StSwipe[]`：`index`、`text`、`info`=swipe_info[i]、`variables`=variables[i]）、`swipeId`、`reasoning`（`extra.reasoning`）、`variables`（当前 swipe 的 MVU 变量快照）、`raw`（原始对象）。
  - `raw` 保存**整条原始记录**，未识别字段自然保留。`mes`、`swipes` 等大字段是同一个解析对象的引用，不会复制字符串。
  - 缺失字段的默认值：`name`/`text` 为空串，`isUser`/`isSystem` 为 false，`sendDate` 为 null，`swipes` 为空数组，`variables` 为当前索引取到的值或 null。
  - 变量数组与 `swipes` 平行；`variables[index]` 就是该 swipe 的 MVU 快照。
- 测试：`packages/st-compat/test/chat-jsonl.test.ts` 加 `test/fixtures/chat-sample.jsonl`（合成的 4 行，含中文、swipe、推理、未知字段、数字时间戳、system 消息）。覆盖任意块切分一致、CRLF、150K 字符单行、末尾无换行、非法 JSON 行号、非对象行、空输入。
- 真实数据观测（只给统计）：3 个对话分别 579/412/231 条消息，其中 291/209/115 条带 swipes，system 消息只在「欲望世界」里出现 55 条；`mes` 与当前 swipe 不同的消息有 68/5/54 条；最长正文约 9.5 万字符；解析耗时 129/57/243 毫秒；进程常驻内存峰值约 187 MB（35 MB 文件）。
- 工具链不变：tab 缩进，`scripts/**`、`eval-private/**` 被 lint 忽略；新增文件已经过 biome 格式化。
- 顺手产物：`eval-private/scratch/parse-chats.mjs` 是本次真实数据核对脚本，已被 git 忽略，可复用或删除。

## 下一步
- 执行 M0-T04（st-compat：角色卡解析）
  - PNG 的 `tEXt` 块里 `chara` 或 `ccv3` 是 base64 编码的 JSON；JSON 卡直接读文件。依赖 `png-chunks-extract` 和 `png-chunk-text` 已经在根目录 devDependencies 里（ADR-0003）。
  - 兼容 V2 和 V3，提取内嵌 `character_book`，`extensions` 原样保留；合成 PNG 在测试里用代码生成最小的 PNG 更稳妥。
  - 可以复用 `src/json.ts` 的 `JsonValue`、`JsonObject`、`isJsonObject`。

## 注意事项
- 私有数据只在给自己看的报告里引用；提交进仓库的内容只能有统计数字。
- `eval-private/raw/chats/` 里的单个 jsonl 可能有几十 MB，必须流式处理，不要整个读进上下文。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
