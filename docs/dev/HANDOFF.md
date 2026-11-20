# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-19（人工会话，连续推进）。人类要求：先做完整 MVP 再慢慢优化，允许大改；做轻量、最美观的前端。
  - 之前已完成：`refactor/01`（v4 导演默认接通，ADR-0161）、`refactor/02` 大部分（ADR-0163）、DESIGN 重写为 v1.0、`ui-lite/01` 减重（ADR-0162）。
  - 本次 `ui-lite/02` 完成：`v4.css` 重写为「纸与墨」设计系统——亮是暖纸、暗是墨，朱砂是唯一强调色（主按钮、当前导航、当前分页、导演痕迹）；字号、行高、间距、圆角、时长都成了变量；去掉玻璃模糊、装饰渐变、渐变文字、入场动画、换页斜光、书架的模糊氛围图与章号水印；转场只留短淡入淡出。
  - `styles.css` 删掉 `:root` 与 14 个无人用的类的规则；其余旧面板样式留给 `ui-lite/05`。
  - 设置页「写作」分页第一行加「外观：跟随系统 / 亮 / 暗」，与导航栏主题按钮通过 `stage.onThemeChange` 同步（手机上只有这里能改）。GLOSSARY 加了「外观」。
  - 新测试 `packages/web/test/design-tokens.test.ts`：两套主题文字 AA、两处暗色定义一致、没有 backdrop-filter、CSS gzip ≤ 40 KB。
  - 接着 `ui-lite/03` 完成：书页排版（18px、1.9 倍行高、1440px 每行 30–38 字、对话段顶格，`v4/prose.ts`）、批注页边常驻且手机上折叠为楼末「批注 N」、「正在写」状态、输入台层级；手机上停靠栏是底部抽屉，打字或抽屉打开时收起底部导航；停靠栏宽 372 → 340px。
- 门禁：`pnpm check` 2828 通过；`pnpm e2e` 72 通过（2 个实时试玩照旧跳过）。构建 CSS 19.5 → 约 16 KB gzip。
- 仍在分支 `spec/v4-remaining`，没有合并到 `main`。

## 下一步
1. `ui-lite/04`：书架、记忆、大纲、设定、设置统一到新设计（书架统计数字的等宽粗体偏重，可在这里调）。
2. `ui-lite/05`：旧面板换皮并删 `styles.css`（里面还有写死的 `#fff` 等颜色，暗色下会不协调）。
3. `refactor/03`（后台渠道保底）、`refactor/04`（北极星指标）；`refactor/02` 剩余：文风层注入位置、本轮临时开关。

## 眼下要注意
- 新样式直接用新变量名（`--cinnabar`、`--sheet`、`--t-*`、`--s-*`、`--r-*`）；`--gold*`、`--teal` 只是给旧规则的别名。改颜色要同时改两处暗色定义，测试会比对。
- 已有故事保存的 `directorOrganization` 不迁移，仍是 `mechanisms`。
- 伏笔上限只看功能页（`readStoryPromiseLimit`），`directorConfig.maxOpenPromises` 不再生效。
- server 读的是 core 的 `dist`：改了 core 导出后先 `pnpm --filter @dramaticer/core run build`。
- 手机上停靠栏的 e2e 要先 `openDock`；单跑 e2e 前先构建 web（Playwright 用 dist）。
- 截图验收：临时写一个 `e2e/*.spec.ts` 用 `page.emulateMedia({ colorScheme })` 截亮暗两套，跑完删掉。
