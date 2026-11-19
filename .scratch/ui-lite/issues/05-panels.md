# 05：旧工具面板换到新设计

**What to build:** `v4/panels/` 里迁移过来的旧面板（聊天、导演、设置、分支、台账、连载、生图、渠道、导入、检查）只换样式到新设计系统，内部结构不重写；`styles.css` 在这之后可以删除。

**Blocked by:** ui-lite/02

**Status:** ready-for-agent

- [ ] `styles.css` 删除，或只剩极少量面板专用样式并入 `v4.css`
- [ ] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/ui-lite/spec.md`

## Comments
