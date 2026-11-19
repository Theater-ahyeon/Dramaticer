# 02：记忆直接修改：校验、锁定、历史

**What to build:** 状态、秘密、百科语句、时间线摘要、偏好都能直接改；改过的锁定，后台不得覆盖；有历史与回滚。

**Blocked by:** memory/02、memory/04

**Status:** done

- [x] 校验失败时在原处给出原因
- [x] 锁定项被后台写入时拒绝并记录
- [x] 回滚恢复到选定版本
- [x] 两条分支的修改互不影响
- [x] `pnpm check` 通过（按约定跑 invariants、typecheck、biome 与相关单测；整仓门禁由集成分支统一跑）

规格：`.scratch/edit-everything/spec.md`

## Comments

完成：2026-11-19 状态、秘密、百科语句、时间线摘要与偏好可直接修改并自动锁定；后台写向锁定项被拒并记录；状态与百科可按版本回滚；修改按楼层路径隔离。本地通过 invariants、typecheck、biome 与相关单测，整仓门禁由集成分支统一跑。
