$ErrorActionPreference = 'Stop'
$atlasRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$atlasOutput = Join-Path $atlasRoot 'exports\lighting\static-atlas-warp.exe'
$atlasRefs = @('SharpDX','SharpDX.Direct3D11','SharpDX.DXGI','SharpDX.Mathematics','SharpDX.D3DCompiler') | ForEach-Object {
    '/reference:' + (Join-Path $atlasRoot ('tools\frosty-1.0.5.2\ThirdParty\' + $_ + '.dll'))
}
& C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /platform:x64 /optimize+ ('/out:' + $atlasOutput) @atlasRefs /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-static-atlas-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Atlas fixture compilation failed' }
& $atlasOutput $atlasRoot
if ($LASTEXITCODE -ne 0) { throw 'Original atlas PS CPU validation failed' }
