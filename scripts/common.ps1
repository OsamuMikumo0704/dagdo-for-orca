#requires -Version 5.1
$ErrorActionPreference = 'Stop'
# Bun emits UTF-8, including Git paths with non-ASCII characters.
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$DagdoApp = Split-Path $PSScriptRoot -Parent
$DagdoRoot = Split-Path $DagdoApp -Parent
$bunCommand = Get-Command bun -CommandType Application -ErrorAction SilentlyContinue
$DagdoBun = if ($bunCommand) { $bunCommand.Source } else { Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }
if (!(Test-Path -LiteralPath $DagdoBun)) { throw 'Install Bun and add it to PATH first.' }
$contextJson = & $DagdoBun run (Join-Path $PSScriptRoot 'environment.ts')
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine worktree environment.' }
$DagdoContext = $contextJson | ConvertFrom-Json
$DagdoRoot = $DagdoContext.root
$DagdoData = if ($env:DAGDO_DATA_DIR) { [IO.Path]::GetFullPath($env:DAGDO_DATA_DIR) } else { $DagdoContext.dataDir }
$DagdoBackup = if ($env:DAGDO_BACKUP_DIR) { [IO.Path]::GetFullPath($env:DAGDO_BACKUP_DIR) } else { $DagdoContext.backupDir }
function ConvertTo-DagdoArguments {
    param([AllowEmptyCollection()][string[]]$Arguments)
    # ProcessStartInfo.ArgumentList is unavailable in Windows PowerShell 5.1.
    # Quote using the Windows argv rules: escape quotes and trailing backslashes.
    $quoted = foreach ($argument in $Arguments) {
        '"' + [regex]::Replace([regex]::Replace($argument, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
    }
    return $quoted -join ' '
}
function New-DagdoProcessInfo {
    param([string[]]$Arguments, [hashtable]$Environment = @{})
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $DagdoBun
    $info.WorkingDirectory = $DagdoApp
    $info.UseShellExecute = $false
    $info.EnvironmentVariables['DAGDO_DATA_DIR'] = $DagdoData
    $info.EnvironmentVariables['DAGDO_BACKUP_DIR'] = $DagdoBackup
    $info.EnvironmentVariables['DAGDO_LOCAL_MODE'] = '1'
    foreach ($key in $Environment.Keys) { $info.EnvironmentVariables[$key] = $Environment[$key] }
    $info.Arguments = ConvertTo-DagdoArguments $Arguments
    return $info
}
function Invoke-DagdoChild {
    param([string[]]$Arguments, [hashtable]$Environment = @{})
    $info = New-DagdoProcessInfo -Arguments $Arguments -Environment $Environment
    $child = [Diagnostics.Process]::Start($info)
    $child.WaitForExit()
    return $child.ExitCode
}
function Get-DagdoOwnedProcess {
    $stateFile = Join-Path $DagdoRoot 'local\runtime\server.json'
    if (!(Test-Path -LiteralPath $stateFile)) { return $null }
    $state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $running = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if ($running -and $running.Path -eq $DagdoBun -and $running.StartTime.ToUniversalTime().Ticks.ToString() -eq $state.startTicks) { return $running }
    return $null
}
