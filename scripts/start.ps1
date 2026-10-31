param([switch]$NoOpen)
. "$PSScriptRoot\common.ps1"
$mutex = [Threading.Mutex]::new($false, $DagdoContext.mutex)
if (!$mutex.WaitOne(10000)) { throw 'Another start/stop operation is running.' }
try {
    if (Get-DagdoOwnedProcess) {
        $state = Get-Content -LiteralPath (Join-Path $DagdoRoot 'local\runtime\server.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $url = if ($state.url) { $state.url } else { 'http://localhost:3737' }
        if (!$NoOpen) { Start-Process $url }; Write-Host "dagdo: $url"; return
    }
    $port = if ($DagdoContext.development) { 3738 } else { 3737 }
    if (!$DagdoContext.development) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 3737)
        try { $listener.Start() } catch { throw 'Port 3737 is already in use. No second server was started.' } finally { $listener.Stop() }
    }
    if (!(Test-Path -LiteralPath (Join-Path $DagdoApp 'dist\web\index.html'))) { throw 'Run scripts/check.ps1 to build the UI first.' }
    foreach ($folder in @('data','backups','local\logs','local\runtime','local\test-data')) { New-Item -ItemType Directory -Force -Path (Join-Path $DagdoRoot $folder) | Out-Null }
    $code = Invoke-DagdoChild -Arguments @('run', (Join-Path $PSScriptRoot 'local.ts'), 'backup')
    if ($code -ne 0) { throw 'Backup failed. Server was not started.' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdout = Join-Path $DagdoRoot "local\logs\$stamp.out.log"
    $stderr = Join-Path $DagdoRoot "local\logs\$stamp.err.log"
    Write-Host "$(if ($DagdoContext.development) { 'Development' } else { 'Local' }) data: $DagdoData"
    # Start-Process -Environment requires PowerShell 7.4. Set process-local
    # values only while launching, then restore the caller's environment.
    $serverEnvironment = @{ DAGDO_DATA_DIR=$DagdoData; DAGDO_BACKUP_DIR=$DagdoBackup; DAGDO_LOCAL_MODE='1' }
    $previousEnvironment = @{}
    foreach ($key in $serverEnvironment.Keys) { $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
    try {
        foreach ($key in $serverEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $serverEnvironment[$key], 'Process') }
        $serverArguments = ConvertTo-DagdoArguments @('run', (Join-Path $DagdoApp 'src\cli.ts'), 'ui', '--port', "$port", '--no-open')
        $child = Start-Process -FilePath $DagdoBun -ArgumentList $serverArguments -WorkingDirectory $DagdoApp -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    } finally {
        foreach ($key in $serverEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process') }
    }
    $ready = $false
    for ($i=0; $i -lt 100; $i++) {
        Start-Sleep -Milliseconds 100; $child.Refresh()
        if ($child.HasExited) { throw "Server exited. See $stderr" }
        if ((Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue) -match 'dagdo ui running at (http://[^\s\x1b]+)') { $url=$Matches[1]; $ready=$true; break }
    }
    if (!$ready) { Stop-Process -Id $child.Id; throw "Server startup timed out. See $stderr" }
    $stateJson = @{pid=$child.Id; startTicks=$child.StartTime.ToUniversalTime().Ticks.ToString(); executable=$DagdoBun; url=$url} | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $DagdoRoot 'local\runtime\server.json'), $stateJson, [Text.UTF8Encoding]::new($false))
    if (!$NoOpen) { Start-Process $url }
    Write-Host "dagdo: $url"
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
