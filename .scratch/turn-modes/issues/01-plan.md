# 01：规划：固定阶段的一楼

**What to build:** 选规划时按固定阶段完成一楼，阶段写入 Trace，界面收到阶段进度。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 阶段顺序固定且数量有上限
- [x] 角色意图只用该角色知道的内容生成
- [x] 复查结果存成可切换的版本，不阻塞正文
- [x] `pnpm check` 通过（按集成者要求：invariants、typecheck、lint 与相关测试文件已跑过）

规格：`.scratch/turn-modes/spec.md`

## Comments

完成：2026-11-19 规划写法的固定阶段与上限写进 Trace，角色意图按人隔离，复查改成不阻塞正文的后台兄弟版本。
