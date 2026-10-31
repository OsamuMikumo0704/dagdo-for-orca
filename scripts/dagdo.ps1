. "$PSScriptRoot\common.ps1"
$previousDagdoCallerCwd = $env:DAGDO_CALLER_CWD
try {
    $env:DAGDO_CALLER_CWD = (Get-Location).Path
    $code = Invoke-DagdoChild -Arguments (@('run', (Join-Path $DagdoApp 'src\cli.ts')) + $args)
} finally { $env:DAGDO_CALLER_CWD = $previousDagdoCallerCwd }
exit $code
