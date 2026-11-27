# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `image-v2/02`）。**画面整理后台岗位、展开清洗管线、触发频率与复用重试**。
- 迁移 84 给 `node_images` 加 `insert_after_paragraph`、`title`、`organizer_result`；整理结果存完整结构化输出与展开后的多人物提示词、人物级负面和坐标。
- 新任务 `image_organize`（故事级、gap 档）：先消费手动请求，再按 `trigger`（`scene_end` / `floor` / `manual`）与 `mode` 找最新一个未整理的落定助手楼层；一次一楼，成功后补排 `illustrate`。
- 输入：目标楼段落编号、上一楼、在场者记事页、世界索引、关键词命中的标签库、`image_organizer` 写作条目、人物与服装短表、最近 N 条提示词。展开按分格档案与独立服装补齐；后处理在 `images/compile.ts`（替换规则 → 全角标点 → 去重）。
- `runOneImage` 对已有 `prompt + organizer_result` 的记录直接复用，重试不再调用整理模型。
- 服务端：`POST /api/stories/:id/nodes/:nodeId/organize-images`、`GET|PUT .../image-organizer/rules`；故事设置的生图区提供触发频率、最近提示词条数、替换规则、手动整理与最近结果预览。
- 验证：`pnpm check` 通过（2562 用例）；`v5-image-organizer`、`v5-image-profiles`、`v4-prefs`、`v4-story` 桌面/手机 e2e 通过；`walk16` 截图已看。

## 下一步
1. `image-v2/03`（NovelAI 按模型族生成请求）：复用 `node_images.organizer_result` 的坐标与人物级负面。
2. 验收依据：`docs/proposals/v5.md` 第六节与 `.scratch/image-v2/issues/03-novelai-families.md`。

## 眼下要注意
- 迁移版本 84；新故事表与仓储方法要在 `story-store.ts` 的 DELEGATES 里登记。
- server 与 e2e 读 core 的 `dist`：改 core/st-compat 后先 `pnpm run build` 再跑 e2e。
- 画面整理是故事级任务，靠 `needsRun` 找楼层；不要改成每楼一个任务，否则场记任务未完成时会被误判为已整理。
- 手动请求存在故事 kv `images.organizeRequests`，整理成功后才消费；失败时保留以便重试。
- e2e 的假 ComfyUI 在 `packages/web/e2e/fake-channel.mjs`（`/comfy/prompt|history|view`），假画面整理在同一个文件里按系统提示词分流。
- `.walk/` 不入库；走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts .walk/walk16.spec.ts`。
