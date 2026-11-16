# 工单总览

> 规格与工单的约定见 `docs/agents/issue-tracker.md`。命名见仓库根目录 `GLOSSARY.md`。设计见 `docs/proposals/v4.md`（靠后的章节优先）。
> 一张工单是一条能独立验证的完整功能切片。按下面的顺序取第一张 `Status: ready-for-agent` 且依赖都已 `done` 的工单。
> **先核对现状**：W1–W7 阶段已经实现了自动记录、剧情线、大纲、分类导入等底座，工单里与之重合的部分直接复用。

## 推荐顺序

1. `director-yield`：改动小，直接修正已实现代码里干扰玩家的地方。
2. `ui` 01–02：外壳、书架、故事页，最先让人看到变化。
3. `memory`
4. `edit-everything`
5. `ui` 03–06
6. `writing-settings`
7. `ui` 07–08
8. `turn-modes`

## 功能与工单

### 导演不干扰玩家（`director-yield`）

| 工单 | 交付 | 依赖 |
|---|---|---|
| `director-yield/01` | 按内容判断玩家意图，不干预时什么都不加 | 无 |
| `director-yield/02` | 突发延后，节奏只在推进时生效 | 01 |
| `director-yield/03` | 玩家行动改写剧情线；默认值调整 | 01 |
| `director-yield/04` | 「这不是我要的」与干扰统计 | 01 |

### 记忆层（`memory`）

| 工单 | 交付 | 依赖 |
|---|---|---|
| `memory/01` | 记录只追加并挂上实体 | 无 |
| `memory/02` | 状态与秘密由记录算出 | 01 |
| `memory/03` | 按谁在场取用记忆 | 01 |
| `memory/04` | 百科页面由记录汇编，章末反思 | 01 |
| `memory/05` | 偏好来自纠正与重写原因 | 无 |
| `memory/06` | 本轮上下文的构成与来源 | 03 |

### 一切可改（`edit-everything`）

| 工单 | 交付 | 依赖 |
|---|---|---|
| `edit-everything/01` | 设定的故事副本与修改 | 无 |
| `edit-everything/02` | 记忆直接修改：校验、锁定、历史 | memory/02、memory/04 |
| `edit-everything/03` | 规划对象的出处、锁定与回滚 | 无 |

### 三种写法（`turn-modes`）

| 工单 | 交付 | 依赖 |
|---|---|---|
| `turn-modes/01` | 规划：固定阶段的一楼 | 无 |
| `turn-modes/02` | 提前备好 | 01 |
| `turn-modes/03` | 深度：起草、自查、修改、交稿 | 无 |
| `turn-modes/04` | 写法对照 | 01、03 |

### 写作与卡的配置（`writing-settings`）

| 工单 | 交付 | 依赖 |
|---|---|---|
| `writing-settings/01` | 原生写作选项与预设对应 | 无 |
| `writing-settings/02` | 卡的推荐配置与故事固定版本 | 无 |

### 新界面（`ui`）

| 工单 | 交付 | 依赖 |
|---|---|---|
| `ui/01` | 外壳、设计变量与书架 | 无 |
| `ui/02` | 故事页：正文、批注与输入台 | 01 |
| `ui/03` | 故事页停靠栏：导演、记忆、上下文 | 02、memory/06、director-yield/01 |
| `ui/04` | 记忆页 | 01、edit-everything/02 |
| `ui/05` | 大纲页 | 01 |
| `ui/06` | 设定页与导入检查 | 01、edit-everything/01 |
| `ui/07` | 设置页 | 01、writing-settings/01 |
| `ui/08` | 命令面板、手机端与整体验收 | 02、03、04、05、06、07 |

