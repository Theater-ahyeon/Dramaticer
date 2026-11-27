# 声明式插件格式

声明式插件是纯 JSON 数据：台账字段、剧情小节、原生模板、块渲染器、技能、导演配置与事件池都以数据描述，不包含函数、类实例或其他可执行内容。解析入口 `parseDeclarativePlugin`、`parseDeclarativePlugins` 与 `parseDeclarativeRequirements` 从 `@dramaticer/core` 导出，卡片导入走同一个入口。

解析器对每个对象做严格校验：未知字段、类型不符、空字符串与重复名称都会抛错，错误信息带上 JSON 路径（例如 `declarativePlugin.payload.fields[0].type`）。字符串字段会去掉首尾空白后再校验；去掉后为空即拒绝。

## 外壳字段

| 字段 | 必填 | 规则 |
|---|---|---|
| `format` | 是 | 固定为 `dramaticer.plugin` |
| `formatVersion` | 是 | 固定为 `1`；不认识的版本直接拒绝 |
| `name` | 是 | 插件名，只含小写字母、数字、`.`、`_`、`-`，并以字母或数字开头 |
| `version` | 是 | 插件自身版本，形如 `1.2.3` 或 `1.2.3-beta.1` |
| `kind` | 是 | `ledger-schema`、`plot-beat`、`context-template`、`block-renderer`、`floor-renderer`、`skill`、`director-config`、`event-pool` 之一 |
| `title` | 否 | 展示标题，非空字符串 |
| `description` | 否 | 说明文字，非空字符串 |
| `payload` | 是 | 由 `kind` 决定的结构，见下一节 |

外壳只接受上表字段。一组插件里出现重名时整组拒绝，后加载的插件不会静默覆盖前一个。

```json
{
	"format": "dramaticer.plugin",
	"formatVersion": 1,
	"name": "example.dialogue-craft",
	"version": "1.0.0",
	"kind": "skill",
	"payload": {
		"name": "对白分寸",
		"description": "判断一句对白是否符合人物当下的处境。",
		"content": "# 对白分寸\n\n- 人物只说他知道的事。\n"
	}
}
```

## 八种负载

### `ledger-schema` 台账字段

- `namespace` 取十个台账命名空间之一：`character`、`relation`、`item`、`scene`、`time`、`clue`、`knowledge`、`userWill`、`mvu`、`rule`。
- `fields` 必须是非空数组；`path` 是相对命名空间的非空字符串数组，空白路径段与重复路径都拒绝。

| 字段类型 | 允许的约束 |
|---|---|
| `string` | 可选 `maxLength`，正整数，按码点计数 |
| `number` | 可选 `min`、`max`，有限数字，且 `min` 不得大于 `max` |
| `integer` | 与 `number` 相同；声明层不额外区分整数 |
| `boolean` | 不接受额外约束 |
| `enum` | 必须给非空且不重复的 `values`，每项是非空字符串；不接受其他约束 |
| `string-array` | 不接受额外约束 |

字段约束只描述值本身；真正写入仍然经过结算器的 `validateLedgerDiff`（I12）。声明式插件不能绕过校验路径直接写状态。

```json
{
	"namespace": "character",
	"fields": [
		{ "path": ["境界"], "type": "enum", "values": ["炼气", "筑基", "金丹"] },
		{ "path": ["修为"], "type": "integer", "min": 0, "max": 100 },
		{ "path": ["称号"], "type": "string", "maxLength": 20 },
		{ "path": ["法器"], "type": "string-array" },
		{ "path": ["已故"], "type": "boolean" }
	]
}
```

### `plot-beat` 剧情小节

| 字段 | 必填 | 规则 |
|---|---|---|
| `id` | 是 | 非空字符串 |
| `title` | 是 | 非空字符串 |
| `text` | 是 | 非空字符串 |
| `preconditions` | 否 | 省略或 `null` 表示无条件；否则是条件表达式 |

### `context-template` 原生模板

负载直接是 `ContextTemplate`：`id`、非空的 `segments`，可选 `deepTurn`。

