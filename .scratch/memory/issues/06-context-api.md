# 06：本轮上下文的构成与来源

**What to build:** 能读到某一楼的上下文按类别的大小，以及每一条内容的来源对象。

**Blocked by:** 03

**Status:** done

- [x] 每一类给出 token 数
- [x] 每一条能定位到设定、记录、百科页或状态项
- [x] `pnpm check` 通过

规格：`.scratch/memory/spec.md`

## Comments

完成：2026-11-19 上下文 Trace 逐条记录来源对象；`readContextBreakdown` 按类别给出 token 数，记录定位到记录 id、设定条目、百科页或状态项，旧 Trace 回落到片段来源。验证用 invariants、typecheck 与目标测试文件替代整仓 `pnpm check`。
