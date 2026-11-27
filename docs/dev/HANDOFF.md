# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `canon/05`）。原著窗口每轮给「当前」一件；推进时给接下来 1–3 件，待推进件数优先。
- 迁移 80：`story_canon.window_mode`（默认 `summary_voice`）、`pending_advance`、`canon_cursors.from_here`。
- `core/src/canon/cursor.ts`：沿当前路径找最近游标，删楼/切分支自然回退到开局事件；`eventOrdinal` 是主时间线序号。`window.ts` 负责窗口、话术/原文、死人剔除与缺席标注、玩家角色资料。
- 场记提示词附当前原著事件与布尔 `canonCompleted`，不要求时刻格式；偏离或没演完时不前进。「从这里开始」第一楼先消费待演出游标，不直接跳下一件。
- 上下文 `director` 槽位由 `createCanonWindowSlotProvider` 提供，Trace 来源 `{ kind: "canon", bookId, eventId, chapterOrdinal }`；上下文包校验也认这个 kind。
- 默认模板新增 `persona` 与 `director` 两段；`createStandardChatSlots` 接收 `persona` 与 `store`，扮演原著人物时 persona 按游标章节动态解锁。`world_index` 与 `pages` 在开关关闭时按游标章节重新切片。
- 接口：`PATCH /api/stories/:id/canon/settings`、`POST .../canon/advance`、`POST .../canon/cursor`。回合落定后清空 `pendingAdvance`。
- 界面：设置「写作」页有原著窗口面板（全书开关、窗口内容）；故事页推进菜单有「推进到下一件 / 2 / 3 件」；输入台「⋯」里有「从这里开始」。
- 验证：`pnpm check` 通过（300 个测试文件）；`v5-canon-window` 桌面/手机 4 条、`v5-canon`、`v5-canon-start`、`v5-direction`、`v5-inspector`、`v4-dock` 全部通过；`.walk/walk11.spec.ts` 桌面/手机截图已看。

## 下一步
1. `canon/06`：原著页与事件就地编辑，已演 / 当前 / 未来轨道可视化，按格版本化。
2. 若继续窗口：原著页的「从这里开始」与事件编辑共用 `canon_cursors` 与 `startCanonFromHere`。

## 眼下要注意
- 迁移版本现在是 80，`assistant-store.test.ts` 的断言已同步。
- server 与 e2e 读 core 的 `dist`：改了 core 先 `pnpm run build` 再跑 e2e。
- 上下文包来源 kind 的校验在 `context/pack-format.ts`；新增来源类型必须同时改这里和 `Dock.tsx` 的 `ContextSource`。
- e2e 手机端停靠栏是遮罩层，点完上下文要按 Escape 收起再操作输入台。
- `.walk/` 不入库；走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts`，截图在 `.devloop/scratch/walk/`。
