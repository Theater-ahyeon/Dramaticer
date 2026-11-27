# 02：酒馆美化正则与助手脚本作为渲染插件

**What to build:** `st-content` 美化正则（显示层）与 `st-helper-host` 接入扩展点：卡的状态栏、选项面板在故事页原样显示并可点击。

**Blocked by:** card-ui/01

**Status:** done

- [x] 合成卡片的状态栏与按钮在故事页可见、可点
- [x] 关掉插件后回到纯文本显示
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/card-ui/spec.md`；方案：`docs/proposals/v5.md`

## Comments

完成：2026-11-27 显示层 `regex_scripts`（含预设 `regexScripts`）与启用的 `tavern_helper.scripts` 转成 `st-content-regex` / `st-helper-host` 两个故事级渲染插件，助手开着时与正则合成同一个 iframe；变量经 `mvu.*` 与结算器，按钮走 iframe 内事件总线；设定页可逐个开关，关掉后回到 `Prose`。`pnpm check` 通过；`v5-card-ui` 桌面/手机、`v5-inspector`、`v4-lore`、`v4-story` 分别通过，`walk14` 桌面/手机截图已看。注意：`v4-lore` 与 `v4-story` 在同一服务进程里连续跑时，`v4-story` 的规划阶段偶发观察不到「正文」（回合本身已提交）；单独跑通过，与本工单改动无关。
