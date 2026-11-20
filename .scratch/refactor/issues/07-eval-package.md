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

2026-11-19 暂缓：人类说「暂时不用评测」。核对现状时发现耦合比工单写的大——除 `evalset/` 与 `st-bench/` 外，`st-compat` 的 `health/`、`reference/`、`index.ts` 与 `st-bench/coexist.ts` 都反向依赖 `evalset`，41 个测试文件、`package.json` 的 30 多个脚本、`R6-PREREG.md` 与 NOTES 的命令都要同步。纯搬家、没有产品收益，等需要评测时再做；做时先把 `health/`、`reference/` 一并归入评测包，或让它们只依赖 core。`st-bench/` 是兼容插件自己的验收台（I15），建议留在 st-compat。
