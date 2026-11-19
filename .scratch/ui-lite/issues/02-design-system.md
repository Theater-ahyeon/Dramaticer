# 02：新的设计系统与样式重写

**What to build:** 重写 `v4.css` 的设计变量与基础组件（按钮、输入、卡片、标签、开关、分页、对话框、抽屉、提示）：纸与墨两套主题、朱砂一个强调色、系统字体的字号阶梯与行高、间距与圆角刻度；去掉玻璃模糊与装饰渐变。合并 `styles.css` 里新界面仍在用的部分，删掉没人用的样式。设置页加「外观：跟随系统 / 亮 / 暗」。

**Blocked by:** ui-lite/01

**Status:** ready-for-agent

- [ ] 两套主题都满足正文与界面文字的 WCAG AA 对比度
- [ ] CSS（gzip）≤ 40 KB
- [ ] 类名尽量不变；改动的选择器在 e2e 里同步
- [ ] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/ui-lite/spec.md`

## Comments
