# 01：记录只追加并挂上实体

**What to build:** 每楼的自动记录产出带实体、故事时间、重要度与逐字出处的记录；出处对不上的被拒绝；没有更新和删除接口。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 记录写入后不可改、不可删
- [ ] 出处不是源楼层里的原话时拒绝并记原因
- [ ] 分支切换后只看到当前路径上的记录
- [ ] 结算产生的事实也以记录形式存在
- [ ] `pnpm check` 通过

规格：`.scratch/memory/spec.md`

## Comments
