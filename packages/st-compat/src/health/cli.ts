import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectAcuBaseline } from "../evalset/acu.js";
import { collectRetrievalBaseline } from "../evalset/retrieval.js";
import {
	collectHealthReport,
	renderPrivateReport,
	renderPublicReport,
} from "./report.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const rawRoot = path.join(repoRoot, "eval-private", "raw");
const evalsetRoot = path.join(repoRoot, "eval-private", "evalset");
const privateReportPath = path.join(
	repoRoot,
	"eval-private",
	"reports",
	"health.md",
);
const publicReportPath = path.join(
	repoRoot,
	"docs",
	"dev",
	"reports",
	"M0-health.md",
);

const report = await collectHealthReport({ rawRoot });
const retrieval = await collectRetrievalBaseline({ rawRoot, evalsetRoot });
const acu = await collectAcuBaseline({ rawRoot, evalsetRoot });
await mkdir(path.dirname(privateReportPath), { recursive: true });
await mkdir(path.dirname(publicReportPath), { recursive: true });
await writeFile(
	privateReportPath,
	renderPrivateReport(report, retrieval, acu),
	"utf8",
);
await writeFile(
	publicReportPath,
	renderPublicReport(report, retrieval, acu),
	"utf8",
);

console.log(
	`体检完成：${report.totals.chatCount} 个对话，${report.totals.messageCount} 个楼层，原生 diff ${report.totals.diffBytes} 字节，快照 ${report.totals.snapshotBytes} 字节。`,
);
console.log(
	`检索基线：${retrieval.total.questionCount} 道题，命中@5 ${retrieval.total.hitAt5}，命中@10 ${retrieval.total.hitAt10}，命中@20 ${retrieval.total.hitAt20}。`,
);
console.log(
	`ACU 对照：${acu.total.questionCount} 道题，表格覆盖 ${acu.total.coveredCount}。`,
);
console.log(`私有报告：${privateReportPath}`);
console.log(`统计报告：${publicReportPath}`);
