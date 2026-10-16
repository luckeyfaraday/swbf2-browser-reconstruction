param([string]$FrostyRoot = (Join-Path $PSScriptRoot '..\frosty-1.0.5.2'))
$ErrorActionPreference = 'Stop'
$resolver = [System.ResolveEventHandler] {
    param($sender, $eventArgs)
    $short = ($eventArgs.Name -split ',')[0]
    foreach ($folder in @($FrostyRoot, (Join-Path $FrostyRoot 'ThirdParty'), (Join-Path $FrostyRoot 'Profiles'))) {
        $candidate = Join-Path $folder ($short + '.dll')
        if (Test-Path -LiteralPath $candidate) { return [Reflection.Assembly]::LoadFrom($candidate) }
    }
    return $null
}
[AppDomain]::CurrentDomain.add_AssemblyResolve($resolver)
$assemblies = @([Reflection.Assembly]::LoadFrom((Join-Path $FrostyRoot 'FrostySdk.dll')), [Reflection.Assembly]::LoadFrom((Join-Path $FrostyRoot 'FrostyEditor.exe')))
$records = foreach ($asm in $assemblies) {
    $types = @()
    try { $types = $asm.GetTypes() } catch [Reflection.ReflectionTypeLoadException] { $types = $_.Exception.Types | Where-Object { $_ } }
    foreach ($t in $types) {
        if ($t.FullName -match '(^FrostySdk\.(ProfilesLibrary|TypeLibrary|FileSystem)$|Managers\.(AssetManager|ResourceManager|EbxAssetEntry|ResAssetEntry|ChunkAssetEntry|BundleEntry)$|\.App$|\.FBXExporter$|\.TextureExporter$|\.MeshSet$|\.Texture$|\.EbxAsset$|\.PointerRef$|\.EbxImportReference$|\.AssetClassGuid$|\.ILogger$)') {
            [pscustomobject]@{assembly=$asm.GetName().Name;type=$t.FullName;constructors=@($t.GetConstructors() | ForEach-Object {$_.ToString()});members=@($t.GetMembers([Reflection.BindingFlags]'Public,Instance,Static,DeclaredOnly') | ForEach-Object {$_.ToString()})}
        }
    }
}
$records | ConvertTo-Json -Depth 5
