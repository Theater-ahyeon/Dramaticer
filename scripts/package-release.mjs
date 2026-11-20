#!/usr/bin/env node
// 生成 Windows 绿色便携整合包（dist-release/dramaticer-v<version>-<platform>-<arch> 及 .zip）。
// 零新增外部依赖：只使用 Node 内置模块、pnpm 与 .NET ZipFile。
import { execFileSync, execSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPkg = JSON.parse(
	readFileSync(join(repoRoot, "packages", "server", "package.json"), "utf8"),
);
const version = serverPkg.version ?? "0.1.0";
const releaseName = `dramaticer-v${version}-${process.platform}-${process.arch}`;
const releaseRoot = join(repoRoot, "dist-release");
const bundleDir = join(releaseRoot, releaseName);
const zipPath = join(releaseRoot, `${releaseName}.zip`);

console.log("[1/4] 构建全部工作区包与前端 (pnpm build)...");
execSync("pnpm build", { cwd: repoRoot, stdio: "inherit" });

console.log(`[2/4] 收集生产环境运行时依赖到 ${bundleDir}...`);
rmSync(bundleDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
execSync(
	`pnpm --filter @dramaticer/server --prod deploy --legacy "${bundleDir}"`,
	{ cwd: repoRoot, stdio: "inherit" },
);

console.log("[3/4] 组装工作区构建产物、精简无关文件与生成启动脚本...");
rmSync(join(bundleDir, "dist"), { recursive: true, force: true });
rmSync(join(bundleDir, "src"), { recursive: true, force: true });
rmSync(join(bundleDir, "test"), { recursive: true, force: true });
rmSync(join(bundleDir, "tsconfig.json"), { force: true });
rmSync(join(bundleDir, "node_modules", ".pnpm", "node_modules"), {
	recursive: true,
	force: true,
});

// 清理 .pnpm 虚拟存储里工作区包的 src/、test/ 与第三方包的 .d.ts/.map，大幅减小体积
const pnpmDir = join(bundleDir, "node_modules", ".pnpm");
if (existsSync(pnpmDir)) {
	for (const entry of readdirSync(pnpmDir)) {
		if (!entry.startsWith("@dramaticer+")) continue;
		const pkgRoot = join(
			pnpmDir,
			entry,
			"node_modules",
			"@dramaticer",
			entry.split("+")[1]?.split("@")[0] ?? "",
		);
		if (existsSync(pkgRoot)) {
			rmSync(join(pkgRoot, "src"), { recursive: true, force: true });
			rmSync(join(pkgRoot, "test"), { recursive: true, force: true });
			rmSync(join(pkgRoot, "tsconfig.json"), { force: true });
		}
	}
}

const runtimePackages = ["core", "protocol", "st-compat", "server"];
for (const name of runtimePackages) {
	const srcPkgDir = join(repoRoot, "packages", name);
	const dstPkgDir = join(bundleDir, "packages", name);
	mkdirSync(dstPkgDir, { recursive: true });
	cpSync(join(srcPkgDir, "dist"), join(dstPkgDir, "dist"), {
		recursive: true,
	});
	const rawPkg = JSON.parse(
		readFileSync(join(srcPkgDir, "package.json"), "utf8"),
	);
	const cleanPkg = {
		name: rawPkg.name,
		version: rawPkg.version,
		type: rawPkg.type,
		main: rawPkg.main,
		exports: rawPkg.exports,
		bin: rawPkg.bin,
	};
	writeFileSync(
		join(dstPkgDir, "package.json"),
		`${JSON.stringify(cleanPkg, null, "\t")}\n`,
		"utf8",
	);
}

// 复制前端静态构建产物
const webDistDst = join(bundleDir, "packages", "web", "dist");
mkdirSync(webDistDst, { recursive: true });
cpSync(join(repoRoot, "packages", "web", "dist"), webDistDst, {
	recursive: true,
});

// 复制内置文档（供应用内助手「使用指南」技能检索，跳过私有报告）
const docsDst = join(bundleDir, "docs");
mkdirSync(docsDst, { recursive: true });
for (const item of ["DESIGN.md", "plugins"]) {
	const src = join(repoRoot, "docs", item);
	if (existsSync(src)) {
		cpSync(src, join(docsDst, item), { recursive: true });
	}
}

// 复制配置模板与说明文档（绝不复制用户的 .env 或 data/ 私有数据）
for (const file of [
	"README.md",
	"LICENSE",
	"GLOSSARY.md",
	".env.example",
	"channels.example.yaml",
	"images.example.yaml",
]) {
	if (existsSync(join(repoRoot, file))) {
		cpSync(join(repoRoot, file), join(bundleDir, file));
	}
}

mkdirSync(join(bundleDir, "data"), { recursive: true });
cpSync(
	join(repoRoot, "channels.example.yaml"),
	join(bundleDir, "data", "channels.yaml"),
);

const rootPkg = {
	name: "dramaticer-portable",
	version,
	private: true,
	type: "module",
	engines: { node: ">=22.19" },
	scripts: {
		start: "node packages/server/dist/cli.js",
		dramaticer: "node packages/st-compat/dist/cli.js",
	},
};
writeFileSync(
	join(bundleDir, "package.json"),
	`${JSON.stringify(rootPkg, null, "\t")}\n`,
	"utf8",
);

const startBat = [
	"@echo off",
	"chcp 65001 >nul",
	"setlocal",
	'cd /d "%~dp0"',
	"echo ==================================================",
	`echo   Dramaticer v${version} 便携版启动器`,
	"echo ==================================================",
	"where node >nul 2>nul",
	"if errorlevel 1 (",
	"  echo [错误] 未检测到 Node.js，请先安装 Node.js 22.19 或更高版本：https://nodejs.org/",
	"  pause",
	"  exit /b 1",
	")",
	'if not exist ".env" (',
	'  copy /y ".env.example" ".env" >nul',
	"  echo [提示] 已自动从 .env.example 生成 .env 文件，请填写你的模型 API Key。",
	")",
	'if not exist "data" mkdir "data"',
	'if not exist "data\\channels.yaml" (',
	'  copy /y "channels.example.yaml" "data\\channels.yaml" >nul',
	")",
	'echo [启动] 正在启动本地服务 (默认 http://127.0.0.1:8787) ...',
	'start "" "http://127.0.0.1:8787"',
	"node packages\\server\\dist\\cli.js %*",
	"pause",
	"",
].join("\r\n");
writeFileSync(join(bundleDir, "start.bat"), startBat, "utf8");

const dramaticerBat = [
	"@echo off",
	"chcp 65001 >nul",
	'cd /d "%~dp0"',
	"node packages\\st-compat\\dist\\cli.js %*",
	"",
].join("\r\n");
writeFileSync(join(bundleDir, "dramaticer.bat"), dramaticerBat, "utf8");

const startPs1 = [
	"$ErrorActionPreference = 'Stop'",
	"Set-Location -LiteralPath $PSScriptRoot",
	`Write-Host "=== Dramaticer v${version} ===" -ForegroundColor Cyan`,
	"if (-not (Test-Path '.env')) {",
	"    Copy-Item '.env.example' '.env'",
	"    Write-Host '[提示] 已自动创建 .env，请填入模型 API 密钥。' -ForegroundColor Yellow",
	"}",
	"if (-not (Test-Path 'data')) { New-Item -ItemType Directory -Path 'data' | Out-Null }",
	"if (-not (Test-Path 'data/channels.yaml')) {",
	"    Copy-Item 'channels.example.yaml' 'data/channels.yaml'",
	"}",
	"Start-Process 'http://127.0.0.1:8787'",
	"& node 'packages/server/dist/cli.js' @args",
	"",
].join("\n");
writeFileSync(join(bundleDir, "start.ps1"), startPs1, "utf8");

console.log(`[4/4] 压缩生成安装包 ${zipPath}...`);
if (process.platform === "win32") {
	const pwsh = existsSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		? "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
		: "powershell.exe";
	execFileSync(
		pwsh,
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${bundleDir}', '${zipPath}', [System.IO.Compression.CompressionLevel]::Fastest, $true)`,
		],
		{ stdio: "inherit" },
	);
} else {
	execFileSync(
		"tar",
		["-czf", `${bundleDir}.tar.gz`, "-C", releaseRoot, releaseName],
		{
			stdio: "inherit",
		},
	);
}

console.log("\n打包完成！");
console.log(`- 绿色便携目录：${bundleDir}`);
console.log(`- 便携安装包：  ${zipPath}`);
