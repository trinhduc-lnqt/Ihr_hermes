$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logsDir = Join-Path $projectDir "logs"
$logFile = Join-Path $logsDir "boot-service.log"
$stdoutLog = Join-Path $logsDir "bot-stdout.log"
$stderrLog = Join-Path $logsDir "bot-stderr.log"
$scriptPath = Join-Path $projectDir "src\index.js"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Write-Log {
  param([string]$Message)

  Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

function Resolve-NodePath {
  $candidates = @(
    "C:\Program Files\nodejs\node.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  ) | Where-Object { $_ -and (Test-Path $_) }

  $candidates = @($candidates)

  if ($candidates.Count -gt 0) {
    return $candidates[0]
  }

  return (Get-Command node -ErrorAction Stop).Source
}

function Get-BotNodeProcess {
  param([string]$ResolvedScriptPath)

  $needle = [System.IO.Path]::GetFullPath($ResolvedScriptPath).ToLowerInvariant()

  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle)
  }
}

$nodePath = Resolve-NodePath
Write-Log ("Boot service wrapper started as {0}. Node: {1}" -f [System.Security.Principal.WindowsIdentity]::GetCurrent().Name, $nodePath)

while ($true) {
  $existing = @(Get-BotNodeProcess -ResolvedScriptPath $scriptPath)
  if ($existing.Count -gt 0) {
    $pids = ($existing | ForEach-Object { $_.ProcessId }) -join ", "
    Write-Log ("Detected existing bot process PID(s): {0}. Sleep 30s." -f $pids)
    Start-Sleep -Seconds 30
    continue
  }

  try {
    Write-Log ("Starting bot process with node: {0}" -f $nodePath)
    $process = Start-Process `
      -FilePath $nodePath `
      -ArgumentList @('"' + $scriptPath + '"') `
      -WorkingDirectory $projectDir `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -PassThru `
      -WindowStyle Hidden
    $process.WaitForExit()
    Write-Log ("Bot exited with code {0}. Restart in 5s." -f $process.ExitCode)
  } catch {
    Write-Log ("Failed to start bot process: {0}" -f $_.Exception.Message)
  }
  Start-Sleep -Seconds 5
}
