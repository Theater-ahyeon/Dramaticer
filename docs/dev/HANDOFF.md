# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `card-ui/01`）。**M-D 呈现开始**：楼层渲染器扩展点与沙箱已交付。
- 插件内核新增 `floorRenderer` 扩展点与 `renderFloor`；声明式插件新增 `floor-renderer`，模板里的 `{{content}}` 用转义后的楼层原文替换。
- 迁移 82：`sandbox_rejections`（交互桥越权与被拦的联网请求）。允许名单、检测结果与故事上的渲染器存在 `story_kv` 的 `sandbox.*`，默认全部不联网。
- 导入卡时安装 `extensions.dramaticer.plugins` 里的楼层渲染器，并扫描整张卡的 http/https 域名；设定页「卡片脚本与联网」逐个允许，检视器「沙箱拒绝」看记录。
- 故事页：`POST /api/stories/:id/render` 返回片断，`FloorFrame` 用 `sandbox="allow-scripts"` iframe 显示；主题变量与 `data-theme` 传入，高度由 iframe 上报；交互桥五个方法同时受白名单与渲染器 `permissions` 限制，`writeState` 经台账校验后写入。
- 浏览器安全的子入口是 `@dramaticer/core/sandbox`（能力白名单、域名扫描、CSP）。不要从 core 主入口取这些工具，会把 better-sqlite3 带进首屏。
- 验证：`pnpm check` 通过；`v5-card-ui` 桌面/手机、`v5-inspector`、`v4-lore`、`v4-story` 通过；`.walk/walk13.spec.ts` 桌面/手机截图已看。

## 下一步
1. M-D 呈现：`card-ui/02`（酒馆美化正则与助手脚本作为渲染插件），然后 `image-v2/01`（分格视觉档案、服装与标签库）。
2. 设计与验收依据：`docs/proposals/v5.md` 对应章节与 `.scratch/<功能>/spec.md`。

## 眼下要注意
- 迁移版本现在是 82；`assistant-store.test.ts` 的断言已同步。
- server 与 e2e 读 core 的 `dist`：改了 core 先 `pnpm run build` 再跑 e2e。
- 改前端运行时 import 前先看它会不会拉进 core 主入口；`@dramaticer/core/sandbox` 是唯一安全的沙箱子入口。
- 楼层渲染器只在有块类型或正则认领时生效；渲染器抛错/超时会被跳过并进 `failures`，正文仍走原生 `Prose`。
- e2e 手机端点过 iframe 后焦点在沙箱里，父页面快捷键收不到；用输入台的「写法与本轮设置 → 检视器」按钮。
- `.walk/` 不入库；走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts .walk/walk13.spec.ts`。
