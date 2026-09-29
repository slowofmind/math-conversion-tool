#!/usr/bin/env bash
# build-container.sh — builds mathcat-wasm/ from pinned sources.
# Plan: PLAN-MATHCAT-SPEECH-PROOFING.md, section 2.2 and Appendix A (M10).
#
# Written for the Claude.ai container (Ubuntu 24.04, apt + crates.io + GitHub
# reachable). Ubuntu's Rust ships no wasm32 standard library, so this script
# rebuilds std from source (-Zbuild-std). A CI run with the official rustup
# toolchain can skip steps 1-2 and drop the three RUSTC_BOOTSTRAP-related
# variables; everything else is identical.
#
# Outputs, written next to this folder (mathcat-wasm/):
#   mathcat_wasm.js     generated wasm-bindgen loader (web target)
#   mathcat-wasm.bin    gzipped wasm (the only wasm file that is committed)
#   BUILD-INFO.json     provenance + gate results
#
# Gates (the script exits non-zero if any fails):
#   G1 rules  — crate rules == NVDA's bundled rules at NVDA_MATHCAT_COMMIT
#   G2 version — the built wasm reports MATHCAT_VERSION
#   G3 bin    — gunzip(mathcat-wasm.bin) is byte-identical to the raw wasm
set -euo pipefail

MATHCAT_VERSION="0.7.2"                  # plan F1
NVDA_RELEASE="release-2026.2"            # plan F1
NVDA_MATHCAT_COMMIT="808cbe3e7dc407dba927e38e171c85a1348f2c8e"
WASM_BINDGEN_VERSION="0.2.128"           # must equal Cargo.toml's pin
RUST_V="1.91"
LLD_V="20"

HERE="$(cd "$(dirname "$0")" && pwd)"    # .../mathcat-wasm/build
OUT="$(cd "$HERE/.." && pwd)"            # .../mathcat-wasm
WORK="${WORK:-/tmp/mathcat-wasm-work}"
mkdir -p "$WORK"
log() { printf '\n== %s\n' "$*"; }

# ---- 1. toolchain ---------------------------------------------------------
log "1. toolchain"
if ! command -v "rustc-$RUST_V" >/dev/null || ! command -v "wasm-ld-$LLD_V" >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q >/dev/null
  apt-get install -y -q "rustc-$RUST_V" "cargo-$RUST_V" "rust-$RUST_V-src" "lld-$LLD_V" >/dev/null
fi
"rustc-$RUST_V" --version

# ---- 2. patched standard-library source ----------------------------------
# Debian strips std's wasm-only dependency on dlmalloc; restore the upstream
# line in a private copy (the system copy is never modified).
log "2. std source for wasm32"
SYSROOT="$("rustc-$RUST_V" --print sysroot)"
LIBSRC="$WORK/rustsrc/library"
if [ ! -f "$LIBSRC/.patched" ]; then
  rm -rf "$WORK/rustsrc"; mkdir -p "$WORK/rustsrc"
  cp -r "$SYSROOT/lib/rustlib/src/rust/library" "$WORK/rustsrc/"
  python3 - "$LIBSRC/std/Cargo.toml" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
anchor = "[dev-dependencies]"
assert s.count(anchor) == 1, "anchor not unique"
if "dlmalloc" not in s:
    add = ("[target.'cfg(any(all(target_family = \"wasm\", target_os = \"unknown\"), "
           "target_os = \"xous\", all(target_vendor = \"fortanix\", target_env = \"sgx\")))'.dependencies]\n"
           "dlmalloc = { version = \"0.2.10\", features = ['rustc-dep-of-std'] }\n\n")
    s = s.replace(anchor, add + anchor)
    open(p, "w").write(s)
PY
  touch "$LIBSRC/.patched"
fi

# ---- 3. wasm-bindgen CLI --------------------------------------------------
log "3. wasm-bindgen $WASM_BINDGEN_VERSION"
WB_DIR="$WORK/wasm-bindgen-$WASM_BINDGEN_VERSION-x86_64-unknown-linux-musl"
if [ ! -x "$WB_DIR/wasm-bindgen" ]; then
  curl -sSL -o "$WORK/wb.tgz" \
    "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$WASM_BINDGEN_VERSION/wasm-bindgen-$WASM_BINDGEN_VERSION-x86_64-unknown-linux-musl.tar.gz"
  tar -xzf "$WORK/wb.tgz" -C "$WORK"
fi
"$WB_DIR/wasm-bindgen" --version

# ---- 4. cargo build -------------------------------------------------------
log "4. cargo build (wasm32-unknown-unknown, build-std)"
export RUSTC="rustc-$RUST_V"
export RUSTC_BOOTSTRAP=1
export __CARGO_TESTS_ONLY_SRC_ROOT="$LIBSRC"
export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_LINKER="wasm-ld-$LLD_V"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$WORK/target}"   # override to reuse a warm cache
( cd "$HERE" && "cargo-$RUST_V" build --release --target wasm32-unknown-unknown \
    -Zbuild-std=std,panic_abort 2>&1 | tail -3 )
