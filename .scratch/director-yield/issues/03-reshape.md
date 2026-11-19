# 03：玩家行动改写剧情线；默认值调整

**What to build:** 玩家的行动可以让剧情线了结、转向或作废；导演默认「仅推进时」，大纲约束默认「弱」，走偏时默认提议改大纲。

**Blocked by:** 01

**Status:** done

- [x] 章末清点读取这一章玩家造成的变化并重排剧情线
- [x] 新故事的默认值是仅推进时与弱
- [x] 大纲走不通时第一个选项是改大纲
- [x] `pnpm check` 通过（集成分支整仓门禁通过：326 个测试文件、2730 个用例）

规格：`.scratch/director-yield/spec.md`

## Comments

完成：2026-11-19 章末清点把上一章之后玩家自己写的变化带进提示词，模型据此删线、改写 want 与 obstacle 或把伏笔 retire；新故事默认导演「仅推进时」、总纲缺省「弱」；里程碑受阻或已不可能时第一个选项是「调整蓝图」。整仓 `pnpm check` 按 `CONTRACT.md` 留给集成分支，本地跑过 `pnpm run invariants`、`pnpm run typecheck`、biome 与相关单测。
