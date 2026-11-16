# MathCAT 0.7.7, English only, no braille (for the MathCat TTS reader block)

- `mathcat-wasm.bin`: the engine, gzipped. Built into `inserts/mathcat-tts.html` by `build-insert-mjfonts.cjs`.
- `mathcat_wasm.js`: its loader (identical to the platform's full engine's).
- `BUILD-INFO.json`: provenance; `rulesSubset` says what was kept.
- `build-en.sh`: how it was built: the platform's own `mathcat-wasm/build/build-container.sh`, unchanged,
  run on a copy of the MathCAT crate with the other languages and braille codes removed.

Same MathCAT version as the platform's `mathcat-wasm/` (the MathCAT NVDA add-on 0.7.7). Kept files are
byte-identical to the crate, so English speech is the same as the full engine's. MathCAT refuses to start
without one braille code, so Nemeth stays; the reader never asks for braille. Rebuild this whenever the
platform's MathCAT pin changes, or the two read-aloud options will no longer match.
