$ErrorActionPreference = 'Stop'
$coverageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$coverageDirectory = Join-Path $coverageRoot 'exports/materials/native-tangent-coverage'
$coverageExecutable = Join-Path $coverageDirectory 'warp.exe'
$coverageCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$coverageReferences = @('SharpDX', 'SharpDX.Direct3D11', 'SharpDX.DXGI', 'SharpDX.Mathematics') | ForEach-Object {
    '/reference:' + (Join-Path $coverageRoot ('tools/frosty-1.0.5.2/ThirdParty/' + $_ + '.dll'))
}
& $coverageCompiler /nologo /platform:x64 /optimize+ ('/out:' + $coverageExecutable) @coverageReferences /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-tangent-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Tangent coverage WARP helper compilation failed' }
& $coverageExecutable $coverageRoot $coverageDirectory
if ($LASTEXITCODE -ne 0) { throw 'Tangent coverage WARP execution failed' }
