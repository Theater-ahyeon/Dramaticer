# 05：旧工具面板换到新设计

**What to build:** `v4/panels/` 里迁移过来的旧面板（聊天、导演、设置、分支、台账、连载、生图、渠道、导入、检查）只换样式到新设计系统，内部结构不重写；`styles.css` 在这之后可以删除。

**Blocked by:** ui-lite/02

**Status:** done

- [x] `styles.css` 删除，或只剩极少量面板专用样式并入 `v4.css`
- [x] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/ui-lite/spec.md`

## Comments

完成：2026-11-19 删除 `src/styles.css`；旧面板样式移到 `v4/panels.css`，由 `v4.css` 开头 `@import`（保持「面板规则在前、v4 在后」的层叠顺序），写死的颜色全部换成设计变量（测试禁止十六进制颜色），去掉与 v4 重复的全局 button/body/focus 规则，圆角落到刻度上；分组框去掉浏览器默认边框，面板标题统一为界面字体，候选行动不再整块铺朱砂底，文件选择按钮与故事 id 换行也统一了。没有并进 v4.css 本身：面板样式约 3000 行，单独成文件更好维护。十个面板亮暗、手机桌面都截图检查过。check 2829、e2e 72 通过。`ledger.spec` 在 `--repeat-each=3` 下第三次稳定失败，上一个提交同样如此，是已有的不稳定用例，与本工单无关。
