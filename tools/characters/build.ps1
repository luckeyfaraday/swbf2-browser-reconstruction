param([string]$Runtime = (Join-Path $PSScriptRoot '..\frosty-1.0.5.2'))
$ErrorActionPreference = 'Stop'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
Push-Location $PSScriptRoot
try {
    $sharedSources = @('Program.cs', 'Historical.cs', 'Json.cs', 'ConvertAssets.cs') | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\bf2-extract\$_")) }
    $sharedSources += [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\materials\ShaderBlocks.cs'))
    & $compiler /nologo /platform:x64 /optimize+ /main:CharacterProgram /out:character-extract.exe "/reference:$Runtime\FrostySdk.dll" /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll CharacterProgram.cs @sharedSources
    if ($LASTEXITCODE -ne 0) { throw 'Compilation failed' }
} finally { Pop-Location }
