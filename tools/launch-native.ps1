$ErrorActionPreference = 'Stop'
$gameDir = if ($env:BF2_GAME_DIR) { $env:BF2_GAME_DIR } else { 'C:\Games\Star Wars - Battlefront 2' }
$target = Join-Path $gameDir 'starwarsbattlefrontii.exe'
# The shipped manifest requests asInvoker, but the installer added RUNASADMIN
# compatibility metadata. Run only with this worker's existing privileges.
# This process-scoped setting does not grant elevation or alter registry/policy.
$info = [System.Diagnostics.ProcessStartInfo]::new($target)
$info.WorkingDirectory = Split-Path -Parent $target
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$info.Environment['__COMPAT_LAYER'] = 'RunAsInvoker'
$native = [System.Diagnostics.Process]::Start($info)
$launchRecord=@{pid=$native.Id;startedUtc=[DateTimeOffset]::UtcNow.ToString('o');path=$target;purpose='Authorized local offline observation';privilege='current worker, no elevation';processCompatibility='RunAsInvoker';arguments=@()}
$launchRecord.exitedWithin10Seconds=$native.WaitForExit(10000)
if ($launchRecord.exitedWithin10Seconds) { $launchRecord.exitCode=$native.ExitCode }
$launchRecord | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '..\evidence\native-launch.json')
$native | Select-Object Id, ProcessName
