# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `canon/06`）。**M-C 原著阶段全部完成**：`canon` 01–06 已交付。
- 迁移 81：`canon_event_edits`（STRICT，按格 `title|summary|digest|voices|passage`，`source` 为 player/rollback，BEFORE UPDATE 触发器拒绝改行）；底层事件、话术、章节原文表不动。
- `core/src/canon/edits.ts`：`readEffectiveCanonEvent`、`readEffectiveCanonEvents`、`listEffectiveCanonTimeline` 沿楼层路径取各格最新一版，分支与删楼自然隔离；整条时间线批量读时路径、修改、章原文各查一次。
- 窗口、走向页、场记提示词全部用有效内容；撤销追加一条内容相同的新记录，第一版之前回到抽取结果。
- 接口：`GET .../canon/page`、`POST .../canon/events/:eventId/edit`、`POST .../canon/events/:eventId/rollback`；未绑定原著时 page 返回 `{ bound: null }`。
- 界面：记忆页「原著」分页（桌面两栏、820px 以下上下排列），事件轨道标已演/当前/未来/关键转折，按格就地编辑、版本列表、撤销、从这里开始；停靠栏原著条目跳到 `?tab=canon&event=<id>` 并选中。
- 验证：`pnpm check` 通过（296 个测试文件）；`v5-canon-page` 桌面/手机 6 条、`v5-canon-window`、`v5-canon-start`、`v5-canon`、`v5-notebook`、`v4-dock` 全部通过；`.walk/walk12.spec.ts` 桌面/手机截图已看。

## 下一步
1. M-D 呈现：`card-ui/01`（楼层渲染器扩展点与沙箱），然后 `image-v2/01`（分格视觉档案、服装与标签库）。
2. 设计与验收依据：`docs/proposals/v5.md` 对应章节与 `.scratch/<功能>/spec.md`。

## 眼下要注意
- 迁移版本现在是 81；`assistant-store.test.ts` 的断言已同步。
- server 与 e2e 读 core 的 `dist`：改了 core 先 `pnpm run build` 再跑 e2e。
- 上下文包来源 kind 的校验在 `context/pack-format.ts`；新增来源类型必须同时改这里和 `Dock.tsx` 的 `ContextSource`。
- e2e 手机端停靠栏是遮罩层，点完上下文要按 Escape 收起再操作输入台。
- `.walk/` 不入库；走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts .walk/walk12.spec.ts`，截图在 `.devloop/scratch/walk/`。
