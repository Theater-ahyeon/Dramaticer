# 05：出处放宽与直接编辑

**What to build:** 出处改为楼层锚点并做宽松匹配；拒收只针对矛盾与越权；删除变更卡审批流与相关界面；记事三张活页统一为就地编辑、自动锁定、可撤销。

**Blocked by:** memory-v5/03

**Status:** ready-for-agent

- [ ] 拒收理由里不再有「引文不逐字」
- [ ] 界面上不再有待批准的变更卡
- [ ] 编辑、锁定、撤销各一条 e2e
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/memory-v5/spec.md`；方案：`docs/proposals/v5.md`

## Comments
