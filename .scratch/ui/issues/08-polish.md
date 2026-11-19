# 08：命令面板、手机端与整体验收

**What to build:** Ctrl K 命令面板；手机端的底部导航与输入台；全部页面的端到端走查。

**Blocked by:** 02、03、04、05、06、07

**Status:** done

- [x] 命令面板可以跳转与执行常用动作
- [x] 手机宽度下完成一次导入、推进、重写、修改记忆的全流程
- [x] 旧页面全部移除
- [ ] `pnpm check` 通过

规格：`.scratch/ui/spec.md`

## Comments

完成：2026-11-19 命令面板补齐所有主页面、工具与档位动作，手机端用一条端到端用例走完导入、推进、重写与改记忆；`src/pages` 删除，仍在用的工具面板迁到 `v4/panels/` 并由 `v4/StoryTool.tsx` 统一提供助手抽屉与内容外壳。整仓 `pnpm check` 由集成分支统一跑；本分支通过 `pnpm run invariants`、`pnpm run typecheck`、改动文件的 biome 检查，以及 `v4-polish.spec.ts`（桌面与手机）与受影响的 48 条既有端到端用例。
