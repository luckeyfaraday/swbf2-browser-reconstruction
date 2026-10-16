param([string]$EvidenceDirectory = 'exports/materials/native-tangent-nonmetal')
$ErrorActionPreference = 'Stop'
$nonmetalRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$nonmetalCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$nonmetalExecutable = Join-Path $PSScriptRoot 'native-tangent-nonmetal.exe'
$nonmetalSources = @('tools/materials/native-tangent-coverage.cs', 'tools/bf2-extract/Historical.cs',
    'tools/bf2-extract/Json.cs') | ForEach-Object { Join-Path $nonmetalRoot $_ }
& $nonmetalCompiler /nologo /platform:x64 /optimize+ ('/out:' + $nonmetalExecutable) ('/reference:' + (Join-Path $nonmetalRoot 'tools/frosty-1.0.5.2/FrostySdk.dll')) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll @nonmetalSources
if ($LASTEXITCODE -ne 0) { throw 'Native nonmetal tangent extractor compilation failed' }
& $nonmetalExecutable (Join-Path $nonmetalRoot $EvidenceDirectory) 32
if ($LASTEXITCODE -ne 0) { throw 'Native nonmetal tangent extraction failed' }
