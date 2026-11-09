# 预设观察与开发建议（2026-11-09）

只看结构与配置，不复制提示词正文、脚本正文或聊天内容。私有预设与脚本本身不进入仓库。

## 观察对象

| 来源 | 文件 | 时间 | 形态 |
|---|---|---|---|
| TauriTavern `OpenAI Settings` | `Izumi1029.json` | 2026-11-08 | 239 条 prompt manager 条目，67 条启用；32 条 regex 脚本；`SPreset` 与 `tavern_helper` 扩展 |
| TauriTavern `OpenAI Settings` | `v0.82_-_2.json` | 2026-10-27 | 103 条条目，37 条启用；14 条 regex 脚本 |
| TauriTavern `OpenAI Settings` | `Reborn2.3-2.json` | 2026-10-16 | 68 条条目，36 条启用；13 条 regex 脚本；两个 `prompt_order` 组 |
| `E:/webdownload` | `-wxhl-cg.json` | 2026-11-08 | `type: script`，TavernHelper 脚本导出，约 74k 字符 |
| `E:/webdownload` | `酒馆助手-酒馆优化.json` | 2026-11-08 | `type: script`，TavernHelper 脚本导出，约 23k 字符 |

`E:/webdownload/high-codex-*.json` 是服务账号凭证，未读取、未使用。

## 结构观察

- **prompt manager 是主要扩展面**：三份预设分别有 239、103、68 条条目，启用比例约 28%、36%、53%；条目角色以 system 为主，另有 user 与 assistant；注入深度集中在 0 与 4；`marker` 用来标识世界书前/后、聊天历史、角色定义等固定位置。
- **顺序与分组**：`prompt_order` 按角色卡分组，条目顺序决定上下文顺序；`Reborn2.3-2` 有两个顺序组。
- **可选功能成组**：大量条目是互斥或成组开关（文风、人称、难度、NSFW 风格、防抢话/抢话等），预设本身就是一套可配置的 prompt 程序。
- **正则与脚本是第二层**：regex 脚本 13–32 条；`tavern_helper` 保存脚本与变量；`SPreset` 扩展包含 `ChatSquash`、`MessageInjections`、`OutputPreprocessing`、`RegexBinding`、`ToolBindings`、`MacroNest`。
- **生成参数偏长上下文**：`openai_max_tokens` 30k–65k，`openai_max_context` 2,000,000；`reasoning_effort` 为 low/medium/high；`function_calling` 有的开启、有的关闭；`tool_call_recurse_limit` 为 5。
- **上下文卫生选项**：`squash_system_messages` 有开有关；`strip_old_tool_calls` 关闭；`show_thoughts` 开启；`continue_prefill` 开启且 `continue_postfix` 为空格；`media_inlining` 有开有关。
- **WebDownload 的两份最新文件是脚本，不是 prompt preset**：它们属于酒馆助手/酒馆优化类脚本，不能直接当作上下文模板导入。

## 开发建议

### 1. st-compat 预设导入器与兼容报告（优先）

- **做什么**：新增 `preset-import` 入口，把 ST 的 prompt manager 条目转换为 `ContextTemplate` 段落；保留条目顺序、分组、启用状态、角色、`marker`、注入深度与条件；对无法映射的字段输出兼容报告，而不是静默丢弃。
- **为什么**：三份最新预设的规模都在 68–239 条，手工重建不现实；兼容报告能让用户看到哪些条目没有生效。
- **位置**：`packages/st-compat`；核心模板只接收转换后的段落，不引入 ST 语义（I15）。
- **验收**：同一预设导入两次得到相同模板；启用/禁用状态与顺序一致；未知字段进入报告；不修改原始预设文件。

### 2. 兼容层的深度注入与角色映射

