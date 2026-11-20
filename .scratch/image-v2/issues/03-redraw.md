# 03：重绘与改提示词

**What to build:** 楼层插图上：重绘（同提示词换 seed）、编辑提示词后重绘、复用整理结果；手动在某楼「画这一幕」。

**Blocked by:** image-v2/01、ui-v2/02

**Status:** ready-for-agent

- [ ] 三种操作各一条 e2e（假后端）
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/image-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
