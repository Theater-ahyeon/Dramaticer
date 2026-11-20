# 06：体积预算检查与可访问性验收

**What to build:** 一个构建后运行的检查脚本，按规格的预算检查首屏 JS、CSS 与字体文件，超了就失败（接进 `pnpm e2e` 前的构建步骤，不进 `pnpm check` 以免拖慢门禁）；键盘可以走完主流程，焦点可见；减少动效时没有动画。

**Blocked by:** ui-lite/03、ui-lite/04、ui-lite/05

**Status:** done

- [x] 预算脚本在当前产物上通过，故意超预算时失败
- [x] 键盘走通：书架 → 故事 → 推进 → 重写 → 记忆页修改
- [x] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/ui-lite/spec.md`

## Comments

完成：2026-11-19 `packages/web/scripts/budget.mjs` 检查首屏 JS（index.html 引用与预加载的脚本）≤ 200 KB、CSS ≤ 40 KB（gzip）、没有字体文件，接在 `pnpm e2e` 的构建之后；当前 169.4 / 15.4 KB，`--js-kb 100` 时失败退出，`test/budget.test.ts` 用合成产物覆盖超标与字体两种失败。新增 `e2e/v4-a11y.spec.ts`：只用 Tab/回车走完书架 → 故事 → 推进 → 重写 → 记忆页修改，每一步检查焦点可见；减少动效时页面上没有在跑的动画（不减少时同一检查会看到 3 个，确认测试有效）。顺手修了记忆页就地编辑：键盘进入编辑后回车提交、Esc 放弃。check 2833、e2e 75 通过。
