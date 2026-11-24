# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-24（人工会话，人类要求「完成全部工作」，按 v5 顺序连续做）。
- **ui-v2/05 完成**：拆除「更多」与 9 个旧面板、`StoryTool`、无人引用的组件与 CSS（`panels.css` 少了约 1800 行）。迁移去向：导入、插件残留转初始记忆、视觉档案 → 设定页；生图后端与 workflow → 全局设置；旧「故事设置」→ 本故事设置的「高级」分页；导出 → 故事页标题旁「⋯」；场面控制（结束这一场、跳到）→ 输入台「⋯」；深度写法运行中「追加」→ 输入台；运行记录 → 检视器；立绘 → 记事百科；故事页加了「更早的楼层」。变更卡与连载阅读视图只剩接口（v5 记事页会重做）。
- e2e：被删面板的用例都迁移了（`v5-play-extras`、`branches`、`director`、`ledger`、`serial`、`pagination`、`cover`、`import-audit` 等），相关 71 个通过；`openings` 并发跑偶发失败、单跑通过（已知的后台队列积压）。

## 下一步
1. `memory-v5/01`，之后按 `.scratch/README.md` 的 v5 顺序：memory-v5 → direction-v5 → canon → card-ui / image-v2 → ui-v2/06。

## 眼下要注意
- 手机底栏现在 7 项；`.navs .ind` 是 `calc(100% / 7)`。
- e2e 的 `helpers.sendTurn` 现在走故事页（`.say textarea` + 「发送」），调用前页面要停在 `/play`；`openStoryTab` 已删除。
- 全量 e2e 后段桌面端 director / ledger / openings 会因后台队列积压假失败，单独重跑确认。
- 读人类本机 ST 数据时：只用脚本列结构并打码；它只是参考样本之一。
- 远端：只推 `main`；`backup/main-original` 与旧 `spec/*`、`ticket/*` 分支不要推。
- server 读 core 的 `dist`：改了 core 导出后先构建 core；单跑 e2e 前先 `pnpm build`。
