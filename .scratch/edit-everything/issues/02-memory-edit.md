# 02：记忆直接修改：校验、锁定、历史

**What to build:** 状态、秘密、百科语句、时间线摘要、偏好都能直接改；改过的锁定，后台不得覆盖；有历史与回滚。

**Blocked by:** memory/02、memory/04

**Status:** ready-for-agent

- [ ] 校验失败时在原处给出原因
- [ ] 锁定项被后台写入时拒绝并记录
- [ ] 回滚恢复到选定版本
- [ ] 两条分支的修改互不影响
- [ ] `pnpm check` 通过

规格：`.scratch/edit-everything/spec.md`

## Comments
