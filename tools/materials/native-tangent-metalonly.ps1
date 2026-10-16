$ErrorActionPreference = 'Stop'
$metalRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$metalCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
foreach ($metalLayout in @('signed', 'explicit')) {
  $metalSource = if ($metalLayout -eq 'signed') { 'native-tangent-coverage.cs' } else { 'native-tangent44.cs' }
  $metalExe = Join-Path $PSScriptRoot ('native-tangent-metalonly-' + $metalLayout + '.exe')
  & $metalCompiler /nologo /platform:x64 /optimize+ ('/out:' + $metalExe) ('/reference:' + (Join-Path $metalRoot 'tools/frosty-1.0.5.2/FrostySdk.dll')) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll (Join-Path $PSScriptRoot $metalSource) (Join-Path $metalRoot 'tools/bf2-extract/Historical.cs') (Join-Path $metalRoot 'tools/bf2-extract/Json.cs')
  if ($LASTEXITCODE -ne 0) { throw 'MetalOnly original tangent extractor compilation failed' }
  $metalStrides = if ($metalLayout -eq 'signed') { @(32,36) } else { @(44) }
  foreach ($metalStride in $metalStrides) {
    & $metalExe (Join-Path $metalRoot ('exports/materials/native-tangent-metalonly' + $metalStride)) $metalStride
    if ($LASTEXITCODE -ne 0) { throw 'MetalOnly original tangent extraction failed' }
  }
}
