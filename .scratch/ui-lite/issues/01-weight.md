# 01：减重：去掉三维背景、指针特效、开场动画与打包字体

**What to build:** 删除 three.js 场景（`scene.ts`）、指针光与卡片倾斜、每次打开播放的开场；背景改成纯 CSS 的静态底色；字体改用系统字体栈，移除 `three`、`@fontsource-variable/noto-serif-sc`、`@fontsource/zcool-xiaowei` 三个依赖。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 构建产物里没有 three.js 分包与字体文件
- [x] `stage` 的公开接口保留（页面里的 `pulse`、`setWriting`、`travel` 调用不改），只是不再驱动三维场景
- [x] DEPENDENCIES.md 与 DECISIONS.md 同步（移除依赖）
- [x] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/ui-lite/spec.md`

## Comments

完成：2026-11-19 删除 three.js 场景、指针光与倾斜、开场动画和三个依赖；字体改用本机字体栈。前端产物从 14 MB 以上降到 681 KB（JS 594 KB / gzip 175 KB，CSS 99 KB / gzip 20 KB）。`pnpm check` 2753 通过，`pnpm e2e` 70 通过。
