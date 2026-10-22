# Registers (or updates) a Windows Task Scheduler task "ams-bot" that runs every day at 07:00.
# Usage:  npm run schedule              (register / update)
#         npm run schedule -- -Remove   (delete the task)
param([switch]$Remove, [string]$Time = '07:00')

$TaskName = 'ams-bot'
$Root = Split-Path -Parent $PSScriptRoot

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task '$TaskName' removed."
    exit 0
}

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$Root\scripts\run-daily.cmd`"`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# StartWhenAvailable: if the PC was off/asleep at 07:00, run as soon as it is back on.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Finds student jobs on jobs.ams.at, applies by email, sends a daily report.' -Force | Out-Null

Write-Host "Task '$TaskName' registered: daily at $Time."
Write-Host "Run it now:      schtasks /run /tn $TaskName"
Write-Host "Check status:    schtasks /query /tn $TaskName /v /fo list"
Write-Host "Output goes to:  $Root\logs\scheduler.log and $Root\logs\run-*.log"
