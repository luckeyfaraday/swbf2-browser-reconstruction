param([int]$Port = 7737)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$web = Join-Path $workspace 'web'
$stateDir = Join-Path $workspace '.local'
$node = 'C:\Program Files\nodejs\node.exe'
$vite = Join-Path $web 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $vite)) { throw 'Run npm ci in web before starting the local server.' }
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
  $existing = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener[0].OwningProcess)
  if (-not $existing.CommandLine.Contains($vite)) { throw "Port $Port is occupied by another process; no process was stopped." }
  Write-Output "Existing local port: http://127.0.0.1:$Port/"
  exit 0
}
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$process = Start-Process -FilePath $node -ArgumentList @(('"' + $vite + '"'),'--host','127.0.0.1','--port',"$Port",'--strictPort') -WorkingDirectory $web -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'server.stdout.log') -RedirectStandardError (Join-Path $stateDir 'server.stderr.log')
@{pid=$process.Id;port=$Port;url="http://127.0.0.1:$Port/";startedAtUtc=[DateTime]::UtcNow.ToString('o');kind='explicit-fallback-vite-server';vibeVerify=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir 'server.json') -Encoding utf8
Write-Output "Started local port: http://127.0.0.1:$Port/ (PID $($process.Id)); authentic Vibe CLI remains unavailable."
