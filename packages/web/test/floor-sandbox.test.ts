import { describe, expect, it } from "vitest";
import {
	type FloorSandboxTheme,
	MAX_FLOOR_BRIDGE_TEXT,
	buildFloorSandboxDocument,
	parseFloorSandboxMessage,
} from "../src/chat/floor-sandbox";

const THEME: FloorSandboxTheme = {
	dataTheme: "dark",
	variables: { "--ink": "#ebe5da", "--paper": "#1c1a17" },
};

function build(
	overrides: Partial<Parameters<typeof buildFloorSandboxDocument>[0]> = {},
) {
	return buildFloorSandboxDocument({
		html: '<div id="probe">气力：3</div>',
		script: 'window.dramaticerBridge.sendMessage("继续");',
		style: ".probe{color:var(--ink)}",
		allowedDomains: [],
		theme: THEME,
		permissions: ["sendMessage"],
		...overrides,
	});
}

describe("楼层沙箱文档", () => {
	it("默认不联网，CSP 只允许内联脚本与样式", () => {
		const document = build();
		expect(document).toContain("default-src 'none'");
		expect(document).toContain("script-src 'unsafe-inline'");
		expect(document).toContain("connect-src 'none'");
		expect(document).not.toContain("allow-same-origin");
	});

	it("允许的域名进入 CSP；非法域名直接失败", () => {
		const document = build({ allowedDomains: ["example.com"] });
		expect(document).toContain("connect-src http://example.com");
		expect(document).toContain("wss://example.com");
		expect(() => build({ allowedDomains: ["a;b"] })).toThrow();
	});

	it("主题变量与 data-theme 一起进沙箱", () => {
		const document = build();
		expect(document).toContain('data-theme="dark"');
		expect(document).toContain(
			'html[data-theme="dark"] { color-scheme: dark; }',
		);
		expect(document).toContain("--ink");
		expect(document).toContain("#ebe5da");
		expect(document).toContain("--paper");
	});

	it("交互桥只暴露白名单里的五个方法，并带联网拦截与高度上报", () => {
		const document = build();
		for (const method of [
			"sendMessage",
			"fillInput",
			"readState",
			"writeState",
			"openImage",
		]) {
			expect(document).toContain(method);
		}
		expect(document).toContain("window.dramaticerBridge");
		expect(document).toContain("securitypolicyviolation");
		expect(document).toContain("ResizeObserver");
		expect(document).toContain("MutationObserver");
		expect(document).toContain("floor:bridge-result");
	});

	it("渲染内容以 JSON 注入，无法闭合脚本标签", () => {
		const document = build({ html: '</script><img src=x onerror="alert(1)">' });
		expect(document).not.toContain("</script><img");
		expect(document).toContain("\\u003c/script");
	});

	it("外链图片加载失败时换成一行文字，不留裂图", () => {
		const document = build();
		expect(document).toContain("floor-img-missing");
		expect(document).toContain("图片没能显示");
		expect(document).toContain('target.tagName !== "IMG"');
	});

	it("图片失败的监听在内容注入之前注册，并挂在捕获阶段", () => {
		const document = build();
		const listener = document.indexOf('target.tagName !== "IMG"');
		expect(listener).toBeGreaterThan(0);
		expect(listener).toBeLessThan(document.indexOf("innerHTML = config.html"));
		// error 不冒泡，只有捕获阶段能拿到图片的失败事件。
		expect(/,\s*true\s*\)/.test(document.slice(listener, listener + 900))).toBe(
			true,
		);
	});
});

describe("楼层沙箱消息白名单", () => {
	it("接受高度、桥调用与拒绝事件", () => {
		expect(
			parseFloorSandboxMessage({ type: "floor:height", height: 120.4 }),
		).toEqual({ kind: "height", height: 121 });
		expect(
			parseFloorSandboxMessage({
				type: "floor:bridge",
				id: 3,
				method: "readState",
				args: [["mvu", "counter"]],
			}),
		).toEqual({
			kind: "bridge",
			id: 3,
			method: "readState",
			args: [["mvu", "counter"]],
		});
		expect(
			parseFloorSandboxMessage({
				type: "floor:violation",
				kind: "network",
				target: "https://example.com/x",
				reason: "沙箱默认禁止联网",
			}),
		).toEqual({
			kind: "violation",
			rejection: "network",
			target: "https://example.com/x",
			reason: "沙箱默认禁止联网",
		});
	});

	it("拒绝形状不对的消息与超长文本", () => {
		expect(
			parseFloorSandboxMessage({ type: "floor:height", height: 9e9 }),
		).toBeNull();
		expect(
			parseFloorSandboxMessage({
				type: "floor:bridge",
				id: 0,
				method: "sendMessage",
				args: [],
			}),
		).toBeNull();
		expect(
			parseFloorSandboxMessage({
				type: "floor:violation",
				kind: "other",
				target: "x",
				reason: "x",
			}),
		).toBeNull();
		const long = "x".repeat(MAX_FLOOR_BRIDGE_TEXT + 1);
		expect(
			parseFloorSandboxMessage({
				type: "floor:violation",
				kind: "bridge",
				target: long,
				reason: long,
			})?.kind,
		).toBe("violation");
	});
});
