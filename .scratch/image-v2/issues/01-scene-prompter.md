# 01：画面整理与视觉定义

**What to build:** 后台岗位「画面整理」：一次调用输出构图、出场人物提示词与定义更新；视觉定义扩成人物 / 场景 / 物件三类、稳定编号、可常驻；引用最近 N 次（默认 1，0–20）出图提示词。玩家可在生图页查看与修改定义，改过的锁定。

**Blocked by:** 无

**Status:** ready-for-agent

- [ ] 假模型下整理结果写入定义并被下一次出图引用
- [ ] 锁定的定义不被整理覆盖
- [ ] 整理失败不影响正文
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/image-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
