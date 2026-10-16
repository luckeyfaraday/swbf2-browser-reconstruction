param([switch]$Sdr)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output = Join-Path $workspace 'exports\lighting\native-colorcube-warp.exe'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$references = @('SharpDX', 'SharpDX.Direct3D11', 'SharpDX.DXGI', 'SharpDX.Mathematics') | ForEach-Object {
    '/reference:' + (Join-Path $workspace ('tools\frosty-1.0.5.2\ThirdParty\' + $_ + '.dll'))
}
& $compiler /nologo /platform:x64 /optimize+ ('/out:' + $output) @references /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-colorcube-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Original color cube WARP helper compilation failed' }
if ($Sdr) { & $output --sdr } else { & $output }
if ($LASTEXITCODE -ne 0) { throw 'Original color cube WARP execution failed' }
