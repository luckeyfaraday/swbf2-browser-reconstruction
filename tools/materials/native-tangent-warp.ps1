$ErrorActionPreference = 'Stop'
$tangentRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tangentOutput = Join-Path $tangentRoot 'exports/materials/native-tangent-witness/warp.exe'
$tangentCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$tangentReferences = @('SharpDX', 'SharpDX.Direct3D11', 'SharpDX.DXGI', 'SharpDX.Mathematics') | ForEach-Object {
    '/reference:' + (Join-Path $tangentRoot ('tools/frosty-1.0.5.2/ThirdParty/' + $_ + '.dll'))
}
& $tangentCompiler /nologo /platform:x64 /optimize+ ('/out:' + $tangentOutput) @tangentReferences /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-tangent-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Tangent WARP helper compilation failed' }
& $tangentOutput $tangentRoot
if ($LASTEXITCODE -ne 0) { throw 'Tangent WARP execution failed' }
