$ErrorActionPreference = 'Stop'
$volcanicRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$volcanicOutput = Join-Path $volcanicRoot 'exports\materials\volcanic-object-shader\warp.exe'
$volcanicRefs = @('SharpDX','SharpDX.Direct3D11','SharpDX.DXGI','SharpDX.Mathematics','SharpDX.D3DCompiler') | ForEach-Object {
    '/reference:' + (Join-Path $volcanicRoot ('tools\frosty-1.0.5.2\ThirdParty\' + $_ + '.dll'))
}
& C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /platform:x64 /optimize+ ('/out:' + $volcanicOutput) @volcanicRefs /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'volcanic-object-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Volcanic original pixel fixture compilation failed' }
& $volcanicOutput $volcanicRoot
if ($LASTEXITCODE -ne 0) { throw 'Volcanic original pixel WARP failed' }
