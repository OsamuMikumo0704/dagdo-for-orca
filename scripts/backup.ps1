. "$PSScriptRoot\common.ps1"
$code = Invoke-DagdoChild -Arguments @('run', (Join-Path $PSScriptRoot 'local.ts'), 'backup')
exit $code
