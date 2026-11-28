# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-28（全站截图评审修复与 GitHub 同步收口）。完成桌面/暗色/手机端 30 张整站截图采集与两轮独立评审，汇总修复并跑通全量门禁与 E2E：
  - **故事页与停靠栏**：`Play.tsx` 动态同步 `#sheet` 高度至 `--cmp-h`、写入态挂载 `data-writing`、精简 `.sandbox-notice` 并支持放行全部拦截域名、补空楼层提示、推进菜单步进提示与勾选态、`⋯` 菜单按「写法与开关」「场景跳转」分组；`Dock.tsx` 补全 `--ctx-*` 深色与亮色语义色板及上下文总量显示（遵守一级界面不出现 `token` 规则）。
  - **外壳、助手与暗色一致性**：`Shell.tsx` 将主题点替换为太阳/月亮 SVG 图标，移动端底栏新增「⋯」工具抽屉（外观/助手/检视器）；`AssistantDrawer.tsx` 新增遮罩层、右上关闭按钮与空状态「新建一个会话」入口；`v4.css`/`panels.css` 修复 `.progress` 与 `.total` 粘滞/贯穿问题及移动端芯片条横向滚动。
  - **工具与子页面**：`Memory.tsx` 清洗百科首段 `{{//...}}` 与外层标签展示；`CanonBook.tsx` 将删除原著按钮收进顶栏、补全拆分条件与抽取前置说明；`Prefs.tsx`/`AdvancedSettings.tsx`/`ImageSettings.tsx`/`Library.tsx`/`ChannelWizard.tsx`/`NewStoryDialog.tsx`/`Direction.tsx`/`ui.tsx` 统一 `.btn` 按钮层次、开关禁用态、生图文件先选后导入流程与毫秒分钟换算提示。
- 验证：`pnpm check`（1001 files lint + invariants + typecheck + 2582 unit passed）与 `pnpm e2e` 全绿通过。

## 下一步
1. 没有待做的开发工单。`.scratch/refactor/issues/07-eval-package.md` 按人类指示（`2026-11-19`「暂时不用评测」）继续延后。
2. 人类填入 `NOVELAI_API_KEY` 后跑一次 `DRAMATICER_LIVE=1 pnpm vitest run packages/core/test/novelai.live.test.ts`，核对 `image-v2/03` 的 live 验收项。
3. 后续 UI/UX PR 细化建议（可交由协作 agent 提 PR）：`floor-sandbox.ts` 拦截外链图片时回退为单行文本提示；`Inspector.tsx` 沙箱 URL 换行与同域合并；`.subtabs` 动效与 `/outline` `/memory` 空表对齐；`Library` 封面首屏单字占位与 `top center` 裁剪；移动端 `.opts` 换行/渐变遮罩与底栏「更多」收纳。

## 眼下要注意
- server 与 e2e 读取 `core`/`protocol`/`st-compat` 的 `dist`；修改上述包后需先构建再单独跑 e2e（`pnpm e2e` 会自动触发完整构建）。
- e2e 共享同一个后台 `BackgroundScheduler`：在测试里直接向 SQLite 写入已结算内容（如 `scene_logs`）时，需一并写入对应的 `done` 状态 `background_jobs` 记录，避免后台队列重复覆盖。
