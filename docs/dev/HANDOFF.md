# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-19（人工会话，全量架构审查）。人类要求：先做完整 MVP 再慢慢优化，允许大改。
  - **发现**：新故事默认没有用上 v4。导演默认是旧引擎 `mechanisms`（director-yield 的改动只在 `lines` 里生效）；自动记录 `sceneLogEnabled` 默认关（场次、归档、百科、秘密都不产生）；功能页 18 个开关里运行时只读 3 个，页面显示「场记 开」，后台其实没跑。
  - **已修（refactor/01，ADR-0161）**：默认 `directorOrganization: lines`；新增 `readStoryBackgroundSwitches`，功能页「场记」「档案归档」驱动后台；测 v3 行为的 15 个用例改成显式 `mechanisms`；`dramaticer chat` 新建故事时显式用 `mechanisms`。
  - **文档**：`docs/DESIGN.md` 重写为只描述现状的 v1.0（章节编号不变），新增 MVP 定义（§15.2）、北极星指标（§14.1）、记忆的参考与取舍（§7.7）；旧稿在 `docs/archive/DESIGN-v0.4.md`。
  - **新工单**：`.scratch/refactor/` 01–08（01–04 是 MVP 收口，05–08 是 MVP 之后的整理）。
- 仍在分支 `spec/v4-remaining`，没有合并到 `main`。

## 下一步
1. `refactor/02`：其余功能开关接通运行时（MVP 第 2 条）。
2. `refactor/03`：后台渠道保底与失败可见；`refactor/04`：北极星指标。
3. 等人类回复 HUMAN-24（要哪种 Vertex）再建工单；HUMAN-23 由人类改 AGENTS.md 的文档地图。
4. 人类确认后把 `spec/v4-remaining` 合并到 `main`。

## 眼下要注意
- 已有故事保存的 `directorOrganization` 不迁移，仍是 `mechanisms`；只有新故事用 `lines`。
- `lines` 引擎还没有和旧引擎做同口径对照（X2 只比了 `mechanisms` 与 `bits`）；`refactor/08` 删旧引擎之前要先有 04 的数字。
- 标准档新故事每楼多一次后台调用（场记），有实体时每场多一次归档；后台渠道额度要够（HUMAN-19）。
- server 读的是 core 的 `dist`：改了 core 的导出之后，先 `pnpm --filter @dramaticer/core run build` 再跑 server 的类型检查。
