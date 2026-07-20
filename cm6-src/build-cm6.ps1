# build-cm6.ps1 - builds ../codemirror/cm6-editor.js from facade.js.
# Run this ONLY when facade.js or CM6 package versions change; day-to-day
# index.html work never needs it. Requires Node.js LTS.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
  Write-Host "node_modules missing - running npm install first..."
  npm install
  if ($LASTEXITCODE -ne 0) { Write-Host "npm install FAILED"; exit 1 }
}

npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Bundle build FAILED"; exit 1 }

$out = Join-Path (Split-Path $PSScriptRoot) "codemirror\cm6-editor.js"
"Built: {0}  ({1:N0} KB)" -f $out, ((Get-Item $out).Length / 1KB)
