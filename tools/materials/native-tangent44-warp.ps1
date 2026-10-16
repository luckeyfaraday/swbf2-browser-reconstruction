param([string]$EvidenceDirectory = 'exports/materials/native-tangent44')
$ErrorActionPreference = 'Stop'
$tangent44Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tangent44Directory = Join-Path $tangent44Root $EvidenceDirectory
$tangent44Executable = Join-Path $tangent44Directory 'warp.exe'
$tangent44Compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$tangent44References = @('SharpDX', 'SharpDX.Direct3D11', 'SharpDX.DXGI', 'SharpDX.Mathematics') | ForEach-Object {
    '/reference:' + (Join-Path $tangent44Root ('tools/frosty-1.0.5.2/ThirdParty/' + $_ + '.dll'))
}
& $tangent44Compiler /nologo /platform:x64 /optimize+ ('/out:' + $tangent44Executable) @tangent44References /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-tangent44-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Tangent44-byte WARP helper compilation failed' }
& $tangent44Executable $tangent44Root $tangent44Directory 44
if ($LASTEXITCODE -ne 0) { throw 'Tangent44-byte WARP execution failed' }
