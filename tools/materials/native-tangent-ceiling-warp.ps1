$ErrorActionPreference = 'Stop'
$ceilingRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ceilingExecutable = Join-Path $PSScriptRoot 'native-tangent-ceiling-warp.exe'
$ceilingCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$ceilingReferences = @('SharpDX','SharpDX.Direct3D11','SharpDX.DXGI','SharpDX.Mathematics') | ForEach-Object { '/reference:' + (Join-Path $ceilingRoot ('tools/frosty-1.0.5.2/ThirdParty/' + $_ + '.dll')) }
& $ceilingCompiler /nologo /platform:x64 /optimize+ ('/out:' + $ceilingExecutable) @ceilingReferences /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-tangent-ceiling-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Ceiling original WARP helper compilation failed' }
foreach ($ceilingStride in @(32,44)) {
  & $ceilingExecutable $ceilingRoot (Join-Path $ceilingRoot ('exports/materials/native-tangent-ceiling' + $ceilingStride)) $ceilingStride
  if ($LASTEXITCODE -ne 0) { throw 'Ceiling original WARP execution failed' }
}
