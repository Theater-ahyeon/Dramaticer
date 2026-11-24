# 04：上下文收拢为六节

**What to build:** 按 v5 §3.2：卡与写作条目、世界索引、此刻局面、相关页面（在场与重逢整页；检索命中带所在场摘要或前后一楼原文）、剧情走向提示（只在推进时）、最近原文窗口（放得下就全放，否则远粗近细）。删除被替代的槽位。

**Blocked by:** memory-v5/02、memory-v5/03

**Status:** done

- [x] 默认模板只剩六节，每节有 Trace 来源
- [x] 放得下原文时不触发检索
- [ ] 合成基准（`benchmarks/`）的回忆题离线回放不退步（需要评测时申请长任务）
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/memory-v5/spec.md`；方案：`docs/proposals/v5.md`

## Comments
完成：2026-11-24 默认模板六节（context-six.test）；pages 槽位注入在场与重逢人物的记事页；检索的父文档回溯。未完成：合成基准回忆题的离线回放没有跑（需要申请长任务，人工会话里没有循环脚本执行），下次自动循环时按 AGENTS.md 申请 `.devloop/jobs/` 跑一次对比。
