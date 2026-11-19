# 04：「这不是我要的」与干扰统计

**What to build:** 每条导演安排可以撤回：记入偏好、静音对应剧情线；统计导演开关两种情况下「没听我的」「别推这条线」的比例。

**Blocked by:** 01

**Status:** done

- [x] 撤回后那条线不再被选中，直到玩家恢复
- [x] 统计接口给出两种情况下的次数与比例
- [x] `pnpm check` 通过（集成分支整仓门禁通过：326 个测试文件、2730 个用例）

规格：`.scratch/director-yield/spec.md`

## Comments

完成：2026-11-19 撤回在同一个事务里静音剧情线并写一条 `avoid-line` 长期偏好，恢复后重新参与选择；干扰统计接口按导演开、关分组给出两项次数与比例。整仓 `pnpm check` 按 `CONTRACT.md` 留给集成分支，本地跑过 `pnpm run invariants`、`pnpm run typecheck`、biome 与 director-lines、preferences、reroll-reason、director-undo 相关单测。
