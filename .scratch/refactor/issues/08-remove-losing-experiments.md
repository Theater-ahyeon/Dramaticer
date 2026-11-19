# 08：删除未胜出的实验候选

**What to build:** 删除 X1 的 `wiki`、`temporal_graph` 世界模型（保留 `ledger`），以及导演引擎 `bits` 与 `mechanisms`（保留 `lines`）。故事设置里的 `worldModel`、`directorOrganization` 改为只读兼容：旧库里存的旧值按默认值处理并在 Trace 记一次。对照评测脚本里依赖它们的部分一起删除，报告与 ADR 保留。

**Blocked by:** refactor/01、refactor/04（先有北极星数字证明 `lines` 不比旧引擎差）

**Status:** ready-for-agent

- [ ] 写一条 ADR：删除依据（ADR-0130、ADR-0134、04 的数字）与对已有故事的影响
- [ ] 删除前按 code-quality 的删除检查：直接与动态引用、设置、插件注册表、导出、测试、文档、迁移
- [ ] 不删迁移与表结构；旧表保留只读
- [ ] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/refactor/spec.md`

## Comments
