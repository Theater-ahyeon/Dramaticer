# 规格：卡片前端渲染（`card-ui`）

> 来源：2026-11-20 人类要求「通过插件实现原本角色卡的前端渲染与点击操作，而不是解析出字符」。现状：`SandboxBlock` 与 `buildStHelperSandboxDocument` 已实现但没有接进故事页。

- 原生扩展点「楼层渲染器」：插件声明认领的块或正则，返回在 `sandbox="allow-scripts"` iframe 里运行的内容（I8：从原文派生，不改原文）。
- 交互桥只开放白名单：发送消息、填入输入框、读变量、经结算器写变量（I16、I18；未声明的调用拒绝并记录）。
- `st-content` 的美化正则与 `st-helper-host` 作为第一个渲染插件接入；core 不出现 ST 概念（I1、I15）。
