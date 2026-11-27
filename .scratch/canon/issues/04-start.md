# 04：从原著开局

**What to build:** 新建故事弹窗「从原著开局」：选书、选扮演身份（原著人物 / 自创人物）、选开局事件；可叠加一张角色卡提供文风与规则；扮演的原著人物不进 NPC 名册。

**Blocked by:** canon/03、ui-v2/01

**Status:** done

- [x] 两种扮演身份各一条 e2e
- [x] 叠加角色卡时卡的写作条目与原著数据同时生效
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/canon/spec.md`；方案：`docs/proposals/v5.md`

## Comments

完成：2026-11-27 从原著开局弹窗、两种扮演身份、可选叠卡、故事绑定与初始游标；迁移 79；core/server 单测、v5-canon-start 4 条 e2e、v5-canon/v5-direction/v4-story/v4-shell e2e 与 walk10 桌面/手机截图通过。
