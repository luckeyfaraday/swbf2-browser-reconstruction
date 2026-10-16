$ErrorActionPreference = 'Stop'
$metalRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$metalCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
foreach ($metalLayout in @('signed')) {
  $metalSource = if ($metalLayout -eq 'signed') { 'native-tangent28.cs' } else { 'native-tangent44.cs' }
  $metalExe = Join-Path $PSScriptRoot ('native-tangent-catwalk128-' + $metalLayout + '.exe')
  & $metalCompiler /nologo /platform:x64 /optimize+ ('/out:' + $metalExe) ('/reference:' + (Join-Path $metalRoot 'tools/frosty-1.0.5.2/FrostySdk.dll')) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll (Join-Path $PSScriptRoot $metalSource) (Join-Path $metalRoot 'tools/bf2-extract/Historical.cs') (Join-Path $metalRoot 'tools/bf2-extract/Json.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Catwalk1 original tangent extractor compilation failed' }
  $metalStrides = if ($metalLayout -eq 'signed') { @(28) } else { @(44) }
  foreach ($metalStride in $metalStrides) {
    & $metalExe (Join-Path $metalRoot ('exports/materials/native-tangent-catwalk1' + $metalStride)) $metalStride
    if ($LASTEXITCODE -ne 0) { throw 'Catwalk1 original tangent extraction failed' }
  }
}
