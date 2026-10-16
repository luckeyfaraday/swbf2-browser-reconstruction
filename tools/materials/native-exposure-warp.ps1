$ErrorActionPreference = 'Stop'
$exposureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$exposureOutput = Join-Path $exposureRoot 'exports\lighting\native-exposure-warp.exe'
$exposureRefs = @('SharpDX','SharpDX.Direct3D11','SharpDX.DXGI','SharpDX.Mathematics') | ForEach-Object {
    '/reference:' + (Join-Path $exposureRoot ('tools\frosty-1.0.5.2\ThirdParty\' + $_ + '.dll'))
}
& C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /platform:x64 /optimize+ ('/out:' + $exposureOutput) @exposureRefs /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-exposure-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Exposure fixture compilation failed' }
& $exposureOutput $exposureRoot
if ($LASTEXITCODE -ne 0) { throw 'Original exposure shader fixture failed' }