- 每个片段有唯一的 `id`，`priority` 是有限数字，`when` 是可选条件。
- `kind` 为 `static` 时 `text` 必须非空；为 `slot` 时 `slot` 取已注册槽位：`lore`、`character`、`persona`、`summary`、`state`、`situation`、`world_index`、`pages`、`memory`、`history`、`scene`、`profile`、`reunion`、`scene_card`、`blueprint`、`director`、`user_will`、`protocol`。
- `id` 为 `protocol` 的写作契约片段必须排在最后。
- `deepTurn` 只允许 `tools`、`maxToolCalls`、`maxDurationMs`、`notesEnabled`。`tools` 是深回合工具名的子集，不能重复，未知工具名直接拒绝；`notesEnabled` 为 `false` 时 `tools` 不能含 `note_read` 或 `note_write`。

深回合工具名：`memory_search`、`lore_lookup`、`state_get`、`ledger_read`、`history_read`、`note_read`、`note_write`、`ledger_write`、`draft_write`、`commit_draft`。

```json
{
	"id": "example.template",
	"segments": [
		{ "id": "character", "kind": "slot", "slot": "character" },
		{ "id": "style", "kind": "static", "text": "只用一句话描写。", "priority": 5 },
		{ "id": "protocol", "kind": "static", "text": "遵守写作契约。" }
	],
	"deepTurn": { "tools": ["state_get", "note_read"], "maxToolCalls": 10 }
}
```

### `block-renderer` 块渲染器

| 字段 | 规则 |
|---|---|
| `block` | 标签名，非空，不能包含 `<`、`>`、`/` 或空白 |
| `display` | `{ "kind": "html", "template": "非空" }`、`{ "kind": "native", "component": "非空" }` 或 `{ "kind": "hidden" }` |
| `context` | `{ "kind": "keep" }`、`{ "kind": "drop" }`、`{ "kind": "keep-depth", "depth": 正整数 }` 或 `{ "kind": "compress" }` |

负载没有语义处理器：声明式块渲染器只影响显示与进 prompt 的方式，不解析字段、不写台账、不修改楼层原文（I4、I8）。`html` 模板在沙箱 iframe 里渲染，`{{content}}` 是块内原文。

```json
{
	"block": "状态栏",
	"display": { "kind": "html", "template": "<dl class=\"status-bar\">{{content}}</dl>" },
	"context": { "kind": "keep-depth", "depth": 2 }
}
```

### `floor-renderer` 楼层渲染器

| 字段 | 规则 |
|---|---|
| `id` | 渲染器 id，可选；省略时用插件名，同一个故事里不能重复 |
| `name` | 显示名，非空字符串 |
| `blockTypes` | 认领的块类型名数组，例如 `["状态栏"]` |
| `patterns` | 认领的正则源码数组，不带标志；与 `blockTypes` 至少提供一个 |
| `permissions` | 交互桥权限，只能取 `sendMessage`、`fillInput`、`readState`、`writeState`、`openImage` |
| `template` | 非空 HTML 模板，`{{content}}` 换成转义后的楼层原文 |
| `script` | 可选，在沙箱里执行的脚本正文 |
| `style` | 可选，在沙箱里追加的样式 |

楼层渲染器认领整层，在一个 `sandbox="allow-scripts"` 的 iframe 里显示，只派生显示内容，不修改楼层原文（I4、I8）。没有声明的交互桥方法调用会被拒绝并记进检视器；沙箱默认不联网，允许域名由玩家在故事的设定页逐个打开。

```json
{
	"id": "status-bar",
	"name": "状态栏",
	"blockTypes": ["状态栏"],
	"permissions": ["sendMessage"],
	"template": "<dl class=\"status-bar\">{{content}}</dl>",
	"script": "document.querySelector('button').addEventListener('click', function () { dramaticerBridge.sendMessage('继续'); });"
}
```

### `skill` 技能

| 字段 | 规则 |
|---|---|
| `name` | 技能名，非空字符串 |
| `description` | 一句话说明，非空字符串 |
| `content` | `SKILL.md` 正文，非空字符串，按原文保存 |

技能是提示词素材；它不注册工具，也不在回合内执行代码。

