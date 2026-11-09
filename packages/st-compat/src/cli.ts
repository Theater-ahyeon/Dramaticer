import {
	runActionsCli,
	runDirectorCli,
	runExplainCli,
	runImagesCli,
	runLedgerCli,
	runOpeningCli,
	runProbeCli,
	runWorkCli,
} from "@dramaticer/core";
import { runChatCli } from "./chat/cli.js";

const USAGE =
	"用法：dramaticer <probe|chat|work|ledger|open|director|actions|explain|images> ...";

async function main(args: readonly string[]): Promise<void> {
	const command = args[0];
	if (command === "probe") {
		await runProbeCli(args);
		return;
	}
	if (command === "chat") {
		await runChatCli(args);
		return;
	}
	if (command === "work") {
		await runWorkCli(args);
		return;
	}
	if (command === "ledger") {
		await runLedgerCli(args);
		return;
	}
	if (command === "open") {
		await runOpeningCli(args);
		return;
	}
	if (command === "director") {
		await runDirectorCli(args);
		return;
	}
	if (command === "actions") {
		runActionsCli(args);
		return;
	}
	if (command === "explain") {
		await runExplainCli(args);
		return;
	}
	if (command === "images") {
		await runImagesCli(args);
		return;
	}
	throw new Error(USAGE);
}

try {
	await main(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
