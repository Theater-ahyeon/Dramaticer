# 05：偏好来自纠正与重写原因

**What to build:** 玩家的纠正、底线和重写时选的原因进入偏好，始终带入上下文且优先级最高。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 重写时选的原因累积后形成一条偏好
- [x] 偏好可以停用与恢复
- [ ] `pnpm check` 通过

规格：`.scratch/memory/spec.md`

## Comments

完成：2026-11-19 重写原因写入用户意志并按稳定 id 累积，偏好可停用与恢复；新增 `packages/core/test/memory-prefs.test.ts`。按约定未跑整仓 `pnpm check`，已跑 `pnpm run invariants`、`pnpm run typecheck`、改动文件的 biome 与相关单测。
