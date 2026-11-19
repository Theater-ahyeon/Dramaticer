# 01：外壳、设计变量与书架

**What to build:** 新的导航外壳（桌面左侧、手机底部）、明暗两套颜色、书架页（继续上次、卡面图、导入入口）。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 明暗主题与手机宽度下无横向滚动
- [x] 书架显示卡面图，没有图片的用占位图
- [x] 继续上次显示上回说到与进度
- [x] `pnpm check` 通过

规格：`.scratch/ui/spec.md`

## Comments

完成：2026-11-19 补上外壳与书架的端到端用例（桌面与手机两个视口）：明暗主题下无横向滚动、导航在桌面左侧与手机底部、书架卡面图与无图占位图、「继续上次」的上回说到与进度。
本 worktree 里 `pnpm run invariants`、`pnpm run typecheck`、`pnpm run lint` 通过；`v4-shell.spec.ts` 在 desktop 与 mobile 两个项目下各两条用例全部通过。整仓 `pnpm vitest run` 由集成分支统一跑。
