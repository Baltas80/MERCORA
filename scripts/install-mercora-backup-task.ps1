param(
  [string]$TaskName = 'MERCORA Database Backup',
  [int]$IntervalHours = 6
)

$ErrorActionPreference = 'Stop'
if ($IntervalHours -lt 1 -or $IntervalHours -gt 24) { throw 'IntervalHours must be between 1 and 24.' }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Node = (Get-Command node -ErrorAction Stop).Source
$Script = Join-Path $RepoRoot 'scripts\mercora-backup-scheduler.mjs'

if (-not (Test-Path -LiteralPath $Script -PathType Leaf)) { throw "Backup scheduler not found: $Script" }

$Action = New-ScheduledTaskAction -Execute $Node -Argument ('"{0}"' -f $Script) -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
Write-Output "Installed $TaskName every $IntervalHours hour(s)."
Write-Output "Repository: $RepoRoot"
Write-Output "Backup directory: $(Join-Path $RepoRoot 'backups')"
