# 07：评测工具移到 packages/eval

**What to build:** 把 `st-compat/src/evalset/` 与 `st-compat/src/st-bench/` 移到新包 `@dramaticer/eval`（依赖 `core` 与 `st-compat`），`st-compat` 只留酒馆内容转换与四个兼容插件。命令名不变；`package.json` 的脚本与文档里的 `pnpm --filter @dramaticer/st-compat run <评测命令>` 改成新包名。

**Blocked by:** refactor/01（MVP 之后做）

**Status:** ready-for-agent

- [ ] `st-compat` 不再包含评测、裁判、试玩、门槛判定代码
- [ ] 评测命令全部能从新包运行；`R6-PREREG.md` 与 NOTES 里的命令同步
- [ ] `scripts/check-invariants.mjs` 的扫描范围覆盖新包（I10：测试不联网、不用私有数据）；脚本受保护时写 HUMAN.md 请人类更新
- [ ] DEPENDENCIES.md 登记新包（I3）
- [ ] `pnpm check` 通过

规格：`.scratch/refactor/spec.md`

## Comments
