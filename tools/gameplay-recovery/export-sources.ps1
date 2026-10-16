# Exports the decoded EBX that the gameplay-recovery scripts read, from your own
# installation (read-only). Each folder below is replayed with the exact selection
# that produced it (seed lists are in this folder). Outputs are gitignored.
# Usage: ./tools/gameplay-recovery/export-sources.ps1 [-Game INSTALL_ROOT]
param([string]$Game = $(if ($env:BF2_GAME_DIR) { $env:BF2_GAME_DIR } else { 'C:\Games\Star Wars - Battlefront 2' }))
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$extract = Join-Path $here '..\bf2-extract\bf2-extract.exe'
if (-not (Test-Path -LiteralPath $extract)) { throw 'Build tools/bf2-extract first (tools/bf2-extract/build.ps1).' }
$runs = @(
  @('export', 'core', '--names', 'core-seeds.txt', '--depth', '0', '--max-assets', '10'),
  @('export', 'detail', '--names', 'detail-seeds.txt', '--depth', '0', '--max-assets', '20'),
  @('export', 'e11-root', '--name', 'Gameplay/Equipment/Rifles/E11/W_BlasterRifle_E11', '--depth', '0', '--max-assets', '1'),
  @('export', 'heat-logic', '--name', 'Gameplay/Prefabs/Shared/Common/PF_Weapon_HeatLogic', '--depth', '0', '--max-assets', '1'),
  @('export', 'heat-state', '--names', 'heat-state-seeds.txt', '--depth', '0', '--max-assets', '2'),
  @('export', 'map', '--names', 'map-seeds.txt', '--depth', '0', '--max-assets', '10'),
  @('export', 'roll-ability', '--name', 'Gameplay/Kits/MP/Assault/Ability_Assault_CombatRoll_CharacterState', '--depth', '0', '--max-assets', '1'),
  @('export', 'state', '--names', 'final-seeds.txt', '--depth', '0', '--max-assets', '10'),
  @('inventory', 'inventory-e11', '--contains', 'E11'),
  @('inventory', 'inventory-gameplay', '--contains', 'Gameplay/', '--ebx-only')
)
foreach ($run in $runs) {
  $command, $folder, $rest = $run[0], $run[1], $run[2..($run.Length - 1)]
  $arguments = @($command, '--game', $Game, '--out', (Join-Path $here $folder))
  for ($i = 0; $i -lt $rest.Count; $i++) {
    $value = $rest[$i]
    # Seed lists are relative to this folder.
    if ($i -gt 0 -and $rest[$i - 1] -eq '--names') { $value = Join-Path $here $value }
    $arguments += $value
  }
  Write-Output ("bf2-extract " + ($arguments -join ' '))
  & $extract @arguments
  if ($LASTEXITCODE -ne 0) { throw "bf2-extract $command $folder failed" }
}
