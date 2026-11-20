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
  - 接着 `ui-lite/04` 完成：书架改为卡面封面网格，「继续上次」统计去框；数字用界面字体等宽数字；`Editable` 加 `placeholder`；分组标题统一字号。
  - 接着 `ui-lite/05` 完成：删除 `styles.css`，旧面板样式变成 `v4/panels.css`（`v4.css` 开头 `@import`），颜色全换成设计变量，分组框、标题、候选行动、文件按钮统一。
  - 接着 `ui-lite/06` 完成：`packages/web/scripts/budget.mjs` 接在 `pnpm e2e` 构建后（当前首屏 JS 169.4 / 200 KB、CSS 15.4 / 40 KB）；`e2e/v4-a11y.spec.ts` 验键盘主流程与减少动效；记忆页就地编辑支持回车提交、Esc 放弃。**ui-lite 01–06 全部完成。**
- 门禁：`pnpm check` 2833 通过；`pnpm e2e` 75 通过（3 个跳过：2 个实时试玩、手机上的键盘用例）。构建 CSS 19.5 → 约 16 KB gzip。
- 仍在分支 `spec/v4-remaining`，没有合并到 `main`。

## 下一步
1. `refactor/03`（后台渠道保底）、`refactor/04`（北极星指标）。
2. `refactor/02` 剩余：文风层注入位置、本轮临时开关（回合请求传 `turnOverrides`）。
3. 查 `e2e/ledger.spec.ts` 的偶发失败。

## 眼下要注意
- 新样式直接用新变量名（`--cinnabar`、`--sheet`、`--t-*`、`--s-*`、`--r-*`）；`--gold*`、`--teal` 只是给旧规则的别名。改颜色要同时改两处暗色定义，测试会比对。
- 已有故事保存的 `directorOrganization` 不迁移，仍是 `mechanisms`。
- 伏笔上限只看功能页（`readStoryPromiseLimit`），`directorConfig.maxOpenPromises` 不再生效。
- server 读的是 core 的 `dist`：改了 core 导出后先 `pnpm --filter @dramaticer/core run build`。
- `e2e/ledger.spec.ts` 偶发失败（`.ledger-event` 没出现，后台抽取时序），`--repeat-each=3` 时第三次必挂，ui-lite/05 之前就如此；全量跑偶尔撞上，重跑即过。值得单独查。
- 手机上停靠栏的 e2e 要先 `openDock`；单跑 e2e 前先构建 web（Playwright 用 dist）。
- 截图验收：临时写一个 `e2e/*.spec.ts` 用 `page.emulateMedia({ colorScheme })` 截亮暗两套，跑完删掉。
