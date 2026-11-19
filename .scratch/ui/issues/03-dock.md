# 03：故事页停靠栏：导演、记忆、上下文

**What to build:** 右侧三页：剧情线与倒计时、伏笔、导演做过什么；在场人物、秘密、快要相关；本轮上下文的构成并可跳转修改。

**Blocked by:** 02、memory/06、director-yield/01

**Status:** done

- [x] 剧情线可以置顶与静音
- [x] 导演安排可以撤回
- [x] 上下文的每一条能跳到对应的修改处
- [x] `pnpm check` 通过

规格：`.scratch/ui/spec.md`

## Comments

完成：2026-11-19 停靠栏的剧情线按置顶排序、可静音，导演做过什么可撤回；上下文条目按来源对象跳到设定条目、百科页、状态行、时间线、偏好、原文楼层。门禁按约定跑 invariants、typecheck、biome 与 `v4-dock.spec.ts`（桌面与手机）。
