param(
    [string]$Names = 'exports/lighting/native-shadow-caster-names.txt',
    [string]$OutputDirectory = 'exports/lighting/native-shadow-casters',
    [switch]$Geometry
)
$ErrorActionPreference = 'Stop'
$casterRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$casterCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$casterExecutable = Join-Path $PSScriptRoot 'native-shadow-casters.exe'
$casterSdk = Join-Path $casterRoot 'tools/frosty-1.0.5.2/FrostySdk.dll'
$casterSources = @('tools/materials/native-shadow-casters.cs', 'tools/bf2-extract/Historical.cs',
    'tools/bf2-extract/Json.cs', 'tools/bf2-extract/ConvertAssets.cs') | ForEach-Object { Join-Path $casterRoot $_ }
& $casterCompiler /nologo /platform:x64 /optimize+ ('/out:' + $casterExecutable) ('/reference:' + $casterSdk) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll @casterSources
if ($LASTEXITCODE -ne 0) { throw 'Native caster metadata extractor compilation failed' }
$casterArguments = @((Join-Path $casterRoot $Names), (Join-Path $casterRoot $OutputDirectory))
if ($Geometry) { $casterArguments += '--geometry' }
& $casterExecutable @casterArguments
if ($LASTEXITCODE -ne 0) { throw 'Native caster metadata extraction failed' }
