import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectAcuBaseline } from "../evalset/acu.js";
import { collectRetrievalBaseline } from "../evalset/retrieval.js";
import type { HealthReport } from "./report.js";
import {
	collectHealthReport,
	renderPrivateReport,
	renderPublicReport,
} from "./report.js";

export interface HealthCliOptions {
	readonly rawRoot: string;
	readonly evalsetRoot: string;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
	readonly generatedAt?: string;
	readonly log?: (message: string) => void;
}

export interface HealthCliResult {
	readonly report: HealthReport;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
}

export async function runHealthCli(
	options: HealthCliOptions,
): Promise<HealthCliResult> {
	const log = options.log ?? ((message: string) => console.log(message));
	const report = await collectHealthReport({
		rawRoot: options.rawRoot,
		generatedAt: options.generatedAt,
	});
	const retrieval = await collectRetrievalBaseline({
		rawRoot: options.rawRoot,
		evalsetRoot: options.evalsetRoot,
		generatedAt: options.generatedAt,
	});
	const acu = await collectAcuBaseline({
		rawRoot: options.rawRoot,
		evalsetRoot: options.evalsetRoot,
		generatedAt: options.generatedAt,
	});
	await mkdir(path.dirname(options.privateReportPath), { recursive: true });
	await mkdir(path.dirname(options.publicReportPath), { recursive: true });
	await writeFile(
		options.privateReportPath,
		renderPrivateReport(report, retrieval, acu),
		"utf8",
	);
	await writeFile(
		options.publicReportPath,
		renderPublicReport(report, retrieval, acu),
		"utf8",
	);
	log(
		`体检完成：${report.totals.chatCount} 个对话，${report.totals.messageCount} 个楼层，原生 diff ${report.totals.diffBytes} 字节，快照 ${report.totals.snapshotBytes} 字节。`,
	);
	log(
		`检索基线：${retrieval.total.questionCount} 道题，命中@5 ${retrieval.total.hitAt5}，命中@10 ${retrieval.total.hitAt10}，命中@20 ${retrieval.total.hitAt20}。`,
	);
	log(
		`ACU 对照：${acu.total.questionCount} 道题，表格覆盖 ${acu.total.coveredCount}。`,
	);
	log(`私有报告：${options.privateReportPath}`);
	log(`统计报告：${options.publicReportPath}`);
	return {
		report,
		privateReportPath: options.privateReportPath,
		publicReportPath: options.publicReportPath,
	};
}

async function main(): Promise<void> {
	const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
	await runHealthCli({
		rawRoot: path.join(repoRoot, "eval-private", "raw"),
		evalsetRoot: path.join(repoRoot, "eval-private", "evalset"),
		privateReportPath: path.join(
			repoRoot,
			"eval-private",
			"reports",
			"health.md",
		),
		publicReportPath: path.join(
			repoRoot,
			"docs",
			"dev",
			"reports",
			"M0-health.md",
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
