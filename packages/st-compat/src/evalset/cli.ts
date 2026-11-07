import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStateQuestionsCli } from "./state-cli.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const rawRoot = path.join(repoRoot, "eval-private", "raw");
const outputRoot = path.join(repoRoot, "eval-private", "evalset");

await runStateQuestionsCli({ rawRoot, outputRoot });
