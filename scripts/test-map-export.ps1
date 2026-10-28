<#
.SYNOPSIS
Export a small map sample, optionally serving it in the local map viewer.
.EXAMPLE
.\scripts\test-map-export.ps1 -TopLeft 16.11 -BottomRight 17.12 -IncludeLayer '/points-of-interest/locations','/points-of-interest/roads' -Preview
.EXAMPLE
.\scripts\test-map-export.ps1 -TopLeft 04.9 -BottomRight 16.11 -Plan
.EXAMPLE
.\scripts\test-map-export.ps1 -TopLeft 04.04.H.07 -Preview
.DESCRIPTION
Endpoints accept row.column[.letter[.number]]; missing letter/number mean A/01.
Append / followed by up to four digits 0-6 for finer seven-child hexes; use the same depth at both corners.
Legacy .01-.16 suffixes remain accepted for 6-mile crops.
Omitting BottomRight exports the single hex at TopLeft. Layer defaults come from the recipe.
Output is a file prefix: -Output maps/region writes maps/region.png and maps/region.map.json.
#>
[CmdletBinding()]
param(
    [string]$TopLeft = '16.11',
    [string]$BottomRight,
    [string]$Output,
    [string[]]$IncludeLayer = @(),
    [string[]]$ExcludeLayer = @(),
    [switch]$Plan,
    [switch]$Preview,
    [ValidateRange(1024, 65535)]
    [int]$Port = 8881
)

$ErrorActionPreference = 'Stop'
if ($Plan -and $Preview) { throw 'Use -Plan to inspect options or -Preview to export and view them.' }
$mapRepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mapPython = Join-Path $mapRepoRoot '.venv-map-lab/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $mapPython)) {
    throw 'Set up the Python 3.11 environment using docs/map-baseline-progress.md first.'
}
if (-not $BottomRight) { $BottomRight = $TopLeft }
$exportArgs = @(
    (Join-Path $mapRepoRoot 'scripts/map-export/export_core.py'),
    '--recipe', (Join-Path $mapRepoRoot 'scripts/map-export/taelgar-core.recipe.json'),
    '--top-left', $TopLeft, '--bottom-right', $BottomRight
)
foreach ($layer in $IncludeLayer) { $exportArgs += @('--include-layer', $layer) }
foreach ($layer in $ExcludeLayer) { $exportArgs += @('--exclude-layer', $layer) }
if ($Plan) {
    & $mapPython @exportArgs --plan
    if ($LASTEXITCODE -ne 0) { throw 'Export options were rejected; see the error above.' }
    return
}
if ($Preview) {
    $mapNode = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    # Check before doing an expensive export. Never stop an existing preview.
    $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $portProbe.Start() }
    catch { throw "Preview port $Port is busy. Choose another with -Port, or stop its existing server." }
    finally { $portProbe.Stop() }
}
$trialName = 'trial-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
$mapOutput = if ($Output) { [IO.Path]::GetFullPath($Output) } else { Join-Path $mapRepoRoot ('.cache/map-baseline/' + $trialName) }
$exportArgs += @('--source', (Join-Path $mapRepoRoot 'experiments/map-lab/aveil/source/taelgar-basemap.psb'), '--output', $mapOutput)
& $mapPython @exportArgs
if ($LASTEXITCODE -ne 0) { throw 'Map export failed; see the error above.' }
if ($Preview) {
    Write-Host "Open http://127.0.0.1:$Port/ after the server starts. Ctrl+C stops this preview."
    & $mapNode (Join-Path $mapRepoRoot 'scripts/preview-map-baseline.mjs') --export $mapOutput --port $Port --no-tiles
    if ($LASTEXITCODE -ne 0) { throw "Preview stopped with an error. The exported files still use the prefix $mapOutput" }
}
