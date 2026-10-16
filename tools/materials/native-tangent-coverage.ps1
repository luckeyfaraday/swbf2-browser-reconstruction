$ErrorActionPreference = 'Stop'
$coverageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$coverageCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$coverageExecutable = Join-Path $PSScriptRoot 'native-tangent-coverage.exe'
$coverageSdk = Join-Path $coverageRoot 'tools/frosty-1.0.5.2/FrostySdk.dll'
$coverageSources = @('tools/materials/native-tangent-coverage.cs', 'tools/bf2-extract/Historical.cs',
    'tools/bf2-extract/Json.cs') | ForEach-Object { Join-Path $coverageRoot $_ }
& $coverageCompiler /nologo /platform:x64 /optimize+ ('/out:' + $coverageExecutable) ('/reference:' + $coverageSdk) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll @coverageSources
if ($LASTEXITCODE -ne 0) { throw 'Native tangent coverage extractor compilation failed' }
& $coverageExecutable
if ($LASTEXITCODE -ne 0) { throw 'Native tangent coverage extraction failed' }
