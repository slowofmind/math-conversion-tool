# MathCAT WebAssembly payload — version log

`mathcat-wasm.bin` is the gzipped MathCAT engine used for speech proofing
(plan: `PLAN-MATHCAT-SPEECH-PROOFING.md`). It is pinned to **the MathCAT inside
NVDA's current stable release**, not the newest MathCAT, so the popup shows
what NVDA users hear (plan F1, version-pin decision).

The raw `.wasm` is not committed; `mathcat-wasm.bin` (the file the loader
fetches) is, as with `pandoc-wasm/`. `BUILD-INFO.json` records how the current
`.bin` was built and which gates it passed.

## Version history

| MathCAT | Matches NVDA | nvda-mathcat | raw bytes | raw sha1 | .bin bytes | Built |
|---|---|---|---|---|---|---|
| 0.7.2 | release-2026.2 (also 2026.1, 2026.1.1, 2026.3b2) | 808cbe3 | 3,269,282 | `d5ee03c601e9d3ae9d6494ed7467d4b70958b53f` | 1,910,118 | 2026-09-24 |
| 0.7.2 | release-2026.2 (same pin; wrapper adds navigation + braille functions, PLAN-MATHCAT-NAVIGATION N9) | 808cbe3 | 3,366,192 | `2c450eaa6adcc7b9a44f55ff2a2cfdbbee02025a` | 1,945,428 | 2026-09-25 |

## Checking whether NVDA has moved (every NVDA stable release)

```bash
git clone --filter=blob:none --no-checkout https://github.com/nvaccess/nvda.git
git -C nvda fetch --depth 1 --filter=blob:none origin tag release-YYYY.N
git -C nvda ls-tree release-YYYY.N include/ | grep nvda-mathcat          # commit C
git clone --filter=blob:none https://github.com/nvaccess/nvda-mathcat.git
git -C nvda-mathcat show C:assets/libmathcat_py.pyd > nv.pyd
strings -n 5 nv.pyd | grep -o -m1 'mathcat-0\.[0-9.]*[a-z0-9.-]*\\'     # MathCAT version
```

## Updating to a new pin

1. In `build/Cargo.toml`, set `mathcat = { version = "=X.Y.Z", ... }`, and set
   the `[build-dependencies] zip` major version to the one MathCAT X.Y.Z uses
   (5.x for 0.7.2, 6.x for 0.7.5; see the comment there).
2. In `build/build-container.sh`, set `MATHCAT_VERSION`, `NVDA_RELEASE` and
   `NVDA_MATHCAT_COMMIT`, then run it. It fails unless all three gates pass:
   - G1: rules equal NVDA's bundle;
   - G2: `version()` equals the pin;
   - G3: the `.bin` round-trips to the raw wasm.
3. In `mathcat.js`, update `PINNED_MATHCAT`, `NVDA_RELEASE` and `WASM_SHA1`
   (from `BUILD-INFO.json`). **`WASM_SHA1` is the cache-buster** in
   `mathcat-wasm.bin?sha1=…`: if it is not changed, browsers keep serving the
   previous payload.
4. Re-diff NVDA's `source/mathPres/MathCAT/speech.py`
   (`convertSSMLTextForNVDA`) and `source/speechViewer.py` against the port in
   `mathcat.js`. Update the port if they changed.
5. In `test/`, run `node gen-ssml.mjs`, then
   `python3 -X utf8 nvda_reference.py` and
   `python3 -X utf8 nvda_reference.py --ssml-cases`, then `npm test`.
   Review the golden diffs before committing.
6. Add a row to the table above.
