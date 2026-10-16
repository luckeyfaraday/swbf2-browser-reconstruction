$ErrorActionPreference = 'Stop'
$propsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$propsSources = @('Program.cs','Historical.cs','Json.cs','ConvertAssets.cs','MeshInfo.cs') | ForEach-Object { Join-Path "$propsRoot\tools\bf2-extract" $_ }
& C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe /nologo /platform:x64 /optimize+ /main:PropsPresetUvExtract "/out:$propsRoot\tools\materials\propspreset-extract-uv.exe" "/reference:$propsRoot\tools\frosty-1.0.5.2\FrostySdk.dll" /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll @propsSources "$propsRoot\tools\materials\ShaderBlocks.cs" "$propsRoot\tools\materials\propspreset-extract-uv.cs"
if ($LASTEXITCODE -ne 0) { throw 'PropsPreset source UV extractor compilation failed' }
& "$propsRoot/tools/materials/propspreset-extract-uv.exe"
if ($LASTEXITCODE -ne 0) { throw 'PropsPreset original UV recovery failed' }
