[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('START', 'STOP', 'RESTART', 'STATUS', 'HEALTH_CHECK', 'RECOVER')]
    [string]$Action,

    [Parameter(Position = 1)]
    [ValidateSet('backend', 'postgres', 'tor')]
    [string]$Service
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Windows execution boundary for installations where Docker is not the service manager.
# Only these three named Windows services are reachable. No command text is accepted.
$ServiceMap = @{
    backend = 'MERCORA-Backend'
    postgres = 'MERCORA-PostgreSQL'
    tor = 'MERCORA-Tor'
}

function Get-MercoraService {
    param([Parameter(Mandatory = $true)][string]$Key)
    if (-not $ServiceMap.ContainsKey($Key)) { throw 'Unsupported MERCORA service' }
    Get-Service -Name $ServiceMap[$Key] -ErrorAction Stop
}

function Get-ServiceState {
    param([Parameter(Mandatory = $true)][string]$Key)
    try {
        $service = Get-MercoraService -Key $Key
        return [ordered]@{
            name = $Key
            windowsService = $service.Name
            displayName = $service.DisplayName
            status = [string]$service.Status
            ok = ($service.Status -eq 'Running')
        }
    } catch {
        return [ordered]@{
            name = $Key
            windowsService = $ServiceMap[$Key]
            displayName = $null
            status = 'UNAVAILABLE'
            ok = $false
            diagnostic = $_.Exception.Message
        }
    }
}

function Invoke-ServiceAction {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][ValidateSet('Start', 'Stop', 'Restart')][string]$Operation
    )
    $service = Get-MercoraService -Key $Key
    switch ($Operation) {
        'Start' { Start-Service -InputObject $service }
        'Stop' { Stop-Service -InputObject $service -Force }
        'Restart' {
            Restart-Service -InputObject $service -Force
        }
    }
    $service.WaitForStatus($(if ($Operation -eq 'Stop') { 'Stopped' } else { 'Running' }), (New-TimeSpan -Seconds 30))
    Get-ServiceState -Key $Key
}

function Test-Backend {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/healthz' -Method Get -TimeoutSec 5 -UseBasicParsing
        return [ordered]@{ name = 'backend'; ok = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300); status = $response.StatusCode }
    } catch {
        return [ordered]@{ name = 'backend'; ok = $false; status = 'UNAVAILABLE'; diagnostic = $_.Exception.Message }
    }
}

function Invoke-HealthCheck {
    $checks = @(
        (Get-ServiceState -Key 'backend'),
        (Get-ServiceState -Key 'postgres'),
        (Get-ServiceState -Key 'tor'),
        (Test-Backend)
    )
    [ordered]@{ ok = (($checks | Where-Object { -not $_.ok }).Count -eq 0); checks = $checks }
}

function Invoke-Recover {
    $health = Invoke-HealthCheck
    $steps = @()
    $target = $null

    # Target only the first failed service in dependency order. Never restart
    # healthy services and never perform a whole-machine restart.
    foreach ($candidate in @('postgres', 'backend', 'tor')) {
        $check = $health.checks | Where-Object { $_.name -eq $candidate } | Select-Object -First 1
        if ($check -and -not $check.ok) { $target = $candidate; break }
    }

    if ($null -eq $target) {
        return [ordered]@{ ok = $health.ok; target = $null; repaired = $false; steps = @(@{ step = 'diagnosis'; result = $health }) }
    }

    if ($target -eq 'backend') {
        $postgres = $health.checks | Where-Object { $_.name -eq 'postgres' } | Select-Object -First 1
        if (-not $postgres.ok) {
            return [ordered]@{ ok = $false; target = $target; repaired = $false; blocked = $true; steps = @(@{ step = 'dependency-block'; result = @{ dependency = 'postgres'; reason = 'backend recovery blocked because PostgreSQL is not healthy' } }) }
        }
    }

    try {
        $steps += @{ step = "restart:$target"; result = (Invoke-ServiceAction -Key $target -Operation Restart) }
    } catch {
        $steps += @{ step = "restart:$target"; result = @{ ok = $false; diagnostic = $_.Exception.Message } }
    }

    $verification = Invoke-HealthCheck
    $steps += @{ step = 'verify:dependencies'; result = $verification.checks | Where-Object { $_.name -in @('postgres', 'tor') } }
    $steps += @{ step = 'verify:backend'; result = $verification.checks | Where-Object { $_.name -eq 'backend' } }
    $steps += @{ step = 'health'; result = $verification }
    [ordered]@{ ok = $verification.ok; target = $target; repaired = $true; steps = $steps }
}

switch ($Action) {
    'STATUS' { $result = [ordered]@{ ok = $true; services = @((Get-ServiceState -Key 'backend'), (Get-ServiceState -Key 'postgres'), (Get-ServiceState -Key 'tor')); health = Invoke-HealthCheck } }
    'HEALTH_CHECK' { $result = Invoke-HealthCheck }
    'RECOVER' { $result = Invoke-Recover }
    default {
        if ([string]::IsNullOrWhiteSpace($Service)) { throw 'A service is required for START, STOP and RESTART' }
        $operation = @{ START = 'Start'; STOP = 'Stop'; RESTART = 'Restart' }[$Action]
        $result = [ordered]@{ ok = $true; action = $Action; result = (Invoke-ServiceAction -Key $Service -Operation $operation) }
    }
}

$result | ConvertTo-Json -Depth 8 -Compress
