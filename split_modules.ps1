$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$indexPath = Join-Path $project 'index.html'
$html = [IO.File]::ReadAllText($indexPath, [Text.Encoding]::UTF8)
$scriptOpen = $html.LastIndexOf('<script>')
$scriptClose = $html.LastIndexOf('</script>')
if ($scriptOpen -lt 0 -or $scriptClose -le $scriptOpen) { throw 'Inline game script not found.' }

$source = $html.Substring($scriptOpen + 8, $scriptClose - ($scriptOpen + 8))
$markers = [ordered]@{
  'config.js' = 'const CONFIG = {'
  'save.js' = 'const SaveSystem = {'
  'ui.js' = 'const RewardSystem = {'
  'card.js' = 'const CardSystem = {'
  'farm.js' = 'const Farm = {'
  'expedition.js' = 'class Expedition {'
  'game.js' = 'const Game = {'
}

$positions = @{}
foreach ($entry in $markers.GetEnumerator()) {
  $positions[$entry.Key] = $source.IndexOf($entry.Value)
  if ($positions[$entry.Key] -lt 0) { throw "Marker missing: $($entry.Value)" }
}

$scriptsDir = Join-Path $project 'js'
New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null
$names = @($markers.Keys)
for ($i = 0; $i -lt $names.Count; $i++) {
  $name = $names[$i]
  $start = $positions[$name]
  $end = if ($i -lt $names.Count - 1) { $positions[$names[$i + 1]] } else { $source.Length }
  [IO.File]::WriteAllText((Join-Path $scriptsDir $name), $source.Substring($start, $end - $start).Trim() + "`r`n", [Text.UTF8Encoding]::new($false))
}

$tags = @(
  '  <script src="js/config.js"></script>',
  '  <script src="js/save.js"></script>',
  '  <script src="js/ui.js"></script>',
  '  <script src="js/card.js"></script>',
  '  <script src="js/farm.js"></script>',
  '  <script src="js/expedition.js"></script>',
  '  <script src="js/game.js"></script>'
) -join "`r`n"
$updated = $html.Substring(0, $scriptOpen) + $tags + "`r`n" + $html.Substring($scriptClose + 9)
[IO.File]::WriteAllText($indexPath, $updated, [Text.UTF8Encoding]::new($false))
