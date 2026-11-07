# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：7
- 任务：M0-T06 core 原生领域模型与存储（M0 子集）
- 结果：完成。新增 `packages/core/src/timeline.ts`（Story、TimelineNode、StateDiff、NewStateDiff、MemoryEvent、NodeTextMatch）、`packages/core/src/store/json-value.ts`、`store/migrations.ts`、`store/story-store.ts`；`packages/core/test/store.test.ts` 13 个测试。`pnpm check` 通过（59 个测试）。

## 当前状态
- 门禁：`pnpm check` 通过（invariants → typecheck → lint → test）。
- 依赖：`better-sqlite3@13.0.3` 装在 `packages/core`，`@types/better-sqlite3` 是 devDependency。pnpm 提示忽略 better-sqlite3 的构建脚本，但预编译二进制可以直接加载；SQLite 版本 3.53.4，`ENABLE_FTS5=1`。ADR-0001 的 `node:sqlite` 备用方案没有启用。
- 导出（`@dramaticer/core` 入口）：`StoryStore`、`LATEST_SCHEMA_VERSION`、类型 `Story`、`TimelineNode`、`TimelineRole`、`StateDiff`、`StateDiffOp`、`NewStateDiff`、`MemoryEvent`、`NodeTextMatch`，以及输入类型 `CreateStoryInput`、`AppendNodeInput`、`SearchNodeTextOptions`。
- `TimelineRole` 为 `"system" | "user" | "assistant"`。`TimelineNode`：`id`、`storyId`、`parentId`（根为 null）、`role`、`raw`（readonly）、`createdAt`。节点之间的顺序就是插入顺序（SQLite 的 `row_id`），没有单独的兄弟序号字段。
- `StateDiff`：`id`、`storyId`、`nodeId`、`ordinal`、`path`（非空字符串数组）、`op`（`"set"` 或 `"delete"`）、`value`（delete 时为 null）、`reason`、`source`、`createdAt`。
- `MemoryEvent` 只有类型，没有建表：`id`、`storyId`、`nodeId`、`summary`、`storyTime`、`participants`、`location`、`importance`、`knowers`、`createdAt`。
- `StoryStore` API：
  - `StoryStore.open(path)`（`":memory:"` 可用）、`close()`、`getSchemaVersion()`、`getLatestSchemaVersion()`。
  - `createStory({ id?, title, createdAt? })`：`id` 默认 `randomUUID()`；重复 id 抛错。
  - `appendNode({ id?, storyId, parentId, role, raw, createdAt? })`：父节点必须存在且属于同一故事，跨故事和悬空父节点都抛中文错误；重复 id 抛错。
  - `getStory(id)`、`getNode(id)` 返回 null 表示不存在。
  - `getPathToNode(nodeId)`：返回从根到该节点的数组，顺序为根在前、节点在后；节点不存在或链条断裂时抛错。
  - `appendStateDiff(diff)`、`appendStateDiffs(diffs)`：一批 diff 先全部校验再在一个事务里写入；任意一条非法则整批不写。`ordinal` 按节点自动从当前最大值加一。
  - `getStateDiffs(nodeId)`：该节点自己的 diff，按 ordinal。
  - `getStateDiffsAlongPath(nodeId)`：用递归 CTE 一次读出整条路径上的 diff，顺序是根楼层在前、同楼层按 ordinal。
  - `searchNodeText(query, { storyId?, limit? })`：返回 `{ nodeId, storyId, score, snippet }`，`score` 是 bm25（升序，越小越相关）；默认 20 条，上限 1000。
- schema（迁移版本 1，`PRAGMA user_version`）：
  - `stories`、`nodes`、`state_diffs` 都是 STRICT 表；`nodes.story_id`、`nodes.parent_id`、`state_diffs.node_id` 有外键。
  - `node_text` 是 FTS5 虚拟表（`tokenize = 'trigram'`），由 `nodes_fts_insert`、`nodes_fts_delete` 触发器同步。
  - `nodes_immutable` 触发器拒绝任何 `UPDATE nodes`；`nodes_parent_same_story` 和 `state_diffs_story_matches_node` 在数据库层兜底故事归属。
- 校验规则：
  - `raw` 只接受字符串，写入后不能修改（类型 readonly，加数据库触发器，测试里用第二个连接执行 UPDATE 确认抛 `原文不可修改`）。
  - 状态值必须是合法 JSON：有限数字、纯对象、数组、字符串、布尔、null；`undefined`、NaN、Infinity、类实例、循环引用都会抛错。
  - `delete` 不允许携带 value；空 `path`、空字符串路径段、空 `source` 都会抛错。
- FTS5 行为：trigram 至少需要 3 个字符，短查询直接抛错；查询按 FTS5 字符串字面量转义（内部双引号写成两个），所以查询里的引号按字面匹配。中文“古老的山门”和英文“dragon”都有测试覆盖。
- 测试临时目录：`packages/core/test/.tmp-store-*`（已被 `.gitignore` 的 `packages/*/test/.tmp-*/` 覆盖）。Windows 上文件句柄会锁目录，测试用 `onTestFinished` 先关库再删目录。
- 工具链不变：tab 缩进，`scripts/**`、`eval-private/**` 被 lint 忽略；`packages/core/src` 里不能出现 ST 概念（invariant I1）。

## 下一步
- 执行 M0-T07（st-compat：ST 对话导入为原生楼层树），依赖 M0-T03、M0-T06 都已满足。
  - 用 `packages/st-compat/src/chat-jsonl.ts` 的 `parseChatJsonlFile(path)` 流式读取；条目是 `{ kind: "header" }` 或 `{ kind: "message" }`，消息字段为 `index`、`name`、`isUser`、`isSystem`、`text`（当前 swipe 的 `mes`）、`swipes`（每项有 `index`、`text`、`variables`）、`swipeId`、`variables`（当前 swipe 的 MVU 快照）。
  - 角色映射：`isSystem` → `"system"`，`isUser` → `"user"`，其余 → `"assistant"`。当前 swipe 形成主路径；其他 swipe 作为同一父节点的兄弟节点（插入顺序就是兄弟顺序）。
  - 对相邻楼层的 `variables` 做 diff，生成 `StateDiff`。建议路径用 JSON 对象的键序列，叶子变化生成 `op:"set"`，消失的键生成 `op:"delete"`；数组按下标递归；值整体替换或递归到标量需要在实现里定一种并写测试。用 `appendStateDiffs` 批量写入。
  - 验收要点：合成测试里“快照 → diff → 沿路径累加”能还原每一层的变量快照；测试数据用 `packages/st-compat/test/fixtures/` 下的合成数据。
  - 导入后的 id 建议用确定性的字符串（例如 `<chat名>:<消息序号>:<swipe序号>`），便于测试和重复导入检测。`StateDiff.source` 可以写 `"import"`。
  - 需要在 st-compat 里新增模块并从 `packages/st-compat/src/index.ts` 导出；st-compat 可以依赖 core，反向不行。
- 硬性提醒：私有数据只用于自己看的报告；提交进仓库的内容只能有统计数字。`eval-private/raw/chats/` 的单文件可能几十 MB，必须流式处理，不要整个读进内存。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- HUMAN-01 已完成；HUMAN-02（硅基流动 key）仍然阻塞 M2 的 embedding；HUMAN-04 只影响 M1-T01 的 Gemini 原生验证。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的文件。
- 提交前跑 `pnpm check`；新增依赖要登记到 `docs/dev/DEPENDENCIES.md`（本次新增依赖已登记）。
