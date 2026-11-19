# 04：记忆页

**What to build:** 百科、状态、秘密、时间线、偏好五个分页，全部可以就地修改，显示出处与锁定。

**Blocked by:** 01、edit-everything/02

**Status:** done

- [x] 改完显示已锁定并可撤销
- [x] 百科页之间的链接可以点
- [x] 可以展开看原文摘录
- [ ] `pnpm check` 通过

规格：`.scratch/ui/spec.md`

## Comments

完成：2026-11-19 记忆页五个分页可就地修改，补上偏好锁定与撤销、百科简介锁定，修正简介修改会多出一句的问题，并新增覆盖桌面与手机的端到端用例。整仓 `pnpm check` 由集成分支统一跑；本分支已通过 `pnpm run invariants`、`pnpm run typecheck`、相关单测与目标 e2e。
