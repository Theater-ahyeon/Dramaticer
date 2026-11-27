# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `direction-v5/02`）。M-B 记忆阶段完成，下一阶段是 M-C 原著。
- 推进菜单：`DirectionView.pushDirections` 从走向页当场派生 2–3 个方向（最老未收线 + 未完成关键事件/主线/本场目标 + 第二条未收线）；故事页推进 ▾ 菜单同时列方向与「一步 / 一场 / 跳跃」，点方向把 `（推进方向：…）` 写进玩家消息。
- 删除 `mechanisms` 引擎、`director/evaluate.ts`、六个机制模块与插件内核的机制扩展点；每拍不再写导演决策。旧故事的 `directorOrganization: mechanisms|bits` 读成 `lines`；旧决策只读兼容，撤回与干扰统计仍可用。
- 规划准备只为推进跑一次（`{ message: "", push: "advance" }`），不再为其他档位或行动选项预跑（I11）。
- 写法：默认快速；规划、深度只在故事设置「高级 → 实验」里选；故事页输入台常规只列快速，处于实验写法时额外显示当前项。
- 验证：`pnpm check` 通过；`v5-direction`（新增推进菜单与实验区）、`director`、`v4-story`、`v4-dock`、`v4-prefs`、`v5-composer`、`v4-outline` 的 e2e 通过；走查 `walk6` 截图已看。

## 下一步
1. `canon/01`：原著导入与分章（见 `.scratch/canon/`）。

## 眼下要注意
- 走向页行 id 仍是写入键（`premise:*`、`volume:<id>`、`milestone:<id>`、`line:<id>`、`scene`、`note:<id>`）；新增方向走 `POST /api/stories/:id/direction/edit`。
- 推进方向不是后台任务：打开菜单时才读 `/direction`，不占间隙预算；规划预跑只覆盖无方向的「推进」。
- 旧的 `director_decisions` 表与 `saveDirectorDecision` 只为历史兼容保留，新代码不要再写决策。
- e2e 的 `helpers.sendTurn` 走故事页；调用前页面要停在 `/play`。
- server 读 core 的 `dist`：改了 core 导出后先构建 core；单跑 e2e 前先 `pnpm build`。
