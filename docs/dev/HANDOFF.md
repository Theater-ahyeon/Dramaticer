# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-24（人工会话，按 v5 顺序连续做）。
- **memory-v5/05 完成**：引文核对统一走 `memory/quote.ts` 的 `quoteMatches`（事件抽取、场记、结算器、用户意志）。引文只用来定位，对不上照样按楼层锚点写入；后台写入只因「与玩家锁定的事实冲突」「让未知情者知道了秘密（knowledge 写入在原文里没有得知经过）」被拒收，理由进检视器。提示词去掉「对不上整条被拒绝」。记忆层的变更卡（memory_revision）不再生成，界面无入口；助手提出的台账修改仍走助手待确认面板。记事三张活页就地编辑、自动锁定、可撤销，`v5-notebook.spec.ts` 各一条 e2e。
- `pnpm check` 与 `v5-notebook.spec.ts` e2e 通过。**memory-v5 01–05 全部完成**，其中 04 的基准回放没跑。

## 下一步
1. `direction-v5/01`（剧情走向一页），然后 `direction-v5/02`。
2. 之后：canon 01–06 → card-ui / image-v2 → ui-v2/06（全站文案清洗）。

## 眼下要注意
- 手机底栏现在 7 项；`.navs .ind` 是 `calc(100% / 7)`。
- e2e 的 `helpers.sendTurn` 走故事页（`.say textarea` + 「发送」），调用前页面要停在 `/play`。
- 全量 e2e 后段桌面端 director / ledger / openings 会因后台队列积压假失败，单独重跑确认。
- 读人类本机 ST 数据时：只用脚本列结构并打码；它只是参考样本之一。
- 远端：只推 `main`；`backup/main-original` 与旧 `spec/*`、`ticket/*` 分支不要推。
- server 读 core 的 `dist`：改了 core 导出后先构建 core；单跑 e2e 前先 `pnpm build`。
