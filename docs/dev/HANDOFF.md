# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `direction-v5/01`）。
- 剧情走向一页：新增 core `direction/`（`readDirectionView` 只读派生两栏，`applyDirectionEdit` 写回原存储），server `GET/POST /api/stories/:id/direction[/edit]`，web `Direction.tsx`。`/stories/:id/outline` 现在渲染剧情走向页，导航标签「走向」，停靠栏导演页复用同一套紧凑视图。
- 旧故事没有迁移步骤：大纲、里程碑、主线方向、本场目标、场记笔记、剧情线都从原表派生。新增方向写成 `line` 的玩家修改并自动锁定；场记笔记的改写与收下用 `player_edits` 的 `note` 种类。
- 验证：`pnpm check` 通过；`v5-direction`（编辑与锁定，页面与停靠栏）、`v4-outline`、`v4-dock`、`v4-polish`、`director` 的 e2e 通过；走查 `walk6` 截图已看（`v5-01-direction-{d,m}.png`、`v5-01-dock-dir-{d,m}.png`）。
- 删除了旧 `.bp/.premise/.vol/.ms/.idea/.sug` 样式与停靠栏的置顶、静音、导演安排列表；楼层批注里的撤回仍在。

## 下一步
1. `direction-v5/02`：推进方向菜单与删减（删八种动作与 `mechanisms` 引擎，做推进菜单，保留章末清点）。

## 眼下要注意
- 走向页的行 id 是写入键（`premise:*`、`volume:<id>`、`milestone:<id>`、`line:<id>`、`scene`、`note:<id>`）；改规则要同步 `assertDirectionEdit` 与 e2e。
- `02` 的新逻辑继续走 `POST /api/stories/:id/direction/edit`，不要塞回 `/director/line`、`/blueprint/edit`；旧接口保留给后台与尚未迁移的模块。
- e2e 的 `helpers.sendTurn` 走故事页；调用前页面要停在 `/play`。
- 全量 e2e 后段桌面端 director / ledger / openings 会因后台队列积压假失败，单独重跑确认。
- server 读 core 的 `dist`：改了 core 导出后先构建 core；单跑 e2e 前先 `pnpm build`。
