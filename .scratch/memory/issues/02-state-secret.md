# 02：状态与秘密由记录算出

**What to build:** 状态按键取最新值；秘密记录谁知道、谁不知道，在场即知道。

**Blocked by:** 01

**Status:** done

- [x] 同一个键多次变化时读到最新值，历史可查
- [x] 卡声明的类型进入状态
- [x] 不在场的角色被列为不知道，被告知后更新
- [x] `pnpm check` 通过

规格：`.scratch/memory/spec.md`

## Comments

完成：2026-11-19 状态按键取最新值并带全部版本历史，卡声明的 mvu 变量进入状态；秘密按在场与台账里的知情记录算出知道与不知道的人。验证用 invariants、typecheck、目标测试文件替代整仓 `pnpm check`。
