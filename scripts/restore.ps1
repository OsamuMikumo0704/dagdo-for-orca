param([Parameter(Mandatory)][string]$Generation, [switch]$WritesStopped)
. "$PSScriptRoot\common.ps1"
if (Get-DagdoOwnedProcess) { throw 'Stop the UI before restoring.' }
if (!$WritesStopped) { throw 'Stop all agent writes, then pass -WritesStopped.' }
$code = Invoke-DagdoChild -Arguments @('run', (Join-Path $PSScriptRoot 'local.ts'), 'restore', $Generation)
exit $code
