import { assertPlainObject, isJsonObject } from "../json.js";

/** 一次联网搜索命中；抓取时间指拿到这条结果的时刻。 */
export interface AssistantSearchResult {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
	readonly fetchedAt: string;
}

/**
 * 资料员使用的搜索客户端。只有 server 显式开启联网时才注入；
 * 单元测试用假客户端，工具本身不直接访问网络。
 */
export interface AssistantSearchClient {
	search(
		query: string,
		limit: number,
	): Promise<readonly AssistantSearchResult[]>;
}

export interface HttpAssistantSearchClientOptions {
	/** 搜索服务的完整地址；请求体是 `{query, limit}`。 */
	readonly baseUrl: string;
	readonly fetch?: typeof fetch;
	readonly timeoutMs?: number;
	readonly now?: () => Date;
}

/**
 * 通过 HTTP 调用搜索结果服务。响应可以是结果数组，也可以是
 * `{results: [...]}`；每条结果必须有 `title` 与非空的 `url`。
 */
export function createHttpAssistantSearchClient(
	options: HttpAssistantSearchClientOptions,
): AssistantSearchClient {
	const url = parseHttpUrl(options.baseUrl, "联网搜索地址");
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? 15_000;
	const now = options.now ?? (() => new Date());
	return {
		async search(query, limit) {
			const response = await fetchImpl(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query, limit }),
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!response.ok) {
				throw new Error(
					`联网搜索请求失败：HTTP ${response.status} ${response.statusText}`,
				);
			}
			const payload: unknown = await response.json();
			const items = Array.isArray(payload)
				? payload
				: isJsonObject(payload) && Array.isArray(payload.results)
					? payload.results
					: null;
			if (items === null) {
				throw new Error("联网搜索响应必须是数组或含 results 数组的对象");
			}
			const fetchedAt = now().toISOString();
			return items.map((item, index) => {
				const record = assertPlainObject(item, `results[${index}]`);
				const title = requireText(record.title, `results[${index}].title`);
				const link = requireText(
					record.url ?? record.link,
					`results[${index}].url`,
				);
				const snippet =
					record.snippet === undefined
						? ""
						: requireText(record.snippet, `results[${index}].snippet`);
				return { title, url: link, snippet, fetchedAt };
			});
		},
	};
}

function parseHttpUrl(value: string, label: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${label}不是合法地址：${value}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`${label}只支持 http 或 https：${value}`);
	}
	return url;
}

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}
