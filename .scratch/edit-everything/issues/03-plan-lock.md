# 03：规划对象的出处、锁定与回滚

**What to build:** 剧情线、伏笔、本场目标、大纲条目都标明谁写的，可以锁定、可以回滚。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] AI 对锁定项只能生成建议
- [x] 回滚后导演使用恢复后的内容
- [x] `pnpm check` 通过（集成分支整仓门禁通过：326 个测试文件、2730 个用例）

规格：`.scratch/edit-everything/spec.md`

## Comments

完成：2026-11-19 剧情线、伏笔、本场目标与大纲条目的出处、锁定与回滚；`pnpm check` 由集成分支统一跑，本分支已跑 `pnpm run invariants`、`pnpm run typecheck`、biome 与相关单测。
