param(
    [string]$Game,
    [string]$OutputRoot,
    [int]$Depth = 6,
    [int]$MaxAssets = 12000,
    [switch]$ConvertAssets,
    [switch]$Raw,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
if ($Help) {
    Write-Output 'run-map-extraction.ps1 -Game INSTALL_ROOT [-OutputRoot DIRECTORY] [-Depth 6] [-MaxAssets 12000] [-ConvertAssets] [-Raw]'
    Write-Output 'Run only after installation is stable. Inventory and typed EBX graph come first; optional conversion writes rigid-mesh GLB and DDS/PNG textures. No scene/material assembly is implied.'
    exit 0
}
if ([string]::IsNullOrWhiteSpace($Game)) { throw 'Missing -Game INSTALL_ROOT (no interactive prompting).' }
if ($Depth -lt 0 -or $MaxAssets -lt 1) { throw 'Depth and MaxAssets are invalid.' }
$Game = [IO.Path]::GetFullPath($Game)
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = Join-Path $PSScriptRoot ('exports\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')) }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
foreach ($protectedRoot in @($Game, (Join-Path $PSScriptRoot '..\frosty-1.0.5.2'))) {
    $protectedRoot = [IO.Path]::GetFullPath($protectedRoot).TrimEnd('\')
    if ($OutputRoot.Equals($protectedRoot, [StringComparison]::OrdinalIgnoreCase) -or $OutputRoot.StartsWith($protectedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'OutputRoot must be outside the game and vendor directories.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Game 'Data') -PathType Container)) { throw 'Game root does not contain Data.' }
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$extractor = Join-Path $PSScriptRoot 'bf2-extract.exe'
$steps = [Collections.Generic.List[object]]::new()
function Invoke-ExtractorStep([string]$Step, [string[]]$Arguments) {
    $log = Join-Path $OutputRoot ($Step + '.log')
    & $extractor @Arguments *> $log
    $code = $LASTEXITCODE
    $steps.Add([ordered]@{step=$Step;exitCode=$code;log=$log})
    Write-Host "$Step finished with exit code $code. Log: $log"
    if ($code -eq 1) { throw "Extractor failed in $Step. See $log" }
}
$inventory = Join-Path $OutputRoot 'inventory'
$graph = Join-Path $OutputRoot 'graph'
Invoke-ExtractorStep 'inventory' @('inventory','--game',$Game,'--out',$inventory,'--contains','DeathStar02_01')
$exportArguments = @('export','--game',$Game,'--out',$graph,'--contains','DeathStar02_01','--depth',"$Depth",'--max-assets',"$MaxAssets")
if ($Raw) { $exportArguments += '--raw' }
Invoke-ExtractorStep 'graph' $exportArguments
$manifest = Get-Content -Raw -LiteralPath (Join-Path $graph 'export.manifest.json') | ConvertFrom-Json
$rigid = @($manifest.results | Where-Object type -EQ 'RigidMeshAsset' | Select-Object -ExpandProperty name -Unique)
$textures = @($manifest.results | Where-Object { $_.type -like '*TextureAsset' } | Select-Object -ExpandProperty name -Unique)
$rigidList = Join-Path $OutputRoot 'rigid-mesh-names.txt'
$textureList = Join-Path $OutputRoot 'texture-names.txt'
[IO.File]::WriteAllLines($rigidList, [string[]]$rigid, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllLines($textureList, [string[]]$textures, [Text.UTF8Encoding]::new($false))
if ($ConvertAssets) {
    if ($rigid.Count) { Invoke-ExtractorStep 'mesh' @('mesh','--game',$Game,'--out',(Join-Path $OutputRoot 'meshes'),'--names',$rigidList) }
    if ($textures.Count) { Invoke-ExtractorStep 'texture' @('texture','--game',$Game,'--out',(Join-Path $OutputRoot 'textures'),'--names',$textureList,'--png') }
}
$report = [ordered]@{
    createdUtc=[DateTime]::UtcNow.ToString('o');gameRoot=$Game;outputRoot=$OutputRoot
    steps=$steps;graphComplete=$manifest.complete;dependencyClosureComplete=$manifest.dependencyClosureComplete
    rigidMeshes=$rigid.Count;textures=$textures.Count
    browserSceneGenerated=$false;materialsBound=$false
    pending=@('Scene transform assembly','Material and object-variation binding','Collision','Skinned/composite binding','Game-runtime comparison')
}
$report | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $OutputRoot 'pipeline-report.json')
if (@($steps | Where-Object exitCode -NE 0).Count) { exit 3 }
