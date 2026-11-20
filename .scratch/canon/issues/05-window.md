# 05：原著窗口与游标

**What to build:** 上下文方向提示的原著来源：当前一件每轮给，接下来 1–3 件只在推进时给；话术 / 原文开关；偏离规则说明；死人标注与话术剔除；游标随楼层存、由局面更新判断是否演完；推进到下一件 / 推进 N 件；「从这里开始」。

**Blocked by:** canon/04、memory-v5/04

**Status:** ready-for-agent

- [ ] Trace 能看到原著窗口内容与来源
- [ ] 偏离后游标不前进、不强拉回原著
- [ ] 删楼与分支后游标回退
- [ ] 死人相关事件被标注、话术被剔除
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/canon/spec.md`；方案：`docs/proposals/v5.md`

## Comments
