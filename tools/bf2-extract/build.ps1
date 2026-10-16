param([string]$Runtime = (Join-Path $PSScriptRoot '..\frosty-1.0.5.2'), [string]$Output = 'bf2-extract.exe')
$ErrorActionPreference = 'Stop'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
Push-Location $PSScriptRoot
try {
    & $compiler /nologo /platform:x64 /optimize+ "/out:$Output" "/reference:$Runtime\FrostySdk.dll" /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll Program.cs Historical.cs Json.cs ConvertAssets.cs MeshInfo.cs ..\materials\ShaderBlocks.cs
    if ($LASTEXITCODE -ne 0) { throw 'Compilation failed' }
} finally { Pop-Location }
