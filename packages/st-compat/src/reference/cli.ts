import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type ReferenceBaseline,
	collectReferenceBaseline,
	renderPrivateReferenceReport,
	renderPublicReferenceReport,
} from "./collect.js";

export interface ReferenceCliOptions {
	readonly publicFixturePath: string;
	readonly referenceRoot: string;
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
		referenceRoot: path.join(repoRoot, "eval-private", "reference"),
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
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
