param([int]$Port = 7737, [switch]$IntegratedGpu, [string]$Hero = '')
# Starts the local server if needed and opens the game in its own Chrome app window.
# On hybrid laptops Chrome ignores WebGL's high-performance request and renders on
# the integrated GPU; --force_high_performance_gpu selects the discrete one. A
# dedicated profile makes the flag apply even when normal Chrome is already open
# and keeps Chrome's GPU shader cache between launches (much faster reloads).
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
& (Join-Path $PSScriptRoot 'start-local.ps1') -Port $Port
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome or Edge was not found; open http://127.0.0.1:' + $Port + '/ manually.' }
$profileDir = Join-Path $workspace '.local\chrome-profile'
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
# -Hero darthvader preselects a playable hero in the menu.
$url = "http://127.0.0.1:$Port/" + $(if ($Hero) { "?hero=$Hero" } else { '' })
$arguments = @("--user-data-dir=`"$profileDir`"", "--app=$url", '--start-maximized', '--no-first-run', '--no-default-browser-check')
if (-not $IntegratedGpu) { $arguments += '--force_high_performance_gpu' }
Start-Process -FilePath $chrome -ArgumentList $arguments | Out-Null
Write-Output "Opened $url in $(Split-Path -Leaf $chrome)$(if (-not $IntegratedGpu) { ' on the discrete GPU' })."
