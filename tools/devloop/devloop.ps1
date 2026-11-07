#requires -Version 7
<#
.SYNOPSIS
  Dramaticer 自动开发循环：每个会话启动一个全新上下文的 agent 做一个任务，会话之间通过仓库文件交接。

.EXAMPLE
  pwsh -File tools/devloop/devloop.ps1                    # 默认用 omp，跑到停止条件为止
  pwsh -File tools/devloop/devloop.ps1 -Once              # 只跑一个会话（用来观察效果）
  pwsh -File tools/devloop/devloop.ps1 -PauseAtMilestone  # 每完成一个里程碑就停下，等你看报告
  pwsh -File tools/devloop/devloop.ps1 -Agent dsh         # 改用 DeepSeek Harness 的 headless 模式
  pwsh -File tools/devloop/devloop.ps1 -Model magpie/auto/deepseek-v4-pro

  随时停止：在仓库里新建文件 .devloop/STOP（当前会话结束后生效）。
#>
[CmdletBinding()]
param(
    [ValidateSet('omp', 'dsh')][string]$Agent = 'omp',
    [string]$Model = '',
    [int]$MaxSessions = 40,
    [int]$SessionMinutes = 90,
    [int]$MaxFailures = 3,
    [switch]$PauseAtMilestone,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Repo

$DL = Join-Path $Repo '.devloop'
$LogDir = Join-Path $DL 'logs'
New-Item -ItemType Directory -Force -Path $DL, $LogDir | Out-Null

$Protected = @(
    'AGENTS.md', 'CLAUDE.md', 'scripts/check-invariants.mjs',
    'tools/devloop/devloop.ps1', 'tools/devloop/session-prompt.md'
)
$ProtectedHashFile = Join-Path $DL 'protected.sha'
$CounterFile = Join-Path $DL 'session-counter'
$ResultFile = Join-Path $DL 'result.json'
$GateFile = Join-Path $DL 'gate.txt'
$HistoryFile = Join-Path $DL 'history.jsonl'
$StopFile = Join-Path $DL 'STOP'
$StoppedFile = Join-Path $DL 'STOPPED.txt'

function Write-Info([string]$msg) { Write-Host "[devloop $(Get-Date -Format 'HH:mm:ss')] $msg" }

function Get-ProtectedHash {
    ($Protected | ForEach-Object {
        $p = Join-Path $Repo $_
        if (Test-Path $p) { "$_=$((Get-FileHash $p -Algorithm SHA256).Hash)" } else { "$_=missing" }
    }) -join "`n"
}

function Get-Head {
    $h = & git rev-parse HEAD 2>$null
    if ($LASTEXITCODE -ne 0) { return '' } else { return "$h".Trim() }
}

function Invoke-Gate {
    if (-not (Test-Path (Join-Path $Repo 'package.json'))) {
        Set-Content $GateFile "PASS`n(no package.json yet: gate starts after M0-T01)"
        return $true
    }
    $out = & pnpm check 2>&1 | Out-String
    $ok = ($LASTEXITCODE -eq 0)
    $tail = ($out -split "`n" | Select-Object -Last 150) -join "`n"
    Set-Content $GateFile ("{0}`n{1}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $tail)
    return $ok
}

function Stop-Loop([string]$reason) {
    $text = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 循环停止：$reason"
    Set-Content $StoppedFile $text
    Write-Info $text
    try { [console]::beep(880, 300); [console]::beep(660, 300) } catch {}
    exit 0
}

# ---------- one-time setup ----------
if (-not (Test-Path (Join-Path $Repo '.git'))) {
    Write-Info 'git init'
    & git init -b main | Out-Null
    & git add -A
    & git commit -m 'chore: initial design docs and dev protocol' | Out-Null
}
if (-not (Test-Path $ProtectedHashFile)) { Set-Content $ProtectedHashFile (Get-ProtectedHash) }
if (Test-Path $StoppedFile) { Remove-Item $StoppedFile }

$agentExe = switch ($Agent) {
    'omp' { (Get-Command omp -ErrorAction Stop).Source }
    'dsh' { (Get-Command dsh -ErrorAction Stop).Source }
}
$template = Get-Content (Join-Path $PSScriptRoot 'session-prompt.md') -Raw
$kickoff = '读取并严格执行 .devloop/prompt.md 中的指令。'

$failures = 0
$lastResult = '无（这是本次循环的第一个会话）'
$gateOk = Invoke-Gate

for ($i = 1; $i -le $MaxSessions; $i++) {
    if (Test-Path $StopFile) { Remove-Item $StopFile; Stop-Loop '检测到 .devloop/STOP' }

    $session = 1 + [int]((Get-Content $CounterFile -ErrorAction SilentlyContinue) ?? 0)
    Set-Content $CounterFile $session

    $gateText = if ($gateOk) { '通过' } else { '失败：详情见 .devloop/gate.txt，本会话必须先修复门禁' }
    $prompt = $template.Replace('{{SESSION}}', "$session").Replace('{{LAST_RESULT}}', $lastResult).Replace('{{GATE}}', $gateText)
    Set-Content (Join-Path $DL 'prompt.md') $prompt
    if (Test-Path $ResultFile) { Remove-Item $ResultFile }

    $headBefore = Get-Head
    $stamp = '{0:D4}' -f $session
    $outLog = Join-Path $LogDir "session-$stamp.out.log"
    $errLog = Join-Path $LogDir "session-$stamp.err.log"
    $started = Get-Date

    if ($Agent -eq 'omp') {
        $argList = @('-p', '--cwd', "`"$Repo`"", '--auto-approve', '--no-title', '--max-time', "$($SessionMinutes)m")
        if ($Model) { $argList += @('--model', "`"$Model`"") }
        $argList += "`"$kickoff`""
    } else {
        $env:DSH_PERMISSION_MODE = 'danger-full-access'
        $argList = @('--profile', 'headless')
        $argList += "`"$kickoff`""
    }

    Write-Info "会话 $session 开始（$Agent）"
    $proc = Start-Process -FilePath $agentExe -ArgumentList $argList -WorkingDirectory $Repo `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog -NoNewWindow -PassThru
    $limitMs = ($SessionMinutes + 10) * 60 * 1000
    if (-not $proc.WaitForExit($limitMs)) {
        Write-Info "会话 $session 超时，结束进程树"
        & taskkill /PID $proc.Id /T /F | Out-Null
    }
    $minutes = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)

    # 保存 agent 没提交的改动（.gitignore 会挡住私有数据）
    if (& git status --porcelain) {
        & git add -A
        & git commit -m "chore(devloop): autosave after session $session" | Out-Null
    }

    $gateOk = Invoke-Gate
    $headAfter = Get-Head

    $result = $null
    if (Test-Path $ResultFile) {
        try { $result = Get-Content $ResultFile -Raw | ConvertFrom-Json } catch { $result = $null }
    }
    $status = if ($result) { "$($result.status)" } else { 'NO_RESULT' }
    $task = if ($result) { "$($result.task)" } else { '?' }
    $summary = if ($result) { "$($result.summary)" } else { '会话没有写结果文件（可能崩溃或超时）' }
    $lastResult = "会话 $session，任务 $task，状态 $status：$summary"

    [ordered]@{
        session = $session; agent = $Agent; start = $started.ToString('s'); minutes = $minutes
        task = $task; status = $status; gate = $(if ($gateOk) { 'PASS' } else { 'FAIL' })
        progressed = ($headAfter -ne $headBefore); head = $headAfter
    } | ConvertTo-Json -Compress | Add-Content $HistoryFile
    Write-Info "会话 $session 结束：$task $status，门禁 $(if ($gateOk) {'PASS'} else {'FAIL'})，耗时 $minutes 分钟"

    # 受保护文件被改动：必须人工审查
    if ((Get-ProtectedHash) -ne (Get-Content $ProtectedHashFile -Raw).Trim()) {
        Stop-Loop "受保护文件（AGENTS.md、门禁脚本或 devloop）被修改。请用 git log -p 审查；确认没问题后删除 .devloop/protected.sha 再重新运行"
    }

    switch ($status) {
        'ALL_DONE' { Stop-Loop '全部任务完成' }
        'NO_ACTIONABLE' { Stop-Loop '没有可以做的任务：请处理 docs/dev/HUMAN.md 里的阻塞事项' }
        'MILESTONE_DONE' { if ($PauseAtMilestone) { Stop-Loop "里程碑完成（$task），请查看 docs/dev/reports/" } }
    }

    $failed = ($status -eq 'NO_RESULT') -or (-not $gateOk) -or (($headAfter -eq $headBefore) -and $status -ne 'BLOCKED')
    if ($failed) { $failures++ } else { $failures = 0 }
    if ($failures -ge $MaxFailures) {
        Stop-Loop "连续 $failures 个会话失败或没有进展。请查看 .devloop/logs/ 和 .devloop/gate.txt"
    }
    if ($Once) { Stop-Loop '-Once：只运行一个会话' }
}
Stop-Loop "达到最大会话数 $MaxSessions"
