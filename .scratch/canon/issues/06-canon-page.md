# 06：原著页与编辑

**What to build:** 记事里的「原著」分页：事件轨道（已演 / 当前 / 未来）、详情（概要、话术、原文）、就地编辑（按格版本化、可撤销）。

**Blocked by:** canon/05、ui-v2/05

**Status:** done

- [x] 编辑、撤销、从这里开始各一条 e2e
- [x] 编辑后的事件进入窗口
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/canon/spec.md`；方案：`docs/proposals/v5.md`

## Comments

完成：2026-11-27 迁移 81 的 `canon_event_edits` 按格只追加，`core/src/canon/edits.ts` 沿楼层路径叠加有效内容并接入窗口、走向页与场记提示词；新增原著分页接口与按格编辑/撤销/回到旧版本；记忆页「原著」分页含事件轨道、按格就地编辑、版本列表与从这里开始。core/server 单测与 `v5-canon-page`（桌面/手机 6 条）、`v5-canon-window`、`v5-canon-start`、`v5-canon`、`v5-notebook`、`v4-dock` 全部通过；`.walk/walk12.spec.ts` 截图已看。
