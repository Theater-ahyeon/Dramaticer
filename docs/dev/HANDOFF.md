# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `image-v2/01`）。**分格视觉档案、独立服装、标签库与智绘姬导入**。
- 视觉档案新增 `locked` 与 12 格 `slots`；迁移 83 建 `character_outfits` 与 `tag_library_entries`。
- `expandVisualProfile` 按视角 × 部位 × 着装状态取格，空格回退 base；着装时按上身/全身可见或隐藏拼服装标签。
- 写作条目加 `scope`（`turn` / `image_organizer`），正文回合只发 `turn`；设定页两套编辑互不覆盖。
- `st-compat/src/image-import/` 解析角色/服装库与生图预设；后者有关键词的进标签库，其余进画面整理条目。
- 接口：`PUT .../visual-profiles`、`GET|PUT .../outfits`、`GET|PUT .../image-tags`、`GET .../image-organizer/entries`、`POST .../images/import-st`。
- 设定页的 `v4/VisualProfileEditor.tsx` 提供分格、服装、标签库、整理条目与两个导入按钮。
- 浏览器取分格/标签常量用 `@dramaticer/core/image-vocabulary`；core 主入口会带进 better-sqlite3，Vite 包会白屏。
- 验证：`pnpm check` 通过；`v5-image-profiles` 桌面/手机、`v4-lore`、`v4-prefs` 通过；`walk15` 桌面/手机截图已看。

## 下一步
1. `image-v2/02`（画面整理）：用 `matchTagLibraryEntries` 与 `expandVisualProfile` 组装整理输入与程序展开。
2. 设计与验收依据：`docs/proposals/v5.md` 第六节与 `.scratch/image-v2/issues/02-scene-prompter.md`。

## 眼下要注意
- 迁移版本 83；新增故事表要在 `story-store.ts` 的 DELEGATES 里登记，否则 `StoryStore` 上没有方法。
- server 与 e2e 读 core 的 `dist`：改了 core/st-compat 先 `pnpm run build` 再跑 e2e。
- `VisualProfileEditor` 保存时整体替换故事档案/服装/标签列表；全局标签只展示，不在替换范围。
- 智绘姬导入只按公开字段独立解析，不复制其提示词；未知分格形状直接报错，不静默丢弃。
- e2e 中一次导入的角色数与服装数以合成文件为准；改 fixture 时同步改断言。
- `.walk/` 不入库；走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts .walk/walk15.spec.ts`。
