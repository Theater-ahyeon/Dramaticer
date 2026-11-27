# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `card-ui/02`）。**M-D 呈现**：酒馆美化正则与助手脚本作为渲染插件。
- `st-compat/src/st-renderer/` 把卡里的显示层 `regex_scripts`（含预设 `regexScripts`）与启用的 `tavern_helper.scripts` 转成故事级渲染配置（`story_kv` 的 `st.compat.cardUi`）；core 不出现 ST 概念。
- 两个渲染器 id：`st-content-regex`（美化正则）与 `st-helper-host`（助手脚本）。助手开着时把正则与脚本合成同一个 iframe；只开正则时单独渲染。
- iframe 内的垫片把 `getVariables` 等映射到 `window.dramaticerBridge`，写入落 `mvu.*` 并经结算器；`eventOn`/`eventEmit` 在 iframe 内同步；`/send`、`/setinput`、`/trigger` 可用；`setChatMessages` 直接抛错。
- 渲染器记录新增 `enabled`；`POST /api/stories/:id/sandbox/renderers/:id` 开关声明式与 ST 渲染器，设定页「卡片脚本与联网」逐个开关，关掉两个后 `render` 返回空、正文走 `Prose`。
- 声明式 `floor-renderer.patterns` 支持 `/pattern/flags` 字面量。
- 验证：`pnpm check` 通过；`v5-card-ui` 桌面/手机（含新增 ST 卡状态栏与按钮、关插件回原文）、`v5-inspector`、`v4-lore`、`v4-story`；`walk14` 桌面/手机截图已看。

## 下一步
1. `image-v2/01`（分格视觉档案、服装与标签库）。
2. 设计与验收依据：`docs/proposals/v5.md` 对应章节与 `.scratch/<功能>/spec.md`。

## 眼下要注意
- 迁移版本仍是 82，`card-ui/02` 没有新迁移。
- server 与 e2e 读 core 的 `dist`：改了 core/st-compat 先 `pnpm run build`（或让 e2e 脚本构建）再跑 e2e。
- ST 渲染器的 iframe 里没有 jQuery；只保证 `document` 与垫片里的 API。卡脚本用 `$`/`jQuery` 时不会工作。
- 显示层正则命中后替换结果按 HTML 插入；未命中时原文转义显示。沙箱仍只隔离在 `allow-scripts` iframe 里，联网按故事允许名单。
- e2e 里 `page.request.post` 对这个合成卡的嵌套 JSON 曾出现空请求体，导入时显式 `Content-Type` + `JSON.stringify`。
- `v4-lore` 与 `v4-story` 在同一服务进程里连续跑时，`v4-story` 的规划阶段偶发观察不到「正文」（回合本身已提交）；两个 spec 单独跑都通过。与本工单改动无关，后续若再遇到先按 e2e 观察时序问题排查。
- `.walk/` 不入库；走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts .walk/walk14.spec.ts`。