- **做什么**：把深度 0/4 的条目映射到历史尾部、系统消息或用户消息末尾；把 `marker` 映射到核心槽位（世界书前/后、聊天历史、角色定义等）；未识别的 marker 进入兼容报告的“尾部注入”分组。
- **为什么**：观察到的条目绝大多数在深度 0 或 4，且有 system/user/assistant 三种角色；只按固定槽位映射会丢掉大量预设行为。
- **位置**：`packages/st-compat` 的模板转换层；core 只提供通用的尾部注入能力（如果现有 `suffix` 不够，再评估是否扩展模板段）。
- **验收**：深度 4 的 system/user/assistant 条目分别落在预期位置；原文与顺序不变；报告列出无法映射的深度与角色组合。

### 3. 历史视图的上下文卫生策略

- **做什么**：在 `historyBlockPolicy` 之外增加两个可选策略：合并旧的 system 消息；从更早楼层省略工具调用与工具结果，只保留最近 N 轮。
- **为什么**：预设普遍使用 `squash_system_messages` 与 `strip_old_tool_calls` 控制长上下文；深回合积累的工具往返会迅速吃预算。
- **位置**：core 的历史视图与 Trace；策略默认关闭，按故事设置开启。
- **验收**：关闭时与现有渲染逐字节一致；开启后最近 N 轮保留工具调用；Trace 记录省略条数与原因。

### 4. 续写策略（prefill、nudge、postfix）

- **做什么**：为支持预填充的渠道增加“以助手前缀续写”的模式；不支持时退回 nudge 文本。把继续指令、前缀与后缀做成渠道/故事配置，并写入 Trace。
- **为什么**：最新预设开启 `continue_prefill`，`continue_postfix` 使用空格；续写质量与渠道能力直接相关。
- **位置**：core 的 LLM 请求与渠道适配器；文本协议与原生工具共用。
- **验收**：支持预填充的渠道收到助手前缀；不支持的渠道收到 nudge；中止后的续写不重复正文；Trace 记录实际模式。

### 5. 思考显示与预算

- **做什么**：每个故事增加“显示思考”开关；思考块在显示视图可折叠，在 prompt 视图仍按现有策略删除；把 `reasoning` 档位映射到可读的预算说明。
- **为什么**：三份预设都开启 `show_thoughts`，并使用 medium/high 思考；用户需要看到思考是否按预期发生，而不把它塞回上下文。
- **位置**：web 聊天页与故事设置；core 已有 `thinking` 块与上下文策略。
- **验收**：关闭时思考块不显示；开启时折叠显示；prompt 视图不受显示开关影响。

### 6. 正则与酒馆助手脚本的沙箱兼容

- **做什么**：C 线 `st-content` / `st-helper-host` 插件按 DESIGN §19 落地；正则只做显示与 prompt 变换，不修改原文；脚本在沙箱里运行，权限声明并展示；未声明的调用直接拒绝并记录。
- **为什么**：最新预设带 13–32 条 regex 脚本与 `tavern_helper` 脚本；WebDownload 的两份最新文件也是脚本导出。没有这层，预设只能部分还原。
- **位置**：`packages/st-compat` 的兼容插件；遵守 I16–I18。
- **验收**：用合成 fixture 覆盖正则替换、变量、显示与 prompt 两种作用域；脚本超时跳过并写 Trace；越权调用被拒绝；原文不变。

### 7. 预设 linter 与互斥组

- **做什么**：检查启用条目的 token 规模、互斥组（同一组里多选）、未知 marker、重复条目与禁用但被引用的条目；输出可读报告。
- **为什么**：预设里有大量“三选一/选一”开关，手工检查容易漏；导入前先体检能减少无效上下文。
- **位置**：`packages/st-compat` 的 CLI；与预设导入共用解析器。
- **验收**：合成预设能检出多选互斥组、未知 marker 与重复条目；报告不包含正文。

## 建议顺序

1. 预设导入器与兼容报告（先让结构可读、可导入）。
2. 深度注入与角色映射（让导入的条目真正生效）。
3. 历史视图的上下文卫生策略（长对话收益直接）。
4. 续写策略与思考显示（生成质量与可见性）。
5. 正则/脚本沙箱（工作量大，依赖 C 线插件）。
6. 预设 linter（可与 1 一起做）。

这些建议不改变 core 的数据模型，也不把 ST 语义带进 core；实现时按 `docs/DESIGN.md` §19 与 I15、I16–I18 执行。
