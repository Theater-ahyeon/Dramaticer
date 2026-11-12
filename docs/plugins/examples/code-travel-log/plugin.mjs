// 示例代码插件：只使用 files 权限，演示槽位、只读工具与块类型三种扩展点。
export async function activate(api) {
	const file = api.config?.file ?? "data/travel.md";

	async function readLog() {
		const { content } = await api.readFile(file);
		return content.trim();
	}

	api.slot("memory", async () => ({
		messages: [
			{
				role: "system",
				content: `旅行日志：\n${await readLog()}`,
			},
		],
		source: api.name,
	}));

	api.tool(
		{
			name: "travel_log",
			description: "读取旅行日志的当前内容。",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			permission: "read",
			progressLabel: "翻看旅行日志……",
		},
		["fast", "deep"],
		async () => ({ text: await readLog() }),
	);

	api.blockType({
		name: "旅行日志",
		display: { kind: "html", template: "<article>{{content}}</article>" },
		context: { kind: "keep-depth", depth: 2 },
		semantics: { kind: "none" },
	});

	api.log(`旅行日志已装载：${file}`);
}
