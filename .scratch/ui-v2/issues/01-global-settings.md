# 01：全局模型渠道与新建故事

**What to build:** 全局设置页（主导航底部）：模型与渠道向导（选供应商 → 填 key → 一键测试 → 选正文与后台模型），不建故事也能进；书架「新建故事」弹窗（导入角色卡 / 空白开局；卡与世界书拖放，中文文件控件），导完直接进故事页。server 需要的全局渠道接口不再挂在 `/stories/:id/` 下。

**Blocked by:** 无

**Status:** ready-for-agent

- [ ] 新装环境不建故事就能配好渠道并测试通过
- [ ] 新建故事两种方式各一条 e2e，结束时停在故事页
- [ ] 不再出现 `window.prompt` 与整页刷新跳转
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/ui-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
