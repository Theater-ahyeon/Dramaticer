# 04：写法对照

**What to build:** 同一批分支点、同一串玩家消息、同一个模型，对比快速、规划、深度。

**Blocked by:** 01、03

**Status:** done

- [x] 给出胜率、矛盾率、每楼调用数与等待时间
- [x] 裁判先通过有效性检查
- [x] `pnpm check` 通过（按集成者要求：invariants、typecheck、biome 与相关测试文件已跑过；未跑真实渠道）

规格：`.scratch/turn-modes/spec.md`

## Comments

完成：2026-11-19 写法对照在同一批分支点与同一串玩家消息上跑三种写法，先过 G0 再给胜率、矛盾率、每楼调用数与首字/用时，合成数据上指标与无效裁判拒绝均已验证。