### `director-config` 导演配置

负载是 `{ "config": { ... } }`。`config` 只允许下列键；未出现的键沿用默认值，合并后的完整配置再统一校验，因此 `tensionEscalate` 必须小于 `tensionClimax`，三个张力权重之和必须大于 0。

| 键 | 默认值 | 规则 |
|---|---|---|
| `mode` | `transparent` | `off`、`transparent`、`blind` |
| `clueAgeWarning` | `12` | 非负整数 |
| `maxOpenClues` | `5` | 正整数 |
| `maxOpenPromises` | `5` | 非负整数；未兑现伏笔的上限，满了不再新建 |
| `chapterFloors` | `20` | 正整数；距上一次章末规划积累多少助手楼层后在间隙做一次章级规划 |
| `stallFloors` | `3` | 正整数 |
| `surprise` | `1` | 0 到 1 的数字 |
| `similarityThreshold` | `0.73` | 0 到 1 的数字 |
| `similarityWindow` | `20` | 不小于 2 的整数 |
| `similarityStep` | `10` | 正整数 |
| `similarityRiseWindows` | `5` | 不小于 2 的整数 |
| `similarityRiseDelta` | `0.02` | 非负数字 |
| `similarityRiseMinimum` | `0.03` | 非负数字 |
| `scenePath` | 无 | 非空字符串数组 |
| `sceneRepeatThreshold` | `7` | 正整数 |
| `tensionPath` | 无 | 非空字符串数组 |
| `tensionEscalate` | `0.33` | 0 到 1，且小于 `tensionClimax` |
| `tensionClimax` | `0.67` | 0 到 1 |
| `tensionStateWeight` | `0.4` | 非负数字 |
| `tensionNoteWeight` | `0.3` | 非负数字 |
| `tensionEventWeight` | `0.3` | 非负数字 |
| `tensionStateDiffsPerFloor` | `2` | 正整数 |
| `tensionNotesPerFloor` | `1` | 正整数 |
| `pace` | `1` | 正数 |
| `minSetupFloors` | `2` | 正整数 |
| `minEscalateFloors` | `2` | 正整数 |
| `climaxFloors` | `7` | 正整数 |
| `breatheFloors` | `6` | 正整数 |
| `openingFloors` | `10` | 非负整数，`0` 表示关闭开场导演 |
| `openingIntensity` | `natural` | `setup`、`natural`、`detonate` |
| `intensity` | `natural` | `setup`、`natural`、`detonate` |

### `event-pool` 事件池

```json
{
	"events": [
		{ "id": "e1", "text": "夜里有狼群", "cooldown": 2, "enabled": true }
	]
}
```

- `events` 必须非空；`id` 在池内唯一。
- `text` 非空；`preconditions` 省略或 `null` 表示无条件，否则是条件表达式，且不能含 `switch`。
- `cooldown` 是非负整数，省略时为 `0`；`enabled` 是布尔值，省略时为 `true`。

### 条件表达式

`plot-beat`、`context-template` 的 `when`、`event-pool` 的 `preconditions` 都用同一种结构：

| 类型 | 结构 |
|---|---|
| 开关 | `{ "kind": "switch", "name": "非空", "equals": true }`，`equals` 省略时为 `true` |
| 台账 | `{ "kind": "state", "path": ["非空", "..."], "op": "exists" }` |
| 台账比较 | `{ "kind": "state", "path": ["..."], "op": "equals", "value": 任意 JSON 值 }` |
| 真值 | `{ "kind": "state", "path": ["..."], "op": "truthy" }` |
| 全部 | `{ "kind": "all", "conditions": [非空数组] }` |
| 任一 | `{ "kind": "any", "conditions": [非空数组] }` |
| 取反 | `{ "kind": "not", "condition": 条件 }` |

`op` 为 `equals` 时必须给 `value`；其他 `op` 出现 `value` 即拒绝。事件池与卡片事件不接受 `switch`。

## 卡片打包

角色卡的 `extensions.dramaticer` 只允许 `events`、`npcAgendas`、`arcs`、`plugins`、`requires`、`recommends` 六个键。

