# compress-wasm.ps1 — gzip pandoc.wasm into pandoc-wasm.bin, then verify
# the round-trip decompresses to a byte-identical copy (SHA-256 compare).
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$src = Join-Path $dir "pandoc.wasm"
$dst = Join-Path $dir "pandoc-wasm.bin"

# --- Compress ---
$in  = [IO.File]::OpenRead($src)
$out = [IO.File]::Create($dst)
$gz  = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)
$in.CopyTo($gz)
$gz.Dispose(); $out.Dispose(); $in.Dispose()

# --- Verify round-trip ---
$tmp = Join-Path $env:TEMP "pandoc-wasm-roundtrip.tmp"
$cin  = [IO.File]::OpenRead($dst)
$gunz = New-Object IO.Compression.GZipStream($cin, [IO.Compression.CompressionMode]::Decompress)
$cout = [IO.File]::Create($tmp)
$gunz.CopyTo($cout)
$cout.Dispose(); $gunz.Dispose(); $cin.Dispose()

$h1 = (Get-FileHash $src -Algorithm SHA256).Hash
$h2 = (Get-FileHash $tmp -Algorithm SHA256).Hash
Remove-Item $tmp

"Original:   {0:N2} MB" -f ((Get-Item $src).Length / 1MB)
"Compressed: {0:N2} MB" -f ((Get-Item $dst).Length / 1MB)
if ($h1 -eq $h2) { "Round-trip: VERIFIED byte-identical (SHA-256 match)" }
else { "Round-trip: MISMATCH - DO NOT USE"; exit 1 }
