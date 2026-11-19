# 06：体积预算检查与可访问性验收

**What to build:** 一个构建后运行的检查脚本，按规格的预算检查首屏 JS、CSS 与字体文件，超了就失败（接进 `pnpm e2e` 前的构建步骤，不进 `pnpm check` 以免拖慢门禁）；键盘可以走完主流程，焦点可见；减少动效时没有动画。

**Blocked by:** ui-lite/03、ui-lite/04、ui-lite/05

**Status:** ready-for-agent

- [ ] 预算脚本在当前产物上通过，故意超预算时失败
- [ ] 键盘走通：书架 → 故事 → 推进 → 重写 → 记忆页修改
- [ ] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/ui-lite/spec.md`

## Comments
