# 01：楼层渲染器扩展点与沙箱

**What to build:** 插件内核新增楼层渲染器扩展点；故事页按插件结果渲染沙箱 iframe（自适应高度、主题变量传入）；交互桥白名单与拒绝记录。

**Blocked by:** ui-v2/02

**Status:** done

- [x] 一个合成插件在 e2e 里渲染按钮，点击后发送一条消息
- [x] 未声明的调用被拒绝并出现在检视器
- [x] 沙箱默认禁止联网；导入卡时列出脚本里的域名，玩家逐个允许，名单存在故事上
- [x] 被拒绝的网络请求记入检视器
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/card-ui/spec.md`；方案：`docs/proposals/v5.md`

## Comments
- 完成：2026-11-27 插件内核楼层渲染器扩展点与声明式 `floor-renderer`、故事页主题自适应沙箱与交互桥白名单（`writeState` 经台账校验）、故事级联网允许名单与脚本域名检测、迁移 82 的沙箱拒绝记录与检视器展示；`pnpm check`、`v5-card-ui` 桌面/手机、`v5-inspector`、`v4-lore`、`v4-story` 与 `walk13` 走查通过。
