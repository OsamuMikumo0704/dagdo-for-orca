. "$PSScriptRoot\common.ps1"
$powerShell = (Get-Process -Id $PID).Path
$shell = New-Object -ComObject WScript.Shell
# Keep legacy Japanese shortcut names readable without a UTF-8 BOM on PS 5.1.
$legacyStop = 'dagdo' + [char]0x505c + [char]0x6b62 + '.lnk'
$legacyStart = 'dagdo' + [char]0x8d77 + [char]0x52d5 + '.lnk'
foreach($destination in @($DagdoRoot, [Environment]::GetFolderPath('Desktop'))) {
    foreach ($name in @('dagdo Stop.lnk', $legacyStop)) {
        $old = Join-Path $destination $name
        if (Test-Path -LiteralPath $old) {
            $link = $shell.CreateShortcut($old)
            $expected = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'stop.ps1') + '"'
            if ($link.Arguments -eq $expected) { Remove-Item -LiteralPath $old; Write-Host "Removed: $old" }
        }
    }
    if (Test-Path -LiteralPath (Join-Path $destination $legacyStart)) { continue }
    foreach($entry in ,@('dagdo Start','start.ps1')) {
        $file = Join-Path $destination ($entry[0] + '.lnk')
        if(Test-Path -LiteralPath $file) { Write-Host "Exists, preserved: $file"; continue }
        $shortcut = $shell.CreateShortcut($file)
        $shortcut.TargetPath = $powerShell
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot $entry[1]) + '"'
        $shortcut.WorkingDirectory = $DagdoApp
        $shortcut.WindowStyle = 7
        $shortcut.Save()
        Write-Host $file
    }
}
