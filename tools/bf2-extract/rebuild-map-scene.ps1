param([string]$Output = 'web/public/assets')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location -LiteralPath $workspace
try {
  $assemblyArgs = @('tools/bf2-extract/assemble-scene.mjs')
  foreach ($graph in @('root','spatial-extra','spatial-extra2','spatial-extra3','spatial-extra4','spatial-extra5')) {
    $assemblyArgs += @('--graph', ('exports/map-initial/' + $graph))
  }
  $assemblyArgs += @('--graph','tools/gameplay-recovery/map')
  foreach ($root in @('DeathStar02_01','TeamDeathmatch','TeamDeathmatch_Online')) {
    $assemblyArgs += @('--root',('Levels/MP/DeathStar02_01/' + $root))
  }
  $assemblyArgs += @('--group-transforms','exports/map-initial/group-transforms.json','--group-transforms','exports/map-initial/tdm-transforms.json','--out','exports/map-initial/plan')
  & node @assemblyArgs
  if ($LASTEXITCODE -ne 0) { throw 'Spatial assembly failed' }
  $finalArgs = @('tools/bf2-extract/finalize-scene.mjs','--plan','exports/map-initial/plan/scene.plan.json','--region','tools/gameplay-recovery/map-region-evidence.json')
  foreach ($meshSet in @('meshes','meshes-extra','meshes-completion','meshes-final')) {
    $finalArgs += @('--meshes',('exports/map-initial/' + $meshSet))
  }
  $finalArgs += @('--out',$Output)
  & node @finalArgs
  if ($LASTEXITCODE -ne 0) { throw 'Scene finalization failed' }
} finally { Pop-Location }
