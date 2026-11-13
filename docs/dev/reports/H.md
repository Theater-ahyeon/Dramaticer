# H 报告：应用内助手

- 日期：2026-11-13
- 任务：H-T99 H 验收（覆盖 H-T01 至 H-T09）
- 门禁：`pnpm check` 通过（249 个测试文件通过、5 个 live 文件跳过；2169 个测试通过、5 个跳过）
- 不变量：`node scripts/check-invariants.mjs` 通过（I1、I2、I3、I10、I15 的机器检查）
- web 目标 e2e：`e2e/assistant.spec.ts` 通过 10 条（desktop 5 条、mobile 5 条）
- 真实渠道：`.env` 的 `main` 渠道，助手默认模型按 `roles.writer` 解析为 `main-fallback`（`auto/deepseek-v4.1-flash`）；只访问该渠道，未访问本地 ST，未修改 `.env`
- 数据库 schema：v46

## 一、验收结论

| 任务 | 结果 | 证据 |
|---|---|---|
| H-T01 会话存储与类型化接口 | 通过 | 迁移 v44 的四张表与 trigram 索引；`packages/core/test/assistant-store.test.ts`（8 个）；`packages/server/test/assistant.test.ts`（11 个）；`packages/web/test/assistant-api.test.ts`（4 个） |
| H-T02 运行时、隔离与只读工具 | 通过 | `packages/core/src/assistant/runtime.ts`；`packages/core/test/assistant-runtime.test.ts`（7 个）；并发 409、取消、工具上限、超时与重启后的 `interrupted` 均有用例 |
| H-T03 三级权限与待确认动作 | 通过 | 迁移 v45；`packages/core/test/assistant-actions.test.ts`（10 个）覆盖权限矩阵、载荷校验、去重、批准与拒绝、会话删除保护 |
| H-T04 排障与使用指南 | 通过 | `packages/core/test/assistant-skills.test.ts`（5 个）；`packages/server/test/assistant-skills.test.ts`（7 个）覆盖技能清单、未注册技能 400、文档目录缺失启动失败、`docs_search` |
| H-T05 台账修订与参谋 | 通过 | `packages/core/test/assistant-proposals.test.ts`（8 个）；待批准卡与 `director_plan` 动作不写楼层 |
| H-T06 资料员、卡片工坊与设置向导 | 通过 | `packages/core/test/assistant-setup.test.ts`（8 个）；`web_search` 只在显式开启时注册；渠道读取不含密钥值 |
| H-T07 抽屉界面与运行状态 | 通过 | web 单元测试 15 个；e2e 覆盖打开与关闭后继续运行、路由切换与刷新后恢复、`status` 与 `after` 续读、改名搜索删除取消 |
| H-T08 上下文压缩与用量环 | 通过 | `assistant-context.test.ts`（9 个）、`assistant-context-usage.test.ts`（3 个）；真实渠道手动压缩见第四节 |
| H-T09 变更审阅面板 | 通过 | `packages/web/test/assistant-review.test.ts`（4 个）；e2e 的审阅用例覆盖 8 项待确认、密钥不渲染、批准失败保留原因、数量同步 |

## 二、技能与工具

`GET /api/assistant/skills` 返回 7 个已注册技能；未注册技能在创建会话或修改会话时返回 400 并指出 `skill`。

| 技能 | 工具白名单 |
|---|---|
| `troubleshoot` 排障 | `explain_node`、`run_log_read`、`ledger_read`、`director_read`、`memory_search`、`state_get` |
| `guide` 使用指南 | `docs_search`、`settings_read`、`template_read`、`plugin_list` |
| `ledger_revision` 台账修订 | `ledger_read`、`state_get`、`memory_search`、`propose_ledger_change` |
| `strategy` 参谋 | `director_read`、`ledger_read`、`memory_search`、`state_get`、`summarize_recent`、`propose_director_plan` |
| `research` 资料员 | `web_search`（仅显式开启）、`lore_lookup`、`settings_read`、`propose_lore_entries` |
| `card_workshop` 卡片工坊 | `card_read`、`template_read`、`lore_lookup`、`settings_read`、`propose_card_change`、`propose_lore_entries` |
| `setup_wizard` 设置向导 | `settings_read`、`channels_read`、`plugin_list`、`propose_channels_change`、`propose_settings_change` |

白名单不含草稿、提交、导演手记、正文写入、台账直接写入与生图工具；`assistant-runtime.test.ts` 直接断言工具集只有只读工具。工具名与本次运行实际注册的工具不一致时，运行在切换状态之前抛错；`docs_search`、提案工具与 `createAssistantSetupTools` 的工具由 server 以 `extraTools` 注入。

## 三、权限矩阵

| 会话权限 | 直接执行 | 生成待确认 |
|---|---|---|
| `read_only` | `read` | 无；`propose` 与 `side_effect` 返回 `permission_denied` 并写事件 |
| `confirm` | `read`、`control` | `propose` 与 `side_effect` |
| `auto` | `read`、`control`、`channels` 动作 | 其余六类动作 |

