#requires -Version 7
<#
.SYNOPSIS
  Dramaticer 自动开发循环：每个会话启动一个全新上下文的 agent 做一个任务，会话之间通过仓库文件交接。

.EXAMPLE
  pwsh -File tools/devloop/devloop.ps1                    # 默认用 omp + magpie DeepSeek V4.1 Flash，跑到停止条件为止
  pwsh -File tools/devloop/devloop.ps1 -Once              # 只跑一个会话
  pwsh -File tools/devloop/devloop.ps1 -PauseAtMilestone  # 每完成一个里程碑就停下
  pwsh -File tools/devloop/devloop.ps1 -Agent dsh         # 改用 DeepSeek Harness 的 headless 模式

  随时停止：在仓库里新建文件 .devloop/STOP（当前会话结束后生效）。

  三类失败分开处理：
  - 基础设施失败（429、额度用完、5xx、网络错误、会话不到 1 分钟就退出）：不算失败；切换到下一个备用模型并退避等待，永不因此停机。
  - 等待长任务（结果 WAITING + .devloop/jobs/<id>.json）：由本脚本执行长任务并等它结束，不消耗会话、不算失败。
  - 真正的失败（没有结果、门禁失败、没有进展）：连续 MaxFailures 次才停机。
#>
[CmdletBinding()]
param(
    [ValidateSet('omp', 'dsh')][string]$Agent = 'omp',
    [string]$Model = '',
    [string[]]$FallbackModels = @(
        'magpie/auto/deepseek-v4.1-flash',
        'magpie/opendesign/deepseek-v4.1-flash',
        'magpie/workbuddy/deepseek-v4.1-flash',
        'magpie/trae-cn/deepseek-v4.1-flash-max'
    ),
    [int]$MaxSessions = 100000,
    [int]$SessionMinutes = 90,
    [int]$MaxFailures = 5,
    [int]$MaxInfraBackoffMinutes = 30,
    [int]$MaxJobMinutes = 600,
    [switch]$PauseAtMilestone,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Repo

$DL = Join-Path $Repo '.devloop'
$LogDir = Join-Path $DL 'logs'
$JobDir = Join-Path $DL 'jobs'
New-Item -ItemType Directory -Force -Path $DL, $LogDir, $JobDir | Out-Null

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
$InfraPattern = '\b(429|500|502|503|504|529)\b|usage limit|rate.?limit|quota|insufficient|overloaded|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|network error|Service Unavailable'

function Write-Info([string]$msg) { Write-Host "[devloop $(Get-Date -Format 'MM-dd HH:mm:ss')] $msg" }

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
        Set-Content $GateFile "PASS`n(no package.json yet)"
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

$SnapshotDir = Join-Path $DL 'protected-snapshot'

function Save-ProtectedSnapshot {
    # 会话之间只有人类会改受保护文件：会话开始前如果和基线不同，视为人类的修改，接受为新基线。
    $current = Get-ProtectedHash
    if ($current -ne (Get-Content $ProtectedHashFile -Raw).Trim()) {
        Set-Content $ProtectedHashFile $current
        Write-Info '受保护文件在会话之间被修改，视为人类修改，已更新基线'
    }
    if (Test-Path $SnapshotDir) { Remove-Item $SnapshotDir -Recurse -Force }
    foreach ($f in $Protected) {
        $src = Join-Path $Repo $f
        if (-not (Test-Path $src)) { continue }
        $dst = Join-Path $SnapshotDir $f
        New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
        Copy-Item $src $dst
    }
}

function Restore-ProtectedFiles {
    # agent 不得修改受保护文件：会话内的修改自动还原为会话开始时的版本，然后继续，而不是停机。
    $restored = @()
    foreach ($f in $Protected) {
        $src = Join-Path $SnapshotDir $f
        $dst = Join-Path $Repo $f
        if (-not (Test-Path $src)) { continue }
        $same = (Test-Path $dst) -and ((Get-FileHash $dst -Algorithm SHA256).Hash -eq (Get-FileHash $src -Algorithm SHA256).Hash)
        if (-not $same) { Copy-Item $src $dst -Force; $restored += $f }
    }
    if ($restored.Count -gt 0) {
        & git add -- $restored
        & git commit -m "chore(devloop): restore protected files ($($restored -join ', '))" | Out-Null
    }
    return $restored
}

function Invoke-PendingJobs {
    # agent 用 .devloop/jobs/<id>.json 申请长任务：{ "command": "...", "timeoutMinutes": 120 }
    # 由本脚本执行并写 <id>.status.json：{ "exitCode": 0, "minutes": 12.3, "log": ".devloop/jobs/<id>.log" }
    $ran = 0
    foreach ($spec in Get-ChildItem $JobDir -Filter '*.json' | Where-Object { $_.Name -notlike '*.status.json' }) {
        $id = [IO.Path]::GetFileNameWithoutExtension($spec.Name)
        $statusFile = Join-Path $JobDir "$id.status.json"
        if (Test-Path $statusFile) { continue }
        try { $job = Get-Content $spec.FullName -Raw | ConvertFrom-Json } catch { continue }
        if (-not $job.command) { continue }
        $limit = [math]::Min([int]($job.timeoutMinutes ?? 120), $MaxJobMinutes)
        $log = Join-Path $JobDir "$id.log"
        Write-Info "执行长任务 $id（上限 $limit 分钟）：$($job.command)"
        $started = Get-Date
        # 用 EncodedCommand 传递，避免命令里的引号被 Windows 命令行解析弄坏
        $script = "& { $($job.command) } *> '$($log.Replace("'", "''"))'; exit `$LASTEXITCODE"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
        $p = Start-Process -FilePath 'C:\Program Files\PowerShell\7\pwsh.exe' `
            -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) `
            -WorkingDirectory $Repo -NoNewWindow -PassThru
        $timedOut = -not $p.WaitForExit($limit * 60 * 1000)
        if ($timedOut) { & taskkill /PID $p.Id /T /F | Out-Null }
        [ordered]@{
            exitCode = $(if ($timedOut) { -1 } else { $p.ExitCode })
            timedOut = $timedOut
            minutes  = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
            log      = ".devloop/jobs/$id.log"
        } | ConvertTo-Json | Set-Content $statusFile
        Write-Info "长任务 $id 结束：exit $(if ($timedOut) { '超时' } else { $p.ExitCode })"
        $ran++
    }
    return $ran
}

# ---------- one-time setup ----------
if (-not (Test-Path (Join-Path $Repo '.git'))) {
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
$models = @()
if ($Model) { $models += $Model }
$models += $FallbackModels | Where-Object { $_ -ne $Model }
$modelIndex = 0

$template = Get-Content (Join-Path $PSScriptRoot 'session-prompt.md') -Raw
$kickoff = '读取并严格执行 .devloop/prompt.md 中的指令。'

$failures = 0
$infraStreak = 0
$lastResult = '无（这是本次循环的第一个会话）'
$gateOk = Invoke-Gate

for ($i = 1; $i -le $MaxSessions; $i++) {
    if (Test-Path $StopFile) { Remove-Item $StopFile; Stop-Loop '检测到 .devloop/STOP' }

    if ((Invoke-PendingJobs) -gt 0) { $gateOk = Invoke-Gate }

    $session = 1 + [int]((Get-Content $CounterFile -ErrorAction SilentlyContinue) ?? 0)
    Set-Content $CounterFile $session
    $currentModel = $models[$modelIndex % $models.Count]

    $gateText = if ($gateOk) { '通过' } else { '失败：详情见 .devloop/gate.txt，本会话必须先修复门禁' }
    $prompt = $template.Replace('{{SESSION}}', "$session").Replace('{{LAST_RESULT}}', $lastResult).Replace('{{GATE}}', $gateText)
    Set-Content (Join-Path $DL 'prompt.md') $prompt
    if (Test-Path $ResultFile) { Remove-Item $ResultFile }

    Save-ProtectedSnapshot
    $headBefore = Get-Head
    $stamp = '{0:D4}' -f $session
    $outLog = Join-Path $LogDir "session-$stamp.out.log"
    $errLog = Join-Path $LogDir "session-$stamp.err.log"
    $started = Get-Date

    if ($Agent -eq 'omp') {
        $argList = @('-p', '--cwd', "`"$Repo`"", '--auto-approve', '--no-title', '--max-time', "$($SessionMinutes)m", '--model', "`"$currentModel`"", "`"$kickoff`"")
    } else {
        $env:DSH_PERMISSION_MODE = 'danger-full-access'
        $argList = @('--profile', 'headless', "`"$kickoff`"")
    }

    Write-Info "会话 $session 开始（$Agent，$currentModel）"
    $proc = Start-Process -FilePath $agentExe -ArgumentList $argList -WorkingDirectory $Repo `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog -NoNewWindow -PassThru
    if (-not $proc.WaitForExit(($SessionMinutes + 10) * 60 * 1000)) {
        Write-Info "会话 $session 超时，结束进程树"
        & taskkill /PID $proc.Id /T /F | Out-Null
    }
    $minutes = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)

    if (& git status --porcelain) {
        & git add -A
        & git commit -m "chore(devloop): autosave after session $session" | Out-Null
    }

    $result = $null
    if (Test-Path $ResultFile) {
        try { $result = Get-Content $ResultFile -Raw | ConvertFrom-Json } catch { $result = $null }
    }
    $status = if ($result) { "$($result.status)" } else { 'NO_RESULT' }
    $task = if ($result) { "$($result.task)" } else { '?' }
    $summary = if ($result) { "$($result.summary)" } else { '会话没有写结果文件（可能崩溃、超时或模型不可用）' }

    $errText = (Get-Content $errLog -Raw -ErrorAction SilentlyContinue) + (Get-Content $outLog -Raw -ErrorAction SilentlyContinue)
    $infra = ($status -eq 'NO_RESULT') -and (($minutes -lt 1) -or ($errText -match $InfraPattern))

    $restored = Restore-ProtectedFiles
    $gateOk = Invoke-Gate
    $headAfter = Get-Head
    $lastResult = "会话 $session，任务 $task，状态 $status：$summary"
    if ($restored.Count -gt 0) { $lastResult += "。注意：你修改了受保护文件 $($restored -join '、')，已被自动还原；需要修改时请写进 HUMAN.md" }

    [ordered]@{
        session = $session; agent = $Agent; model = $currentModel; start = $started.ToString('s'); minutes = $minutes
        task = $task; status = $(if ($infra) { 'INFRA' } else { $status }); gate = $(if ($gateOk) { 'PASS' } else { 'FAIL' })
        progressed = ($headAfter -ne $headBefore); head = $headAfter
    } | ConvertTo-Json -Compress | Add-Content $HistoryFile

    if ($infra) {
        $infraStreak++
        $modelIndex++
        $wait = [math]::Min([math]::Pow(2, [math]::Min($infraStreak, 6)), $MaxInfraBackoffMinutes)
        if ($infraStreak % $models.Count -ne 0) { $wait = 0.5 }  # 先把备用模型轮一遍，再长时间退避
        Write-Info "会话 $session 是基础设施失败（模型不可用或网络错误），不计入失败；切换到 $($models[$modelIndex % $models.Count])，等待 $wait 分钟"
        $lastResult = "上一个会话因模型或网络不可用而中断（不是代码问题）。请先运行 git status 和 pnpm check，接着完成被中断的任务。"
        Start-Sleep -Seconds ([int]($wait * 60))
        continue
    }
    $infraStreak = 0
    Write-Info "会话 $session 结束：$task $status，门禁 $(if ($gateOk) {'PASS'} else {'FAIL'})，耗时 $minutes 分钟"

    switch ($status) {
        'ALL_DONE' { Stop-Loop '全部任务完成' }
        'NO_ACTIONABLE' { Stop-Loop '没有可以做的任务：请处理 docs/dev/HUMAN.md 里的阻塞事项' }
        'MILESTONE_DONE' { if ($PauseAtMilestone) { Stop-Loop "里程碑完成（$task），请查看 docs/dev/reports/" } }
        'WAITING' { $failures = 0; if ($Once) { Stop-Loop '-Once' }; continue }
    }

    $failed = ($status -eq 'NO_RESULT') -or (-not $gateOk) -or (($headAfter -eq $headBefore) -and $status -ne 'BLOCKED')
    if ($failed) { $failures++ } else { $failures = 0 }
    if ($failures -ge $MaxFailures) {
        Stop-Loop "连续 $failures 个会话失败或没有进展（不含模型不可用）。请查看 .devloop/logs/ 和 .devloop/gate.txt"
    }
    if ($Once) { Stop-Loop '-Once：只运行一个会话' }
}
Stop-Loop "达到最大会话数 $MaxSessions"
