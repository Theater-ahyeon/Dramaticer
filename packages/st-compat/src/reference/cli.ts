import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createEmbeddingClient,
	loadChannelsConfig,
	loadDotEnv,
} from "@dramaticer/core";
import { createCachedEmbeddingClient } from "../evalset/memory-cache.js";
import {
	type ReferenceBaseline,
	collectReferenceBaseline,
	renderPrivateReferenceReport,
	renderPublicReferenceReport,
} from "./collect.js";
import type { CosineCalibration } from "./cosine.js";
import { calibrateReferenceCosine, parseCosineCalibration } from "./cosine.js";

export interface ReferenceCliOptions {
	readonly publicFixturePath: string;
	readonly referenceRoot: string;
	/** 快照根目录；提供时统计旧语料对话作为对照。 */
	readonly chatRoot?: string;
	/** 已有的 embedding 余弦校准；提供时写进两份报告。 */
	readonly cosine?: CosineCalibration;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
	readonly generatedAt?: string;
	readonly log?: (message: string) => void;
}

export interface ReferenceCliResult {
	readonly baseline: ReferenceBaseline;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
}

export async function runReferenceCli(
	options: ReferenceCliOptions,
): Promise<ReferenceCliResult> {
	const log = options.log ?? ((message: string) => console.log(message));
	const baseline = await collectReferenceBaseline({
		publicFixturePath: options.publicFixturePath,
		referenceRoot: options.referenceRoot,
		chatRoot: options.chatRoot,
		cosine: options.cosine,
		generatedAt: options.generatedAt,
	});
	await mkdir(path.dirname(options.privateReportPath), { recursive: true });
	await mkdir(path.dirname(options.publicReportPath), { recursive: true });
	await writeFile(
		options.privateReportPath,
		renderPrivateReferenceReport(baseline),
		"utf8",
	);
	await writeFile(
		options.publicReportPath,
		renderPublicReferenceReport(baseline),
		"utf8",
	);
	log(
		`参照统计：${baseline.aggregate.workCount} 部作品，${baseline.aggregate.charCount} 字符，${baseline.aggregate.blockCount} 个文本块。`,
	);
	log(`评测对话对照：${baseline.conversations.length} 个对话。`);
	log(
		baseline.cosine === null
			? "参照余弦：未校准"
			: `参照余弦：${baseline.cosine.pairCount} 对，P99 ${baseline.cosine.percentiles.p99.toFixed(4)}`,
	);
	log(`私有报告：${options.privateReportPath}`);
	log(`统计报告：${options.publicReportPath}`);
	return {
		baseline,
		privateReportPath: options.privateReportPath,
		publicReportPath: options.publicReportPath,
	};
}

async function main(): Promise<void> {
	const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
	const referenceRoot = path.join(repoRoot, "eval-private", "reference");
	const cosinePath = path.join(
		repoRoot,
		"eval-private",
		"reports",
		"reference-cosine.json",
	);
	const log = (message: string) => console.log(message);
	const cosine = process.argv.includes("--cosine")
		? await calibrateCosine(repoRoot, referenceRoot, cosinePath, log)
		: await loadCosineCalibration(cosinePath);
	await runReferenceCli({
		publicFixturePath: path.join(
			repoRoot,
			"packages",
			"st-compat",
			"test",
			"fixtures",
			"reference",
			"public-domain.txt",
		),
		referenceRoot,
		chatRoot: path.join(repoRoot, "eval-private", "raw"),
		cosine,
		privateReportPath: path.join(
			repoRoot,
			"eval-private",
			"reports",
			"reference.md",
		),
		publicReportPath: path.join(
			repoRoot,
			"docs",
			"dev",
			"reports",
			"reference-baseline.md",
		),
		log,
	});
}

async function loadCosineCalibration(
	filePath: string,
): Promise<CosineCalibration | undefined> {
	try {
		const text = await readFile(filePath, "utf8");
		return parseCosineCalibration(JSON.parse(text));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function calibrateCosine(
	repoRoot: string,
	referenceRoot: string,
	filePath: string,
	log: (message: string) => void,
): Promise<CosineCalibration> {
	loadDotEnv(path.join(repoRoot, ".env"));
	const config = await loadChannelsConfig(
		path.join(repoRoot, "data", "channels.yaml"),
	);
	const provider = config.embeddings.get("default");
	if (provider === undefined) {
		throw new Error("channels.yaml 没有配置 embeddings.default，无法校准余弦");
	}
	const label = `${provider.model}@${provider.dimensions}`;
	const embedder = createCachedEmbeddingClient({
		inner: createEmbeddingClient(config),
		cacheDir: path.join(repoRoot, "eval-private", "memory-cache", "embeddings"),
		label,
		onProgress: (progress) => {
			if (progress.done % 256 === 0 || progress.done === progress.total) {
				log(
					`余弦取样 embedding ${progress.done}/${progress.total}，命中缓存 ${progress.cached}`,
				);
			}
		},
	});
	const cosine = await calibrateReferenceCosine({
		referenceRoot,
		embedder,
		modelLabel: label,
	});
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(cosine, null, 2)}\n`, "utf8");
	log(
		`参照余弦校准：${cosine.pairCount} 对，P99 ${cosine.percentiles.p99.toFixed(4)}`,
	);
	return cosine;
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
