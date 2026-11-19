# 04：北极星指标：每百楼带原因重写率

**What to build:** 一条命令和设置页的一张小表，按故事给出每百楼重写次数，按原因（没推进、没听我的、太短、人设不对、格式乱、别推这条线、未选原因）分开，并分「1–10 楼」与「之后」两段；导演开关两组的干扰统计并排显示。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 复用 `core/src/preferences/reroll.ts` 与 `director/interference.ts` 的数据，不新增存储
- [ ] `dramaticer stats rerolls --db <path> [--story <id>] [--json]`，只读、零模型调用
- [ ] 设置页「功能」分页底部显示同一张表
- [ ] 报告只含数字，不含楼层原文（私有数据规则）
- [ ] `pnpm check` 通过

规格：`.scratch/refactor/spec.md`；DESIGN §14.1

## Comments
