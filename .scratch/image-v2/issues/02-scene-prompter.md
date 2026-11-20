# 02：画面整理

**What to build:** 后台岗位：一次调用输出多张图的结构化结果（插入段落、构图、人物引用、人物级负面、坐标）；程序展开、去重、清洗、替换；整理结果存楼层插图，出图失败复用不重跑；触发频率可设（每场末 / 每楼 / 手动）。

**Blocked by:** image-v2/01、memory-v5/01

**Status:** ready-for-agent

- [ ] 假模型下整理结果展开为最终提示词
- [ ] 锁定的视觉档案不被覆盖
- [ ] 整理失败不影响正文
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/image-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