```json
{
	"plugins": [
		{
			"format": "dramaticer.plugin",
			"formatVersion": 1,
			"name": "example.dialogue-craft",
			"version": "1.0.0",
			"kind": "skill",
			"payload": {
				"name": "对白分寸",
				"description": "人物只说他知道的事。",
				"content": "# 对白分寸\n"
			}
		}
	],
	"requires": {
		"plugins": [{ "name": "example.cultivation-ledger", "versionRange": "^1.0.0" }],
		"playpacks": [{ "name": "example.xianxia-pack", "versionRange": ">=1.0.0 <2.0.0" }]
	},
	"recommends": {
		"plugins": [{ "name": "example.status-bar" }]
	}
}
```

- `plugins` 随卡携带声明式插件，组内重名整组拒绝。
- `requires` 与 `recommends` 结构相同：`{ "plugins": [...], "playpacks": [...] }`；两个列表都可以省略。每一项是 `{ "name": "...", "versionRange": "..." }`，`versionRange` 可省略。同一列表重名拒绝。
- 导入时把内置插件、调用方提供的可用清单与卡随附插件合并后逐条核对依赖。缺少必需依赖不中止导入，报告逐条给出缺失或版本不符的说明；推荐依赖未满足只提示。

## 版本规则

- 插件与玩法包的 `version` 必须是三段式 semver，可带预发布后缀，例如 `1.2.3`、`1.2.3-beta.1`。
- 依赖的 `versionRange` 使用 semver 范围语法：`^1.2.0`、`~1.2.0`、`>=1.0.0 <2.0.0`、`1.2.x`、`*` 等。空字符串与非法范围直接拒绝。
- 已安装版本必须是合法 semver。带范围时按 semver 的 `satisfies` 判断；预发布版本默认不满足不带预发布的范围。
- 不带 `versionRange` 的依赖只按名称判断。
- 已安装版本未知、而依赖带范围时记为「无法确认」（`unknown-version`），不当作满足。
- `satisfied` 只看必需依赖；推荐依赖的缺失与版本不符只出现在提示里。

## 玩法包

玩法包把一组声明式插件与配置补丁打包，外壳与插件共用名称、版本规则。

| 字段 | 必填 | 规则 |
|---|---|---|
| `format` | 是 | 固定为 `dramaticer.playpack` |
| `formatVersion` | 是 | 固定为 `1` |
| `name` | 是 | 与插件名规则相同 |
| `version` | 是 | 与插件版本规则相同 |
| `title` | 否 | 非空字符串 |
| `description` | 否 | 非空字符串 |
| `requirements` | 否 | 与卡片的依赖声明相同 |
| `plugins` | 否 | 声明式插件数组，组内与跨包重名都拒绝 |
| `config` | 否 | 插件名到 JSON 对象的配置补丁 |
| `switches` | 否 | 插件名到布尔值的开关 |

外壳只接受上表字段，未知字段一律拒绝。

- 多个玩法包按加载顺序叠加：后加载的包覆盖同名插件的配置，嵌套对象逐层合并，数组与标量整体替换；`switches` 按插件名覆盖。
- 用户覆盖放在最上层，只含 `config` 与 `switches`，不写回包文件。
- 依赖必须由更早加载的包或本包满足：`requirements.playpacks` 只能指向更早的包，`requirements.plugins` 必须由更早的包或本包提供。叠加阶段只判断存在性，版本匹配用于卡片导入报告。
- `config` 与 `switches` 里的键必须是本机已知的插件名（任一玩法包声明的插件，或调用方给出的内置插件名）。

## 示例文件

`docs/plugins/examples/` 下有三个可直接解析的示例：

| 文件 | 类型 |
|---|---|
| `ledger-schema.cultivation.json` | `ledger-schema` |
| `block-renderer.status-bar.json` | `block-renderer` |
| `skill.dialogue-craft.json` | `skill` |

`packages/core/test/declarative-plugin-examples.test.ts` 读取这些文件并走 `parseDeclarativePlugin`，同时核对本文档与解析器的常量没有脱节。
