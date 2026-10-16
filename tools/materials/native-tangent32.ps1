$ErrorActionPreference = 'Stop'
$tangent32Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tangent32Compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$tangent32Executable = Join-Path $PSScriptRoot 'native-tangent32.exe'
$tangent32Sources = @('tools/materials/native-tangent-coverage.cs', 'tools/bf2-extract/Historical.cs',
    'tools/bf2-extract/Json.cs') | ForEach-Object { Join-Path $tangent32Root $_ }
& $tangent32Compiler /nologo /platform:x64 /optimize+ ('/out:' + $tangent32Executable) ('/reference:' + (Join-Path $tangent32Root 'tools/frosty-1.0.5.2/FrostySdk.dll')) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll @tangent32Sources
if ($LASTEXITCODE -ne 0) { throw 'Native32-byte tangent extractor compilation failed' }
& $tangent32Executable (Join-Path $tangent32Root 'exports/materials/native-tangent32') 32
if ($LASTEXITCODE -ne 0) { throw 'Native32-byte tangent extraction failed' }
