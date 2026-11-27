# 02：画面整理

**What to build:** 后台岗位：一次调用输出多张图的结构化结果（插入段落、构图、人物引用、人物级负面、坐标）；程序展开、去重、清洗、替换；整理结果存楼层插图，出图失败复用不重跑；触发频率可设（每场末 / 每楼 / 手动）。

**Blocked by:** image-v2/01、memory-v5/01

**Status:** done

- [x] 假模型下整理结果展开为最终提示词
- [x] 锁定的视觉档案不被覆盖
- [x] 整理失败不影响正文
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/image-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments

完成：2026-11-27 迁移 84 新增插图段落、标题与整理结果；画面整理任务、展开清洗管线、触发频率与替换规则、重试复用提示词、手动接口与设置界面落地；pnpm check 2562 通过，v5-image-organizer/v5-image-profiles/v4-prefs/v4-story e2e 通过，walk16 桌面/手机截图已看。
