param([string]$Folder = 'exports/lighting/static-atlas-sample')
$ErrorActionPreference = 'Stop'
$atlasRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$atlasOutput = Join-Path $atlasRoot 'exports\lighting\static-atlas-decode.exe'
$atlasRefs = @('SharpDX','SharpDX.Direct3D11','SharpDX.DXGI','SharpDX.Mathematics','SharpDX.D3DCompiler') | ForEach-Object {
    '/reference:' + (Join-Path $atlasRoot ('tools\frosty-1.0.5.2\ThirdParty\' + $_ + '.dll'))
}
& C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /platform:x64 /optimize+ ('/out:' + $atlasOutput) @atlasRefs /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll (Join-Path $PSScriptRoot 'native-static-atlas-decode.cs')
if ($LASTEXITCODE -ne 0) { throw 'Atlas diagnostic compilation failed' }
& $atlasOutput $atlasRoot (Join-Path $atlasRoot $Folder)
if ($LASTEXITCODE -ne 0) { throw 'Atlas CPU decode failed' }
