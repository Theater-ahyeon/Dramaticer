# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-28（真卡导入与端到端体验修复）。围绕真实角色卡导入、楼层沙箱渲染、AI 回复清洗与 v4/v5 桌面/移动端界面细节完成以下修复：
  - **角色卡与世界书导入全通**：放宽 `lore` 审计对停用/无名/空内容条目的校验（与 `st-compat` 审计语义对齐）；`entity-import` 跳过标点分隔线条目名；故事/卡片/世界书/原著导入放宽单包体上限至 128 MB 并增加 `POST /api/stories/from-card` 事务化原子接口，避免导入失败留下 0 楼孤儿故事。
  - **酒馆卡片前端与沙箱渲染**：`st-renderer` 先用 `BlockParser` 剔除内部写入/隐藏块并清理未消费 MVU 标签，拆开 Markdown ````html` 围栏与外层文档壳，在纯文本间隙保持换行同时给 HTML 容器切回 `white-space: normal` 消除大块空白；`shim.ts` 改为逐段隔离执行脚本并用 `<script type="module">` 承载 ESM 脚本，避免单个模块导入报错拖垮后续脚本；`floor-sandbox` 支持触发延迟登记的 `DOMContentLoaded` 回调与内联 `<script>` 激活。
  - **场面卡修复与交互打磨**：`scene-log` 在开新场缺少 `sceneCard` 时按在场人物与本楼变化自动补齐并记入 `repairs`；`direction/view` 空核心问题默认未锁定；`Inspector` 仅在非快速模式请求 `run` 详情（消除快回合 404）；`Shell` 校验缓存故事有效性并对齐 `助`/`检` 按钮外观；修正窄屏（390px）横向裁切、推进/故事菜单自动关闭、Dock 记忆空态与上下文图例、`Library`/`Memory`/`Lore`/`Prefs`/`GlobalSettings` 展示细节。
- 实卡试玩与复测：`150/150` 张真实角色卡校验通过；两张多脚本高复杂度实卡经界面导入并完成实时模型回合与桌面/移动截图复核，全量 `pnpm check` 与 `pnpm e2e` 通过。

## 下一步
1. 没有待做的开发工单。`.scratch/refactor/issues/07-eval-package.md` 按人类指示（`2026-11-19`「暂时不用评测」）继续延后。
2. 人类填入 `NOVELAI_API_KEY` 后跑一次 `pnpm vitest run packages/core/test/novelai.live.test.ts`，核对 `image-v2/03` 的 live 验收项。
3. 后续进入真卡长线试玩（100+ 楼北极星指标）与 `.scratch/PARKED.md` 中的 Post-MVP 事项。

## 眼下要注意
- server 与 e2e 读取 `core`/`protocol`/`st-compat` 的 `dist`；修改上述包后需先构建再单独跑 e2e（`pnpm e2e` 会自动触发完整构建）。
- e2e 共享同一个后台 `BackgroundScheduler`：在测试里直接向 SQLite 写入已结算内容（如 `scene_logs`）时，需一并写入对应的 `done` 状态 `background_jobs` 记录，避免后台队列重复覆盖。
