# 02：其余功能开关接通运行时

**What to build:** 功能页上每个开关的值就是运行时用的值。逐个接通：重逢注入（`reunion` 槽位）、全文检索（`memory` 槽位的检索路）、知情标注（`profile` 槽位的不在场标注）、伏笔上限（导演配置）、规则执行（检定工具开放）、行动选项（`candidate_actions` 任务）、思考（`reasoning`）、工具查阅（快速写法的读取工具）、文风层（文风类设定条目）、原样兼容（`importMode`）。状态面板、出图、背景音乐属于显示层，由 web 读取同一份开关状态。暂时接不通的开关在功能页上标「尚未生效」，不能显示成已生效。

**Blocked by:** refactor/01

**Status:** ready-for-agent

- [ ] 每个开关都有一条测试：开关取不同值时，槽位内容、后台任务列表或工具列表随之变化
- [ ] 「本轮临时开关」同样生效（`readStoryFeatureState` 的 `turnOverrides`）
- [ ] 功能页显示的「起过几次作用」与开关是否生效一致
- [ ] 旧的独立设置（`sceneLogEnabled`、`turnMode` 以外的重复项）不再与功能页冲突：两者都存在时以 DESIGN §22 的规则为准并写进 NOTES
- [ ] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/refactor/spec.md`；DESIGN §22

## Comments
