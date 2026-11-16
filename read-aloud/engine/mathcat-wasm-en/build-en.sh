#!/usr/bin/env bash
# build-en.sh: English-only MathCAT engine for the MathCat TTS reader block (MathCAT 0.7.7).
# Run from the platform repo's top folder (math-conversion-tool/) in the same kind of container as
# mathcat-wasm/build/build-container.sh (Ubuntu 24.04, apt + crates.io + GitHub).
# It copies mathcat-wasm/build to a work folder, makes a copy of the MathCAT crate with every Rules
# folder except Languages/en and Braille/Nemeth removed (MathCAT will not start without one braille
# code), points the build at that copy with [patch.crates-io], and runs the unchanged
# build-container.sh, whose gates still check the full crate's rules against the add-on package.
# Kept files are byte-identical to the crate, so English speech is the same as the full engine's.
set -euo pipefail
SRC="$(pwd)/mathcat-wasm/build"
DEST="${DEST:-/tmp/mathcat-wasm-en}"           # outputs land here (bin, loader, BUILD-INFO.json)
V="$(sed -n 's/^mathcat = { version = "=\([0-9.]*\)".*/\1/p' "$SRC/Cargo.toml")"
[ -n "$V" ] || { echo "could not read the MathCAT pin from Cargo.toml"; exit 1; }
rm -rf "$DEST"; mkdir -p "$DEST/build"
cp -r "$SRC"/. "$DEST/build/"
command -v cargo-1.91 >/dev/null || { echo "run build-container.sh once first, or install cargo-1.91"; exit 1; }
( cd "$DEST/build" && RUSTC=rustc-1.91 cargo-1.91 fetch -q )
CRATE="$(ls -d "$HOME"/.cargo/registry/src/*/mathcat-"$V" | head -1)"
cp -r "$CRATE" "$DEST/mathcat-$V-en"
( cd "$DEST/mathcat-$V-en/Rules"
  find Languages -mindepth 1 -maxdepth 1 -type d ! -name en -exec rm -rf {} +
  find Braille -mindepth 1 -maxdepth 1 -type d ! -name Nemeth -exec rm -rf {} + )
for p in Languages/en Intent Braille/Nemeth; do diff -r -q "$CRATE/Rules/$p" "$DEST/mathcat-$V-en/Rules/$p"; done
printf '\n[patch.crates-io]\nmathcat = { path = "../mathcat-%s-en" }\n' "$V" >> "$DEST/build/Cargo.toml"
( cd "$DEST/build" && bash build-container.sh )
python3 - "$DEST/BUILD-INFO.json" <<'PY'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
d["rulesSubset"] = "Languages/en, Intent, top-level rule files, Braille/definitions.yaml, Braille/Nemeth (MathCAT needs one braille code); everything else removed"
d["purpose"] = "MathCat TTS reader block (read-aloud/), English only, no braille output"
json.dump(d, open(p, "w"), indent=2); open(p, "a").write("\n")
PY
echo "English-only MathCAT $V in $DEST: mathcat-wasm.bin, mathcat_wasm.js, BUILD-INFO.json"
