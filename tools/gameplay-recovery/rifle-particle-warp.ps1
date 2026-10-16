$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output = Join-Path $workspace 'exports\rifle-trail\particle-warp\run.exe'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$references = @('SharpDX', 'SharpDX.Direct3D11', 'SharpDX.DXGI', 'SharpDX.Mathematics') | ForEach-Object {
    '/reference:' + (Join-Path $workspace ('tools\frosty-1.0.5.2\ThirdParty\' + $_ + '.dll'))
}
& $compiler /nologo /platform:x64 /optimize+ ('/out:' + $output) @references /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'rifle-particle-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Particle WARP helper compilation failed' }
& $output $workspace
if ($LASTEXITCODE -ne 0) { throw 'Particle WARP execution failed' }
