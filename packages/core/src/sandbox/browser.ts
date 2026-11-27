/**
 * 浏览器也能安全引用的沙箱工具：能力白名单、域名扫描与 CSP。
 * 不要在这里导出依赖数据库或 Node 内建模块的模块。
 */
export {
	FLOOR_BRIDGE_CAPABILITIES,
	type FloorBridgeCapability,
} from "../plugins/floor-renderers.js";
export {
	assertSandboxDomain,
	buildSandboxContentSecurityPolicy,
	normalizeSandboxDomains,
	scanSandboxDomains,
	scanSandboxDomainsInTexts,
} from "./domains.js";
