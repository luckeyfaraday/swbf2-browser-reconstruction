$ErrorActionPreference = 'Stop'
$propsnonmetalRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$propsnonmetalOutput = Join-Path $propsnonmetalRoot 'exports\materials\propsnonmetal-shader\warp.exe'
$propsnonmetalRefs = @('SharpDX','SharpDX.Direct3D11','SharpDX.DXGI','SharpDX.Mathematics','SharpDX.D3DCompiler') | ForEach-Object {
    '/reference:' + (Join-Path $propsnonmetalRoot ('tools\frosty-1.0.5.2\ThirdParty\' + $_ + '.dll'))
}
& C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /platform:x64 /optimize+ ('/out:' + $propsnonmetalOutput) @propsnonmetalRefs /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'propsnonmetal-warp.cs')
if ($LASTEXITCODE -ne 0) { throw 'PropsNonmetal original pixel fixture compilation failed' }
& $propsnonmetalOutput $propsnonmetalRoot
if ($LASTEXITCODE -ne 0) { throw 'PropsNonmetal original pixel WARP failed' }
