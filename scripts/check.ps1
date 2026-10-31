. "$PSScriptRoot\common.ps1"
$testDir = Join-Path $DagdoRoot ('local\test-data\check-' + [Guid]::NewGuid())
$checkEnvironment = @{
    DAGDO_DATA_DIR = $testDir
    DAGDO_LOCAL_MODE = '0'
    DAGDO_TEST_PWSH = (Get-Process -Id $PID).Path
    PATH = (Split-Path $DagdoBun -Parent) + ';' + $env:PATH
}
foreach ($command in @(@('test'), @('run','typecheck'), @('run','build:web'))) {
    $code = Invoke-DagdoChild -Arguments $command -Environment $checkEnvironment
    if ($code -ne 0) { exit $code }
}
