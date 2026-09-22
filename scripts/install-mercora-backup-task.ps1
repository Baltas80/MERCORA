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

# Run as the invoking user with the limited task-run level. Do not install the
# backup scheduler as SYSTEM/highest-privilege: the scheduler launches Node.js
# and Docker, so elevating the whole process would violate least privilege.
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if ([string]::IsNullOrWhiteSpace($CurrentUser) -or $CurrentUser -eq 'NT AUTHORITY\SYSTEM') {
  throw 'Run this installer from the intended MERCORA service/admin account; SYSTEM is not accepted.'
}

$Action = New-ScheduledTaskAction -Execute $Node -Argument ('"{0}"' -f $Script) -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
Write-Output "Installed $TaskName every $IntervalHours hour(s) for $CurrentUser with limited privileges."
Write-Output "Repository: $RepoRoot"
Write-Output "Backup directory: $(Join-Path $RepoRoot 'backups')"
