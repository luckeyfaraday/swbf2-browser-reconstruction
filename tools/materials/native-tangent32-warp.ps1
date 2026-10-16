param([string]$EvidenceDirectory = 'exports/materials/native-tangent32')
$ErrorActionPreference = 'Stop'
$tangent32Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tangent32Directory = Join-Path $tangent32Root $EvidenceDirectory
$tangent32Executable = Join-Path $tangent32Directory 'warp.exe'
$tangent32Compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$tangent32References = @('SharpDX', 'SharpDX.Direct3D11', 'SharpDX.DXGI', 'SharpDX.Mathematics') | ForEach-Object {
    '/reference:' + (Join-Path $tangent32Root ('tools/frosty-1.0.5.2/ThirdParty/' + $_ + '.dll'))
}
& $tangent32Compiler /nologo /platform:x64 /optimize+ ('/out:' + $tangent32Executable) @tangent32References /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-tangent-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Tangent32-byte WARP helper compilation failed' }
& $tangent32Executable $tangent32Root $tangent32Directory 32
if ($LASTEXITCODE -ne 0) { throw 'Tangent32-byte WARP execution failed' }