台账修改不在动作表里：`propose_ledger_change` 永远只生成待批准的台账变更卡，任何权限级别都不能自动批准；批准入口复用 `approveLedgerChangeCard`，写入事实来源为 `player`。

## 四、真实渠道实测

三条流程使用同一份合成故事（3 个楼层：system、user、assistant；一条 `relation.甲.乙.affectionInner = 冷淡` 的台账事实）。原始数据在 `eval-private/reports/H-live.json`。

| 流程 | 权限 | 耗时 | 工具调用 | prompt / completion / reasoning token | 结果 |
|---|---|---|---|---|---|
| 排障问答 | `read_only` | 11,207 毫秒 | 6 次（`explain_node`、`run_log_read` ×2、`director_read`、`state_get`、`ledger_read`） | 1,131 / 1,167 / 234 | `completed`；回答包含楼层 id 与“没有记录” |
| 台账修订 | `confirm` | 9,919 毫秒 | 3 次（`ledger_read`、`state_get`、`propose_ledger_change`） | 1,026 / 790 / 191 | 生成 1 张来源 `assistant` 的待批准卡；批准后 `冷淡` → `亲近`，事实来源 `player`，待批准数 0 |

台账修订批准前后：楼层数 3 → 3，head 不变，三楼的原文逐字节不变；批准没有生成楼层或新的运行记录。

用量环与手动压缩（`guide` 会话，40 条合成消息，预算 48,000）：

| 指标 | 压缩前 | 压缩后 |
|---|---|---|
| 上下文用量 | 1,122 token | 613 token |
| 百分比 | 2.34% | 1.28% |
| 消息条数 | 40 | 40 |

压缩省略 30 条消息，摘要 239 字符，耗时 3,064 毫秒；被省略的消息行保留，界面仍显示完整消息流。排障会话的用量环读数为 1,503 / 48,000（3.13%），与详情接口的 `context` 一致。

## 五、隔离与不变量复核

| 不变量 | 结论 | 证据 |
|---|---|---|
| I4 楼层原文不可修改 | 通过 | `packages/core/src/assistant` 与 `packages/server/src/assistant.ts` 不调用 `appendNode`、`updateNode`、`setHead`、`appendStateDiffs`、`deleteStateDiffs`；真实渠道批准台账卡后楼层数、head 与原文都不变 |
| I8 显示、prompt、记忆视图从原文派生 | 通过 | 助手只写 `assistant_*` 表；`runAssistantTurn` 不组装剧情上下文、不读 `history` 槽位；剧情渲染与记忆代码没有引用助手消息 |
| I11 间隙优先 | 通过 | 助手运行只由玩家在抽屉里发起的消息触发；剧情回合的 `turns.ts`、`runtime.ts` 不引用 `runAssistantTurn` 或助手表；正剧检索与记忆不使用助手消息 |
| I12 台账唯一事实来源 | 通过 | 提案工具只写待批准卡；批准调用 `approveLedgerChangeCard`，写入的 diff 带 `source: player`；批准时重新校验卡片内容，失败保留 `pending` |
| I13 尊重模型能动性 | 通过 | 助手提示词没有“每轮必须调用工具/必须输出固定结构”的要求；工具按技能白名单提供，模型可以只回答正文；`assistant-runtime` 的工具上限只用于防失控 |
| I14 本地 ST 额度 | 通过 | 真实渠道流程只访问 `.env` 的 `main` 渠道；代码中没有指向本地 ST 端点或目录的调用；本次没有向本地 ST 发起任何生成请求 |
| I15 兼容只是入口 | 通过 | `packages/core` 没有对其他工作区包的 import；`check-invariants.mjs` 通过；助手类型放在 `packages/protocol`，web 只做类型导入 |

## 六、测试覆盖

助手相关单元测试文件 15 个，共 95 个用例：

| 包 | 文件 | 用例 |
|---|---|---|
| core | `assistant-store` | 8 |
| core | `assistant-runtime` | 7 |
| core | `assistant-actions` | 10 |
| core | `assistant-skills` | 5 |
| core | `assistant-proposals` | 8 |
| core | `assistant-setup` | 8 |
| core | `assistant-context` | 9 |
| server | `assistant` | 11 |
| server | `assistant-skills` | 7 |
| web | `assistant-api` | 4 |
| web | `assistant-stream` | 5 |
| web | `assistant-context-usage` | 3 |
| web | `assistant-conversation-list` | 3 |
| web | `assistant-permissions` | 3 |
| web | `assistant-review` | 4 |

e2e 的 10 条用例覆盖：打开、关闭后继续运行、路由切换与刷新后恢复；刷新后从 `status` 与 `after` 续读；用量环与手动压缩；改名、搜索、删除与取消；待确认面板审阅与数量同步。
