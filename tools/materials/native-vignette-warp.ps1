$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output = Join-Path $workspace 'exports\lighting\native-vignette-warp.exe'
$references = @('SharpDX','SharpDX.Direct3D11','SharpDX.DXGI','SharpDX.Mathematics','SharpDX.D3DCompiler') | ForEach-Object {
    '/reference:' + (Join-Path $workspace ('tools\frosty-1.0.5.2\ThirdParty\' + $_ + '.dll'))
}
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /platform:x64 /optimize+ ('/out:' + $output) @references /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'native-vignette-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native vignette witness compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Native vignette witness execution failed' }
