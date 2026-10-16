param(
    [string]$Names = 'exports/lighting/static-atlas-uv-names.txt',
    [string]$OutputDirectory = 'exports/lighting/static-atlas-uv'
)
$ErrorActionPreference = 'Stop'
$atlasRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$atlasCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$atlasExecutable = Join-Path $PSScriptRoot 'native-static-atlas-uv.exe'
$atlasSdk = Join-Path $atlasRoot 'tools/frosty-1.0.5.2/FrostySdk.dll'
$atlasSources = @('tools/materials/native-static-atlas-uv.cs', 'tools/bf2-extract/Historical.cs',
    'tools/bf2-extract/Json.cs', 'tools/bf2-extract/ConvertAssets.cs') | ForEach-Object { Join-Path $atlasRoot $_ }
& $atlasCompiler /nologo /platform:x64 /optimize+ ('/out:' + $atlasExecutable) ('/reference:' + $atlasSdk) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll @atlasSources
if ($LASTEXITCODE -ne 0) { throw 'Native atlas UV extractor compilation failed' }
& $atlasExecutable (Join-Path $atlasRoot $Names) (Join-Path $atlasRoot $OutputDirectory)
if ($LASTEXITCODE -ne 0) { throw 'Native atlas UV extraction failed' }
