param([string]$EvidenceDirectory = 'exports/materials/native-tangent44')
$ErrorActionPreference = 'Stop'
$explicit44Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$explicit44Compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$explicit44Executable = Join-Path $PSScriptRoot 'native-tangent44.exe'
$explicit44Sources = @('tools/materials/native-tangent44.cs', 'tools/bf2-extract/Historical.cs',
    'tools/bf2-extract/Json.cs') | ForEach-Object { Join-Path $explicit44Root $_ }
& $explicit44Compiler /nologo /platform:x64 /optimize+ ('/out:' + $explicit44Executable) ('/reference:' + (Join-Path $explicit44Root 'tools/frosty-1.0.5.2/FrostySdk.dll')) /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll @explicit44Sources
if ($LASTEXITCODE -ne 0) { throw 'Native explicit44 tangent extractor compilation failed' }
& $explicit44Executable (Join-Path $explicit44Root $EvidenceDirectory) 44
if ($LASTEXITCODE -ne 0) { throw 'Native explicit44 tangent extraction failed' }
