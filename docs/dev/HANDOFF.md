# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `image-v2/04`）。**M-D 呈现阶段（`card-ui` 01–02、`image-v2` 01–04）全部完成**。
- 迁移 85 给 `node_images` 加 `prompt_edited`；玩家改过的提示词不再被旧 `organizer_result.expanded` 里的人物提示词覆盖，出图以记录里的文本为准。
- `ImagesRepo.redrawNodeImage` 支持换 seed、改提示词、换模板三种重绘，都重置为 `pending` 并清空旧文件元数据；`deleteNodeImage` 只删插图记录，服务端顺带清理安全的生成文件。正在出图的记录拒绝重绘与删除。
- 新插图序号改用 `MAX(ordinal)+1`，删掉中间的图后再加不会撞唯一约束。
- `toNodeImage` 返回 `workflowId`、`seed`，`url` 带 `v=updatedAt`，重绘后不会命中旧缓存。
- 故事页 `Prose` 按 1-based 段落序号插入 `<figure class="floor-ill">`；`0` 在第一段前，`k` 在第 k 段后，`null` 或超出段落数放楼层末尾；插件渲染楼层由 `FloorImageList` 统一放在正文下方。
- 插图菜单（`v4/FloorImages.tsx`）：重绘（换 seed）、改提示词后重绘、换模板、删除；failed 另加重试。助手楼层操作区加「画这一幕」，未选 workflow 或关闭生图时给提示与故事设置链接。
- 验证：`pnpm check` 通过（2577 用例通过、7 个 live 跳过）；`v5-image-inline`、`v5-image-organizer`、`v5-image-profiles`、`v5-novelai-template`、`v4-story` 桌面/手机 e2e 通过；`walk18` 截图已看。
- 假 ComfyUI 把正向提示词编进图片宽度，e2e 据此确认后端收到的就是玩家改过的文本。

## 下一步
1. **M-E 收尾：`ui-v2/06` 全站文案清洗**。
2. 人类填入 `NOVELAI_API_KEY` 后跑一次 `pnpm vitest run packages/core/test/novelai.live.test.ts`，勾掉 `image-v2/03` 工单最后一项。

## 眼下要注意
- server 与 e2e 读 core 的 `dist`：改 core/st-compat 后先 `pnpm run build` 再跑 e2e。
- 插图插段序号按渲染出来的 `<p>` 数（思考、状态栏、选项块不算段落）；编辑或重写后段落数变了，旧图可能落到末尾。
- 回写提示词只改 `node_images`，任何情况下都不碰楼层 `raw`（I4/I8）。
- 插图接口的 `url` 带更新时间版本；改文件名或缓存策略时同步改 `toNodeImage` 与相关测试。
- `.walk/` 不入库；走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts .walk/walk18.spec.ts`。
