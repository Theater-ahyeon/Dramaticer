# 01：楼层渲染器扩展点与沙箱

**What to build:** 插件内核新增楼层渲染器扩展点；故事页按插件结果渲染沙箱 iframe（自适应高度、主题变量传入）；交互桥白名单与拒绝记录。

**Blocked by:** ui-v2/02

**Status:** ready-for-agent

- [ ] 一个合成插件在 e2e 里渲染按钮，点击后发送一条消息
- [ ] 未声明的调用被拒绝并出现在检视器
- [ ] 沙箱默认禁止联网；导入卡时列出脚本里的域名，玩家逐个允许，名单存在故事上
- [ ] 被拒绝的网络请求记入检视器
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/card-ui/spec.md`；方案：`docs/proposals/v5.md`

## Comments
