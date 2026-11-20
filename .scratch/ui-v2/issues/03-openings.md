# 03：开场白与开局候选

**What to build:** 导卡后卡的开场白立即作为第 0 楼显示；后台生成的开局候选以卡片显示在空故事页，点一下替换开场并开始；多个开场白（alternate greetings）可左右切换。

**Blocked by:** ui-v2/02

**Status:** ready-for-agent

- [ ] 导卡后进故事页能看到开场白
- [ ] 开局候选可选、可换，e2e 覆盖
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/ui-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
