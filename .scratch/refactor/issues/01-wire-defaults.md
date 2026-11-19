# 01：默认接通 v4 导演与自动记录

**What to build:** 新故事默认用线与动作引擎；功能页的「场记」「档案归档」真的决定后台是否运行自动记录与场次归档。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `DEFAULT_DIRECTOR_ORGANIZATION` 为 `lines`；测 v3 行为的用例显式写明 `mechanisms`
- [x] `readStoryBackgroundSwitches` 按功能页与旧设置 `sceneLogEnabled` 解析后台开关；server 调度与后台 CLI 都用它
- [x] 归档依赖场记：场记关时归档不运行
- [x] `dramaticer chat` 新建故事时显式用 `mechanisms`（它的 `--director` 与 `--intensity` 只对这套引擎有意义）
- [x] 新增 `core/test/background-switches.test.ts`
- [x] `pnpm check` 通过
- [x] `pnpm e2e` 通过

规格：`.scratch/refactor/spec.md`；决定：ADR-0161

## Comments

完成：2026-11-19 新故事默认 `lines`，功能页「场记」「档案归档」驱动后台；测 v3 行为的 17 个用例（含 e2e `director.spec.ts`）改为显式 `mechanisms`。`pnpm check` 2747 通过；`pnpm e2e` 完整运行 68/70 通过，失败的 2 条（同一用例两种视口）修复后单独重跑通过。
