# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：8
- 任务：M0-T07 st-compat：ST 对话导入为原生楼层树
- 结果：完成。新增 `packages/st-compat/src/chat-import.ts` 与 7 个测试。`pnpm check` 通过（66 个测试）。真实快照 3 个对话、1222 层主路径、6865 条 diff，沿路径累加与原始 MVU 快照逐层比对零差异。

## 当前状态
- 门禁：`pnpm check` 通过（invariants → typecheck → lint → test）。
- st-compat 新增导出：
  - `importChatToStore(store, entries, options)`：接收 `AsyncIterable<StChatEntry> | Iterable<StChatEntry>`，写入 `StoryStore`，返回 `{ story, mainPathNodeIds, nodeCount, stateDiffCount }`。
  - `importChatFileToStore(store, path, options)`：用 `parseChatJsonlFile` 流式读取后再导入。
  - `ImportChatOptions`：`storyId`（必填）、`title?`（缺省用头部 `character_name`，再缺省用 `storyId`）、`idPrefix?`（默认 `storyId`）、`source?`（默认 `"import"`）。
- 导入规则：
  - 楼层 id 为 `<idPrefix>:m<消息序号>:s<swipe序号>`；当前 swipe 是主路径节点，其他 swipe 是同一父节点的兄弟节点（父节点=上一条消息的主路径节点）。主节点先插入，再按 swipe 下标插入兄弟节点。
  - 主节点正文用 `message.text`（编辑后的 `mes`）；兄弟节点正文用对应 swipe 的 `text`。
  - 角色：`isSystem` → `system`，`isUser` → `user`，其余 → `assistant`。
  - `createdAt` 来自 `send_date`：数字按 Unix 秒、字符串按可解析日期转成 ISO；缺失或非法时交给 store 取当前时间。
  - 每层 diff 的基准是父楼层沿主路径的状态；兄弟 swipe 的 diff 基准同样是父楼层状态，因此任意分支单独累加都能还原该 swipe 的快照。
- diff 语义（ADR-0005）：
  - MVU 快照根必须是 JSON 对象或 `null`；`null` 表示该层没有更新，不产生 diff。
  - 对象逐键递归；消失的键写 `op:"delete"`；新出现的对象递归到叶子，空对象写 `op:"set"` 的 `{}`。
  - 数组整体比较，变化时在数组路径写 `op:"set"`，不做下标级 diff。
  - 根不是对象时导入直接抛错。导入不是事务性的：中途失败会留下已写入的部分，storyId 已占用，重试前需要删除该 story。
- 测试：`packages/st-compat/test/chat-import.test.ts` 使用 `test/fixtures/chat-import.jsonl`，覆盖主路径、兄弟节点、编辑后的正文、system 角色、显式标题/前缀、快照往返、根非对象、缺头部。真实数据验证只用临时脚本和内存库，脚本已删除，仓库里没有原文。
- core 仍然提供 `StoryStore`：`open/close`、`createStory`、`appendNode`、`getStory`、`getNode`、`getPathToNode`、`appendStateDiff(s)`、`getStateDiffs`、`getStateDiffsAlongPath`、`searchNodeText`。schema 版本 1；`nodes` 禁止 UPDATE；FTS5 `node_text` 使用 trigram，短于 3 个字符的查询抛错。
- 依赖与工具链没有变化：主 agent 用 omp，TypeScript strict + ESM + Node ≥ 22.19，vitest、biome、better-sqlite3@13.0.3（SQLite 3.53.4，FTS5 可用）。`packages/core/src` 不出现 ST 概念（I1）。

## 下一步
- 执行 M0-T08（体检报告），依赖 M0-T02、M0-T05、M0-T07 都已满足。
  - CLI：`pnpm --filter @dramaticer/st-compat report`。需要新增 bin 脚本和 package script；报告分两份，私有版写 `eval-private/reports/health.md`，只含统计数字的版本写 `docs/dev/reports/M0-health.md`。
  - 数据源：`eval-private/raw/chats/`、`cards/`、`worlds/`、`presets/`，路径以 `manifest.json` 为准。单文件几十 MB，必须流式处理。
  - 统计项：楼层数；正文/变量/其他字段字节占比；可替换的 token 估算（中文约 1.5 字符/token）；原生 diff 存储与 ST 快照存储的体积比；卡和世界书的实体数量；相邻 AI 回复字符 n-gram Jaccard 的重复度曲线（按楼层窗口，标出持续上升的起点）；预设宏频率、正则作用范围和开关分布。
  - 可复用：`parseChatJsonlFile`、`importChatFileToStore`、`parseCharacterCardFile`、`parseWorldInfoFile`、`parsePresetFile`。
- 如果 M0-T08 明显超出一个会话，先在 TASKS.md 拆成 `.a`、`.b` 子任务，只做第一个。
- 硬性提醒：私有数据只用于 `eval-private/reports/`；提交进仓库的 `docs/dev/reports/M0-health.md` 只能有统计数字。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- HUMAN-01 已完成；HUMAN-02（硅基流动 key）仍然阻塞 M2 的 embedding；HUMAN-04 只影响 M1-T01 的 Gemini 原生验证。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`。
