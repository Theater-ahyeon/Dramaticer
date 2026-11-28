# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-28（交互链路完善与暗色/移动端修复，第 2 轮收口）。在真卡导入与沙箱渲染修复后继续排查并完善交互细节：
  - **故事重命名与安全移出书架**：新增迁移 v86（`stories.archived_at`），`StoryStore.archiveStory` 与 `DELETE /api/stories/:id` 在不触碰只追加表 `BEFORE DELETE` 触发器的前提下支持安全移出已产生楼层的故事；故事页「⋯」菜单补齐内联「重命名」「移出书架（二次确认）」「助手（移动端可达）」与修复后的 `/stories/:id/prefs` 跳转。
  - **楼层阅读与沙箱内联控制**：`Play` 增加 `.sandbox-notice`（拦截外部资源时当场提供一键放行域名或前往 `/stories/:id/lore` 设定）及 `FloorFrame` 按允许域名重建沙箱；`.opening` 按钮改为明确描边样式；`.flr-acts` 默认半透明可见、`.lock` 改为胶囊态；`#script` 增加底部留白与 `scroll-margin-bottom` 避免输入台遮挡最新段落；`.lead` 保留换行与空白可编辑区虚线提示。
  - **暗色模式与移动端细节**：`floor-sandbox` 补齐 `color-scheme` 与父页主题同步，消除暗色模式下 srcdoc iframe 出现白底白字的问题；移动端「⋯」故事菜单左对齐防出界、助手搜索按钮单行显示、无效故事 404 提供返回书架入口。
- 验证：实时浏览器试玩与暗色/移动端截图复核通过，最终全量 `pnpm check` 与 `pnpm e2e` 零失败通过。

## 下一步
1. 没有待做的开发工单。`.scratch/refactor/issues/07-eval-package.md` 按人类指示（`2026-11-19`「暂时不用评测」）继续延后。
2. 人类填入 `NOVELAI_API_KEY` 后跑一次 `pnpm vitest run packages/core/test/novelai.live.test.ts`，核对 `image-v2/03` 的 live 验收项。
3. 后续进入真卡长线试玩（100+ 楼北极星指标）与 `.scratch/PARKED.md` 中的 Post-MVP 事项。

## 眼下要注意
- server 与 e2e 读取 `core`/`protocol`/`st-compat` 的 `dist`；修改上述包后需先构建再单独跑 e2e（`pnpm e2e` 会自动触发完整构建）。
- e2e 共享同一个后台 `BackgroundScheduler`：在测试里直接向 SQLite 写入已结算内容（如 `scene_logs`）时，需一并写入对应的 `done` 状态 `background_jobs` 记录，避免后台队列重复覆盖。
