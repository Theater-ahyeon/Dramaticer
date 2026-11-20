# 05：拆除「更多」与旧面板

**What to build:** 按 v5 §5.1 迁移：导入 → 新建弹窗；体检 → 设定子页；分支 → 故事页；台账 → 记事「此刻局面」；连载 → 故事页「⋯」导出；导演 → 剧情走向；生图 → 设置；设置 / 渠道 → 全局设置；删除旧聊天页与 `StoryTool` 外壳、无人引用的旧组件与样式。

**Blocked by:** ui-v2/01、ui-v2/04

**Status:** ready-for-agent

- [ ] 主导航不再有「更多」，路由表里没有旧面板
- [ ] 被删组件的 e2e 迁移或删除，覆盖面不减
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/ui-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
