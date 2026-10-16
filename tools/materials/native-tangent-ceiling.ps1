$ErrorActionPreference = 'Stop'
$ceilingRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ceilingCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
foreach ($ceilingLayout in @('signed', 'explicit')) {
  $ceilingSource = if ($ceilingLayout -eq 'signed') { 'native-tangent-coverage.cs' } else { 'native-tangent44.cs' }
  $ceilingExe = Join-Path $PSScriptRoot ('native-tangent-ceiling-' + $ceilingLayout + '.exe')
  & $ceilingCompiler /nologo /platform:x64 /optimize+ ('/out:' + $ceilingExe) ('/reference:' + (Join-Path $ceilingRoot 'tools/frosty-1.0.5.2/FrostySdk.dll')) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll (Join-Path $PSScriptRoot $ceilingSource) (Join-Path $ceilingRoot 'tools/bf2-extract/Historical.cs') (Join-Path $ceilingRoot 'tools/bf2-extract/Json.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Ceiling original tangent extractor compilation failed' }
  $ceilingStrides = if ($ceilingLayout -eq 'signed') { @(32) } else { @(44) }
  foreach ($ceilingStride in $ceilingStrides) {
    & $ceilingExe (Join-Path $ceilingRoot ('exports/materials/native-tangent-ceiling' + $ceilingStride)) $ceilingStride
    if ($LASTEXITCODE -ne 0) { throw 'Ceiling original tangent extraction failed' }
  }
}
