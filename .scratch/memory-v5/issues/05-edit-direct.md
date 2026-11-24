# 05：出处放宽与直接编辑

**What to build:** 出处改为楼层锚点并做宽松匹配；拒收只针对矛盾与越权；删除变更卡审批流与相关界面；记事三张活页统一为就地编辑、自动锁定、可撤销。

**Blocked by:** memory-v5/03

**Status:** claimed

- [ ] 拒收理由里不再有「引文不逐字」
- [ ] 界面上不再有待批准的变更卡
- [ ] 编辑、锁定、撤销各一条 e2e
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/memory-v5/spec.md`；方案：`docs/proposals/v5.md`

## Comments
进行中（2026-11-24）：已加 `memory/quote.ts`（`quoteMatches` 宽松匹配，未接入）。剩余：1) extract.ts 的 recordExtractedEvents 引文对不上时照样写入、只在宽松匹配时留摘录，同步改 `memory-records.test.ts` 那条「出处不是原话时拒绝」；2) scene-log 的 states、user-will 的 findQuoteNode 改用 quoteMatches，提示词去掉「对不上整条被拒绝」；3) knowledge 写入让未知情者得知秘密且原文无依据时拒收；锁定冲突的拒收理由改成「与玩家锁定的事实冲突」；4) 变更卡：记忆层（memory_revision）已在局面更新模式下不跑；助手的待确认台账卡保留为权限确认，需人类确认这样理解对不对；5) 记事三张活页编辑/锁定/撤销各一条 e2e。