RAW="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/mathcat_wasm.wasm"
test -f "$RAW"

# ---- 5. bindings ----------------------------------------------------------
log "5. wasm-bindgen --target web"
rm -rf "$WORK/pkg"
"$WB_DIR/wasm-bindgen" --target web --no-typescript --out-dir "$WORK/pkg" "$RAW"
cp "$WORK/pkg/mathcat_wasm.js" "$OUT/mathcat_wasm.js"
BG="$WORK/pkg/mathcat_wasm_bg.wasm"      # the wasm the loader expects

# ---- 6. gzip + G3 ---------------------------------------------------------
log "6. mathcat-wasm.bin (gzip -9 -n) + G3"
gzip -9 -n -c "$BG" > "$OUT/mathcat-wasm.bin"
SHA256_RAW="$(sha256sum "$BG" | cut -d' ' -f1)"
SHA256_RT="$(gunzip -c "$OUT/mathcat-wasm.bin" | sha256sum | cut -d' ' -f1)"
[ "$SHA256_RAW" = "$SHA256_RT" ] || { echo "G3 FAIL: bin round-trip"; exit 1; }
SHA1_RAW="$(sha1sum "$BG" | cut -d' ' -f1)"
echo "G3 ok  sha1(raw)=$SHA1_RAW"

# ---- 7. G1 rules gate -----------------------------------------------------
log "7. G1 rules gate vs nvda-mathcat@${NVDA_MATHCAT_COMMIT:0:7}"
CRATE_DIR="$(ls -d "$HOME"/.cargo/registry/src/*/mathcat-"$MATHCAT_VERSION" | head -1)"
NVMC="$WORK/nvda-mathcat"
if [ ! -d "$NVMC/.git" ]; then
  git clone -q --filter=blob:none https://github.com/nvaccess/nvda-mathcat.git "$NVMC"
fi
rm -rf "$WORK/nvrules"; mkdir -p "$WORK/nvrules"
git -C "$NVMC" archive "$NVDA_MATHCAT_COMMIT" assets/Rules | tar -x -C "$WORK/nvrules"
G1=pass
for sub in Languages/en Intent; do
  if ! diff -r -q --strip-trailing-cr "$CRATE_DIR/Rules/$sub" "$WORK/nvrules/assets/Rules/$sub"; then G1=fail; fi
done
for f in definitions.yaml intent.yaml prefs.yaml; do
  if ! diff -q --strip-trailing-cr "$CRATE_DIR/Rules/$f" "$WORK/nvrules/assets/Rules/$f"; then G1=fail; fi
done
[ "$G1" = pass ] || { echo "G1 FAIL: rules differ from NVDA's bundle"; exit 1; }
echo "G1 ok"

# ---- 8. G2 version gate ---------------------------------------------------
log "8. G2 version gate"
REPORTED="$(node --input-type=module -e "
import init, * as mc from '$OUT/mathcat_wasm.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
await init({ module_or_path: gunzipSync(readFileSync('$OUT/mathcat-wasm.bin')) });
mc.init(); process.stdout.write(mc.version());")"
[ "$REPORTED" = "$MATHCAT_VERSION" ] || { echo "G2 FAIL: version() = $REPORTED"; exit 1; }
echo "G2 ok  version()=$REPORTED"

# ---- 9. BUILD-INFO.json ---------------------------------------------------
log "9. BUILD-INFO.json"
CRATE_SUM="$(python3 - "$HERE/Cargo.lock" <<'PY'
import sys, re
lock = open(sys.argv[1]).read()
m = re.search(r'name = "mathcat"\nversion = "([^"]+)"\nsource = "[^"]+"\nchecksum = "([0-9a-f]+)"', lock)
print(m.group(2) if m else "unknown")
PY
)"
python3 - "$OUT/BUILD-INFO.json" <<PY
import json, sys, datetime
info = {
  "schema": "mathcat-wasm/build-info/1",
  "mathcatVersion": "$MATHCAT_VERSION",
  "mathcatCrateChecksum": "$CRATE_SUM",
  "matchesNVDA": "$NVDA_RELEASE",
  "nvdaMathcatCommit": "$NVDA_MATHCAT_COMMIT",
  "gates": {"G1_rules": "pass", "G2_version": "pass", "G3_bin_roundtrip": "pass"},
  "wasm": {"sha1": "$SHA1_RAW", "sha256": "$SHA256_RAW",
           "bytes": $(stat -c %s "$BG"), "binBytes": $(stat -c %s "$OUT/mathcat-wasm.bin")},
  "toolchain": {"rustc": "$("rustc-$RUST_V" --version)", "wasmBindgen": "$WASM_BINDGEN_VERSION",
                "linker": "wasm-ld-$LLD_V", "buildStd": True},
  "builtAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
json.dump(info, open(sys.argv[1], "w"), indent=2); open(sys.argv[1], "a").write("\n")
PY
cat "$OUT/BUILD-INFO.json"
log "done"
