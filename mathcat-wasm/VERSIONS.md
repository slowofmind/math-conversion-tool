# MathCAT WebAssembly payload — version log

`mathcat-wasm.bin` is the gzipped MathCAT engine used for speech proofing
(plan: `PLAN-MATHCAT-SPEECH-PROOFING.md`). Since 2026-11-09 it is pinned to
**the MathCAT inside the MathCAT NVDA add-on**, as the NVDA Add-on Store serves
it, so the popup shows what NVDA users with the add-on hear (Nicholas,
2026-11-05 and 2026-11-09; `mathcat-proofing-v2/NOTE-MATHCAT-UPGRADE-0.7.7.md`). Until then it was pinned to the MathCAT
built into NVDA's stable release (plan F1).

The raw `.wasm` is not committed; `mathcat-wasm.bin` (the file the loader
fetches) is, as with `pandoc-wasm/`. `BUILD-INFO.json` records how the current
`.bin` was built and which gates it passed.

## Version history

| MathCAT | Matches NVDA | nvda-mathcat | raw bytes | raw sha1 | .bin bytes | Built |
|---|---|---|---|---|---|---|
| 0.7.2 | release-2026.2 (also 2026.1, 2026.1.1, 2026.3b2) | 808cbe3 | 3,269,282 | `d5ee03c601e9d3ae9d6494ed7467d4b70958b53f` | 1,910,118 | 2026-09-24 |
| 0.7.2 | release-2026.2 (same pin; wrapper adds navigation + braille functions, PLAN-MATHCAT-NAVIGATION N9) | 808cbe3 | 3,366,192 | `2c450eaa6adcc7b9a44f55ff2a2cfdbbee02025a` | 1,945,428 | 2026-09-25 |
| 0.7.7 | NVDA add-on 0.7.7 (Store package sha256 `1022780d…`); `mathcat.js` adds Verbosity = Verbose | — | 3,212,512 | `cd71ab27120dcdfac84b1830c106b88f88d3ce19` | 1,702,996 | 2026-11-09 |

## Checking whether the add-on has moved

The Add-on Store keeps one record per add-on version in
`github.com/nvaccess/addon-datastore`, folder `addons/MathCAT/`. A record newer
than the pin (e.g. `0.7.8.json`) means a new release; its `URL` and `sha256`
fields are what `build-container.sh` and `test/nvda_reference.py` pin.

```bash
git clone --filter=blob:none --no-checkout --depth 1 https://github.com/nvaccess/addon-datastore.git ds
git -C ds ls-tree -r --name-only HEAD | grep '^addons/MathCAT/' | sort -V | tail -3
git -C ds show HEAD:addons/MathCAT/X.Y.Z.json | grep -E '"(URL|sha256)"'
```

## Checking whether NVDA has moved (only if the pin returns to NVDA's built-in copy)

```bash
git clone --filter=blob:none --no-checkout https://github.com/nvaccess/nvda.git
git -C nvda fetch --depth 1 --filter=blob:none origin tag release-YYYY.N
git -C nvda ls-tree release-YYYY.N include/ | grep nvda-mathcat          # commit C
git clone --filter=blob:none https://github.com/nvaccess/nvda-mathcat.git
git -C nvda-mathcat show C:assets/libmathcat_py.pyd > nv.pyd
strings -n 5 nv.pyd | grep -o -m1 'mathcat-0\.[0-9.]*[a-z0-9.-]*\\'     # MathCAT version
```

## Updating to a new pin

1. In `build/Cargo.toml`, set `mathcat = { version = "=X.Y.Z", ... }`. (MathCAT
   0.7.2 also needed a `[build-dependencies] zip` fix; 0.7.7 does not.)
2. In `build/build-container.sh`, set `MATHCAT_VERSION`, `ADDON_VERSION`,
   `ADDON_URL` and `ADDON_SHA256` (from the Store record), then run it. It
   fails unless all three gates pass:
   - G1: rules equal the rules inside the Store's add-on package;
   - G2: `version()` equals the pin;
   - G3: the `.bin` round-trips to the raw wasm.
3. In `mathcat.js`, update `PINNED_MATHCAT` and `WASM_SHA1` (from
   `BUILD-INFO.json`), and `NVDA_SETUP` if the modelled setup changes.
   **`WASM_SHA1` is the cache-buster** in `mathcat-wasm.bin?sha1=…`: if it is
   not changed, browsers keep serving the previous payload.
4. In `test/nvda_reference.py`, set `ADDON_VERSION` and `ADDON_SHA256`.
   Re-diff the add-on's `convertSSMLTextForNVDA`, its call order
   (`getSpeechForMathMl`, `reportFocus`, `script_navigate`) and its two
   navigation messages, and NVDA's `source/speechViewer.py`, against
   `mathcat.js`, `gen-ssml.mjs` and `gen-nav-ssml.mjs`. Update them if they
   changed.
5. In `test/`, run `node gen-ssml.mjs`, then
   `python3 -X utf8 nvda_reference.py` and
   `python3 -X utf8 nvda_reference.py --ssml-cases`; then `node gen-nav-ssml.mjs`
   and `python3 -X utf8 nvda_nav_reference.py`; then `npm test`.
   Review the golden diffs before committing.
6. Add a row to the table above.
