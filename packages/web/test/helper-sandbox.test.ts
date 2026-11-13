import { describe, expect, it } from "vitest";
import {
	ST_HELPER_SANDBOX_ATTRIBUTES,
	ST_HELPER_SANDBOX_CSP,
	buildStHelperSandboxDocument,
	parseHelperSandboxFrameMessage,
} from "../src/chat/helper-sandbox";

describe("酒馆助手沙箱文档", () => {
	it("带最小 CSP，不加载外部资源，也不允许同源", () => {
		const document = buildStHelperSandboxDocument({
			functions: ["getVariables"],
			events: { MESSAGE_SENT: "message_sent" },
		});
		expect(document).toContain("Content-Security-Policy");
		expect(document).toContain(ST_HELPER_SANDBOX_CSP);
		expect(document).toContain("default-src 'none'");
		expect(document).toContain("script-src 'unsafe-inline'");
		expect(document).not.toContain("connect-src");
		expect(document).not.toContain("allow-same-origin");
		expect(document).not.toContain("document.domain");
		expect(document).not.toContain("parent.document");
		expect(document).toContain("parent.postMessage");
		expect(ST_HELPER_SANDBOX_ATTRIBUTES).toBe("allow-scripts");
	});

	it("只把权限声明里的函数暴露给脚本", () => {
		const document = buildStHelperSandboxDocument({
			functions: ["getVariables", "getChatMessage"],
			events: {},
		});
		const config = /const config = (.+);/.exec(document)?.[1] ?? "";
		expect(config).toContain('"getVariables"');
		expect(config).toContain('"getChatMessage"');
		expect(config).not.toContain('"setChatMessages"');
		expect(config).not.toContain('"eventOn"');
	});

	it("配置里的尖括号不会截断脚本", () => {
		const document = buildStHelperSandboxDocument({
			functions: ["getVariables"],
			events: { CUSTOM: "</script><script>alert(1)</script>" },
		});
		expect(document).toContain("\\u003c/script>\\u003cscript>alert(1)");
		expect(document).not.toContain("</script><script>alert(1)");
	});

	it("渲染 HTML 时先插入页面再执行页面脚本，脚本仍在沙箱里", () => {
		const document = buildStHelperSandboxDocument({
			functions: ["getVariable"],
			events: {},
		});
		expect(document).toContain('<div id="st-helper-root"></div>');
		expect(document).toContain('"st-helper:render"');
		expect(document).toContain('type: "st-helper:rendered"');
		expect(document).toContain("new DOMParser()");
		expect(document).toContain("不支持外部脚本");
		expect(document).toContain("不支持 module 脚本");
		expect(document).toContain("root.innerHTML");
		expect(document).not.toContain("allow-same-origin");
	});
});

describe("沙箱消息白名单", () => {
	it("接受 ready、call 与 done", () => {
		expect(parseHelperSandboxFrameMessage({ type: "st-helper:ready" })).toEqual(
			{
				type: "st-helper:ready",
			},
		);
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:call",
				execution: "exec-1",
				id: 2,
				name: "getVariables",
				args: [{ type: "message" }],
			}),
		).toEqual({
			type: "st-helper:call",
			execution: "exec-1",
			id: 2,
			name: "getVariables",
			args: [{ type: "message" }],
		});
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:done",
				execution: "exec-1",
				ok: false,
				error: "boom",
			}),
		).toEqual({
			type: "st-helper:done",
			execution: "exec-1",
			ok: false,
			error: "boom",
		});
	});

	it("拒绝未知类型、非法字段与多余字段", () => {
		expect(parseHelperSandboxFrameMessage(null)).toBeNull();
		expect(parseHelperSandboxFrameMessage("ready")).toBeNull();
		expect(
			parseHelperSandboxFrameMessage({ type: "st-helper:other" }),
		).toBeNull();
		expect(
			parseHelperSandboxFrameMessage({ type: "st-helper:ready", extra: true }),
		).toBeNull();
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:call",
				execution: "exec-1",
				id: -1,
				name: "getVariables",
				args: [],
			}),
		).toBeNull();
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:call",
				execution: "exec-1",
				id: 1,
				name: "getVariables",
				args: "all",
			}),
		).toBeNull();
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:done",
				execution: "exec-1",
				ok: "yes",
			}),
		).toBeNull();
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:done",
				execution: "exec-1",
				ok: true,
				error: 42,
			}),
		).toBeNull();
	});

	it("接受渲染快照，拒绝缺少正文或原因的渲染结果", () => {
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:rendered",
				render: "render-1",
				ok: true,
				html: "<div>生命 9</div>",
			}),
		).toEqual({
			type: "st-helper:rendered",
			render: "render-1",
			ok: true,
			html: "<div>生命 9</div>",
		});
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:rendered",
				render: "render-1",
				ok: false,
				error: "脚本执行失败",
			}),
		).toEqual({
			type: "st-helper:rendered",
			render: "render-1",
			ok: false,
			error: "脚本执行失败",
		});
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:rendered",
				render: "render-1",
				ok: true,
			}),
		).toBeNull();
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:rendered",
				render: "render-1",
				ok: false,
			}),
		).toBeNull();
		expect(
			parseHelperSandboxFrameMessage({
				type: "st-helper:rendered",
				render: "",
				ok: true,
				html: "<div></div>",
			}),
		).toBeNull();
	});
});
