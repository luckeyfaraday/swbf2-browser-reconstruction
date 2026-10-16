$ErrorActionPreference = 'Stop'
$metalRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$metalExecutable = Join-Path $PSScriptRoot 'native-tangent-array2uv-composite44-warp.exe'
$metalCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$metalReferences = @('SharpDX','SharpDX.Direct3D11','SharpDX.DXGI','SharpDX.Mathematics') | ForEach-Object { '/reference:' + (Join-Path $metalRoot ('tools/frosty-1.0.5.2/ThirdParty/' + $_ + '.dll')) }
& $metalCompiler /nologo /platform:x64 /optimize+ ('/out:' + $metalExecutable) @metalReferences /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-tangent-array2uv-composite44-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Array2UV original WARP helper compilation failed' }
foreach ($metalStride in @(44)) {
  & $metalExecutable $metalRoot (Join-Path $metalRoot ('exports/materials/native-tangent-array2uv-composite' + $metalStride)) $metalStride
  if ($LASTEXITCODE -ne 0) { throw 'Array2UV original WARP execution failed' }
}
