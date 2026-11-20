# 08：删除未胜出的实验候选

**What to build:** 删除 X1 的 `wiki`、`temporal_graph` 世界模型（保留 `ledger`），以及导演引擎 `bits` 与 `mechanisms`（保留 `lines`）。故事设置里的 `worldModel`、`directorOrganization` 改为只读兼容：旧库里存的旧值按默认值处理并在 Trace 记一次。对照评测脚本里依赖它们的部分一起删除，报告与 ADR 保留。

**Blocked by:** refactor/01、refactor/04（先有北极星数字证明 `lines` 不比旧引擎差）

**Status:** done

- [x] 写一条 ADR：删除依据（ADR-0130、ADR-0134、04 的数字）与对已有故事的影响
- [x] 删除前按 code-quality 的删除检查：直接与动态引用、设置、插件注册表、导出、测试、文档、迁移
- [x] 不删迁移与表结构；旧表保留只读
- [x] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/refactor/spec.md`

## Comments

完成：2026-11-19（ADR-0166）删除 `wiki`、`temporal_graph` 世界模型与 `bits` 小品引擎、`director_bits` 后台任务和两个对照评测脚本；旧设置值只读兼容，按默认实现运行并在 Trace 来源注明；迁移、表与存取方法不动。偏离：`mechanisms` 暂留——人类说暂时不用评测，04 的北极星数字还没有真实数据，而已有故事、十几组导演测试、导演 e2e 与插件机制注册表都依赖它，删除另开工单。check 2832 通过。
