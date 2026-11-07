#!/usr/bin/env node
// Mechanical enforcement of the design invariants listed in AGENTS.md.
// Runs as part of `pnpm check`. Zero dependencies on purpose: it must work
// before anything is installed and must not be weakened by dependency drift.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];
const fail = (id, msg) => failures.push(`[${id}] ${msg}`);

function walk(dir, filter, out = []) {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, filter, out);
		else if (filter(p)) out.push(p);
	}
	return out;
}
const rel = (p) => relative(root, p).split(sep).join("/");
const isSource = (p) => /\.(m?[jt]sx?|cts|mts)$/.test(p);

// I1: core must not know about SillyTavern.
const coreSrc = walk(join(root, "packages", "core", "src"), isSource);
const stTerms =
	/\b(setvar|getvar|addvar|prompt_order|promptOrder|sillytavern|chatHistory|worldInfo\w*|charDescription|personaDescription|tavern|marker)\b/i;
for (const f of coreSrc) {
	const text = readFileSync(f, "utf8");
	if (/from\s+["'][^"']*st-compat[^"']*["']|import\(\s*["'][^"']*st-compat/.test(text)) {
		fail("I1", `${rel(f)} imports st-compat`);
	}
	const lines = text.split("\n");
	lines.forEach((line, i) => {
		const m = line.match(stTerms);
		if (m) fail("I1", `${rel(f)}:${i + 1} contains ST concept "${m[0]}"`);
	});
}

// I2: private data never tracked; no private absolute paths in package code.
let tracked = null;
try {
	tracked = execFileSync("git", ["ls-files", "-z"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	})
		.split("\0")
		.filter(Boolean);
} catch {
	warnings.push("not a git repository yet: skipped tracked-file checks");
}
if (tracked) {
	for (const f of tracked) {
		if (/^(eval-private|data)\//.test(f) || /(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(f)) {
			fail("I2", `private file is tracked by git: ${f}`);
		}
	}
}
const privatePath = /[A-Za-z]:[\\/]+(SillyTavern|Users[\\/]+[^\\/]+[\\/]+AppData)/i;
for (const f of walk(join(root, "packages"), (p) => isSource(p) || p.endsWith(".json"))) {
	const text = readFileSync(f, "utf8");
	if (privatePath.test(text)) fail("I2", `${rel(f)} contains a private absolute path`);
}

// I3: every dependency is registered in docs/dev/DEPENDENCIES.md.
const depsDocPath = join(root, "docs", "dev", "DEPENDENCIES.md");
const depsDoc = existsSync(depsDocPath) ? readFileSync(depsDocPath, "utf8") : "";
const manifests = [join(root, "package.json")];
const pkgDir = join(root, "packages");
if (existsSync(pkgDir)) {
	for (const name of readdirSync(pkgDir)) {
		const m = join(pkgDir, name, "package.json");
		if (existsSync(m)) manifests.push(m);
	}
}
for (const m of manifests) {
	if (!existsSync(m)) continue;
	const pkg = JSON.parse(readFileSync(m, "utf8"));
	for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
		for (const [dep, version] of Object.entries(pkg[field] ?? {})) {
			if (String(version).startsWith("workspace:")) continue;
			if (!depsDoc.includes(`\`${dep}\``)) {
				fail("I3", `${rel(m)} ${field} "${dep}" is not registered in docs/dev/DEPENDENCIES.md`);
			}
		}
	}
}

// I10: offline unit tests use no network and no private data.
// Covers every file under a test directory (fixtures and helper modules included),
// not just *.test.* sources.
const testFiles = walk(
	join(root, "packages"),
	(p) =>
		!/\.live\.test\./.test(p) &&
		(/[\\/]test[\\/]/.test(p) || /\.test\.[cm]?[jt]sx?$/.test(p)),
);
for (const f of testFiles) {
	const text = readFileSync(f, "utf8");
	if (/https?:\/\/(?!localhost|127\.0\.0\.1|example\.(com|org|invalid))/.test(text)) {
		fail("I10", `${rel(f)} references a network URL (move to *.live.test.ts)`);
	}
	if (/eval-private|privatePath|[A-Za-z]:[\\/]+SillyTavern/i.test(text)) {
		fail("I10", `${rel(f)} references private data`);
	}
}

for (const w of warnings) console.warn(`warn: ${w}`);
if (failures.length) {
	console.error(`check-invariants: ${failures.length} violation(s)`);
	for (const f of failures) console.error(`  ${f}`);
	console.error("See AGENTS.md > 设计不变量. Do not weaken this script to make it pass; fix the code or write an ADR.");
	process.exit(1);
}
console.log("check-invariants: ok");
