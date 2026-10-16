$ErrorActionPreference = 'Stop'
$tangentRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tangentCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$tangentExecutable = Join-Path $PSScriptRoot 'native-tangent-witness.exe'
$tangentSdk = Join-Path $tangentRoot 'tools/frosty-1.0.5.2/FrostySdk.dll'
$tangentSources = @('tools/materials/native-tangent-witness.cs', 'tools/bf2-extract/Historical.cs',
    'tools/bf2-extract/Json.cs', 'tools/bf2-extract/ConvertAssets.cs') | ForEach-Object { Join-Path $tangentRoot $_ }
& $tangentCompiler /nologo /platform:x64 /optimize+ ('/out:' + $tangentExecutable) ('/reference:' + $tangentSdk) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll @tangentSources
if ($LASTEXITCODE -ne 0) { throw 'Native tangent witness extractor compilation failed' }
& $tangentExecutable
if ($LASTEXITCODE -ne 0) { throw 'Native tangent witness extraction failed' }
