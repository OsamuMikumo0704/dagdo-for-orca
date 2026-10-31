. "$PSScriptRoot\common.ps1"
$mutex = [Threading.Mutex]::new($false, $DagdoContext.mutex)
if (!$mutex.WaitOne(10000)) { throw 'Another start/stop operation is running.' }
try {
    $running = Get-DagdoOwnedProcess
    if ($running) { Stop-Process -Id $running.Id; $running.WaitForExit(); Write-Host 'dagdo stopped.' }
    $stateFile = Join-Path $DagdoRoot 'local\runtime\server.json'
    if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
