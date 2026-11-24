# 03：开场白与开局候选

**What to build:** 导卡后卡的开场白立即作为第 0 楼显示；后台生成的开局候选以卡片显示在空故事页，点一下替换开场并开始；多个开场白（alternate greetings）可左右切换。

**Blocked by:** ui-v2/02

**Status:** done

- [x] 导卡后进故事页能看到开场白
- [x] 开局候选可选、可换，e2e 覆盖
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/ui-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
完成：2026-11-23 导卡时开场白（含备用开场白，`{{char}}`/`{{user}}` 换成卡名与「你」）立即成为首楼；开玩之前可左右切换开场白、点候选卡片替换开场、换一批候选，玩家一开口开场区收起（`storyAtOpening`，新接口 `GET/POST /greetings`）。没有标成「第 0 楼」，楼层编号保持从 1 开始。e2e `openings.spec.ts` 改为测新故事页。
