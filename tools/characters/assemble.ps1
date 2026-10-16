$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$raw = Join-Path $workspace 'exports\characters\converted'
$output = Join-Path $workspace 'web\public\assets\characters'
$components = @{
    'stormtrooper'='stormtrooper-body'; 'stormtrooper-helmet'='stormtrooper-helmet'
    'rebel'='rebel-body'; 'rebel-head'='rebel-head'; 'rebel-helmet'='rebel-helmet'; 'rebel-hands'='rebel-hands'
    'e11'='e11'
}
foreach ($entry in $components.GetEnumerator()) {
    & node (Join-Path $PSScriptRoot 'bind-skin.mjs') (Join-Path $raw "$($entry.Key).glb") (Join-Path $raw "$($entry.Key).skin.json") (Join-Path $output "$($entry.Value).glb")
    if ($LASTEXITCODE -ne 0) {throw 'Skin binding failed'}
}
# Material conversion should run on these component GLBs before the final merge.
& node (Join-Path $PSScriptRoot 'merge-character.mjs') (Join-Path $output 'stormtrooper.glb') (Join-Path $output 'stormtrooper-body.glb') (Join-Path $output 'stormtrooper-helmet.glb')
& node (Join-Path $PSScriptRoot 'merge-character.mjs') (Join-Path $output 'rebel.glb') (Join-Path $output 'rebel-body.glb') (Join-Path $output 'rebel-head.glb') (Join-Path $output 'rebel-helmet.glb') (Join-Path $output 'rebel-hands.glb')
