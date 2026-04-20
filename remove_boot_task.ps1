$ErrorActionPreference = "Stop"

$taskName = "IHR Telegram Bot Boot"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Output "Khong tim thay Scheduled Task $taskName"
  return
}

if ($task.State -eq "Running") {
  Stop-ScheduledTask -TaskName $taskName
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Output "Da xoa Scheduled Task $taskName"
