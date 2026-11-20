# 02：酒馆美化正则与助手脚本作为渲染插件

**What to build:** `st-content` 美化正则（显示层）与 `st-helper-host` 接入扩展点：卡的状态栏、选项面板在故事页原样显示并可点击。

**Blocked by:** card-ui/01

**Status:** ready-for-agent

- [ ] 合成卡片的状态栏与按钮在故事页可见、可点
- [ ] 关掉插件后回到纯文本显示
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/card-ui/spec.md`；方案：`docs/proposals/v5.md`

## Comments
