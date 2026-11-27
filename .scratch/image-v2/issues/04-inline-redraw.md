# 04：插图插段与重绘

**What to build:** 插图显示在记录的段落之后（不改原文）；菜单：重绘（换 seed）、改提示词后重绘、换模板、删除；手动「画这一幕」。

**Blocked by:** image-v2/02、ui-v2/02

**Status:** done

- [x] 插段显示、三种重绘各一条 e2e（假后端）
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/image-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
完成：2026-11-27 插图按段落插入、换 seed / 改提示词 / 换模板三种重绘、删除与「画这一幕」；`pnpm check`、`v5-image-inline` 等桌面/手机 e2e 与 `walk18` 走查通过。
