/* pandoc.js: JavaScript interface to pandoc.wasm.
   Copyright (c) 2025 Tweag I/O Limited and John MacFarlane. MIT License.

   Interface:

   await convert(options, stdin, files)

   - options is a JavaScript object representing pandoc options: this should
     correspond to the format used in pandoc's default files.
   - stdin is a string or nil
   - files is a JavaScript object whose keys are filenames and whose values
     are the data in the corresponding file, as Blobs.

   The return value is a JavaScript object with 3 properties, stdout,
   stderr, and warnings, all strings. warnings is a JSON-encoded
   version of the warnings produced by pandoc. If the pandoc process
   produces an output file, it will be added to files.

   await query(options)

    - options is a JavaScript object with a 'query' property and in
      some cases a 'format' property. Possible queries include
      'version', 'highlight-styles', 'highlight-languages', 'input-formats',
      'output-formats', 'default-template' (requires 'format'),
      and 'extensions-for-format' (requires 'format').

   The return value is a JavaScript string or in some cases a list
   of strings.
*/

import {
  WASI,
  OpenFile,
  File,
  ConsoleStdout,
  PreopenDirectory,
} from "https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@0.3.0/dist/index.js";

// ════════════════════════════════════════════════════════════════════
// DEVICE-BEGIN — synthetic "xform" device (tier-1 WASI). A byte-in / byte-out
// virtual file backed by a SYNCHRONOUS JS transform set via setDeviceTransform().
// On a pandoc.wasm upgrade: drop in the upstream pandoc.js, then re-apply this
// block AND the one `fileSystem.set("xform", …)` line inside convert(). This is
// the only local patch; nothing else here depends on pandoc internals.
// ════════════════════════════════════════════════════════════════════
let deviceTransform = (b) => b;   // default: passthrough
export function setDeviceTransform(fn) { deviceTransform = fn; }

class DeviceFd extends OpenFile {
  constructor(inode) { super(inode); this._wrote = false; }
  fd_write(data) {
    const inode = this.file;
    // First write on THIS handle starts a fresh transaction (mode "w" = truncate).
    // GHC's wasi-libc does not set RIGHTS_FD_WRITE on write-opens, so detect the
    // write session by the first fd_write instead of by rights bits.
    if (!this._wrote) { this._wrote = true; inode.input = []; inode.result = null; }
    inode.input.push(new Uint8Array(data));
    return { ret: 0, nwritten: data.byteLength };
  }
  fd_read(size) {
    const inode = this.file;
    if (inode.result == null) {
      let total = 0; for (const c of inode.input) total += c.length;
      const all = new Uint8Array(total); let o = 0;
      for (const c of inode.input) { all.set(c, o); o += c.length; }
      inode.result = inode.transform(all);   // synchronous JS transform
    }
    const pos = Number(this.file_pos);
    const slice = inode.result.slice(pos, pos + size);
    this.file_pos += BigInt(slice.length);
    return { ret: 0, data: slice };
  }
}
class DeviceInode extends File {
  constructor(transform) { super(new Uint8Array(0)); this.transform = transform; this.input = []; this.result = null; }
  path_open(oflags, fs_rights_base, fd_flags) { return { ret: 0, fd_obj: new DeviceFd(this) }; }
}
// ════════════════════════════════════════════════════════════════════
// DEVICE-END
// ════════════════════════════════════════════════════════════════════

const args = ["pandoc.wasm", "+RTS", "-H64m", "-RTS"];
const env = [];
const in_file = new File(new Uint8Array(), { readonly: true });
const out_file = new File(new Uint8Array(), { readonly: false });
const err_file = new File(new Uint8Array(), { readonly: false });
const warnings_file = new File(new Uint8Array(), { readonly: false });
const fileSystem = new Map();
const fds = [
  new OpenFile(new File(new Uint8Array(), { readonly: true })),
  ConsoleStdout.lineBuffered((msg) => console.log(`[WASI stdout] ${msg}`)),
  ConsoleStdout.lineBuffered((msg) => console.warn(`[WASI stderr] ${msg}`)),
  new PreopenDirectory("/", fileSystem),
];
const options = { debug: false };
const wasi = new WASI(args, env, fds, options);
// ════════════════════════════════════════════════════════════════════
// WASM-LOADER-BEGIN — local patch (compressed wasm delivery).
// GitHub Pages serves pandoc.wasm (~56 MB) uncompressed, so we ship a
// gzipped copy as pandoc-wasm.bin (~15 MB) and decompress in the browser
// via DecompressionStream, preserving streaming compilation. The .bin
// extension (not .gz) is deliberate: it stops servers like Apache from
// adding Content-Encoding: gzip and double-decompressing.
// Falls back to the raw pandoc.wasm if anything goes wrong.
// On a pandoc.wasm upgrade: regenerate pandoc-wasm.bin from the new wasm
// (gzip it), update the sha1 cache-buster below, and re-apply this block
// in place of the upstream instantiateStreaming call.
// ════════════════════════════════════════════════════════════════════
const WASM_SHA1 = "81325b24686ba020293da498958982a8caa7a102";

async function instantiatePandocWasm(imports) {
  if (typeof DecompressionStream === "function") {
    try {
      const resp = await fetch(
        new URL(`./pandoc-wasm.bin?sha1=${WASM_SHA1}`, import.meta.url)
      );
      if (resp.ok && resp.body) {
        const wasmStream = resp.body.pipeThrough(
          new DecompressionStream("gzip")
        );
        const wasmResp = new Response(wasmStream, {
          headers: { "Content-Type": "application/wasm" },
        });
        return await WebAssembly.instantiateStreaming(wasmResp, imports);
      }
      console.warn(
        `[pandoc.js] pandoc-wasm.bin fetch returned ${resp.status}; falling back to raw pandoc.wasm`
      );
    } catch (err) {
      console.warn(
        "[pandoc.js] compressed wasm load failed; falling back to raw pandoc.wasm:",
        err
      );
    }
  }
  return await WebAssembly.instantiateStreaming(
    fetch(new URL(`./pandoc.wasm?sha1=${WASM_SHA1}`, import.meta.url)),
    imports
  );
}
// ════════════════════════════════════════════════════════════════════
// WASM-LOADER-END
// ════════════════════════════════════════════════════════════════════

const { instance } = await instantiatePandocWasm({
  wasi_snapshot_preview1: wasi.wasiImport,
});

wasi.initialize(instance);
instance.exports.__wasm_call_ctors();

function memory_data_view() {
  return new DataView(instance.exports.memory.buffer);
}

const argc_ptr = instance.exports.malloc(4);
memory_data_view().setUint32(argc_ptr, args.length, true);
const argv = instance.exports.malloc(4 * (args.length + 1));
for (let i = 0; i < args.length; ++i) {
  const arg = instance.exports.malloc(args[i].length + 1);
  new TextEncoder().encodeInto(
    args[i],
    new Uint8Array(instance.exports.memory.buffer, arg, args[i].length)
  );
  memory_data_view().setUint8(arg + args[i].length, 0);
  memory_data_view().setUint32(argv + 4 * i, arg, true);
}
memory_data_view().setUint32(argv + 4 * args.length, 0, true);
const argv_ptr = instance.exports.malloc(4);
memory_data_view().setUint32(argv_ptr, argv, true);

instance.exports.hs_init_with_rtsopts(argc_ptr, argv_ptr);

export async function query(options) {
  const opts_str = JSON.stringify(options);
  const opts_bytes = new TextEncoder().encode(opts_str);
  const opts_ptr = instance.exports.malloc(opts_bytes.length);
  new Uint8Array(instance.exports.memory.buffer, opts_ptr, opts_bytes.length)
    .set(opts_bytes);
  // add input files to fileSystem
  fileSystem.clear()
  const out_file = new File(new Uint8Array(), { readonly: false });
  const err_file = new File(new Uint8Array(), { readonly: false });
  fileSystem.set("stdout", out_file);
  fileSystem.set("stderr", err_file);
  instance.exports.query(opts_ptr, opts_bytes.length);

  const err_text = new TextDecoder("utf-8", { fatal: true }).decode(err_file.data);
  if (err_text) console.log(err_text);
  const out_text = new TextDecoder("utf-8", { fatal: true }).decode(out_file.data);
  return JSON.parse(out_text);
}


export async function convert(options, stdin, files) {
  const opts_str = JSON.stringify(options);
  const opts_bytes = new TextEncoder().encode(opts_str);
  const opts_ptr = instance.exports.malloc(opts_bytes.length);
  new Uint8Array(instance.exports.memory.buffer, opts_ptr, opts_bytes.length)
    .set(opts_bytes);
  // add input files to fileSystem
  fileSystem.clear()
  const in_file = new File(new Uint8Array(), { readonly: true });
  const out_file = new File(new Uint8Array(), { readonly: false });
  const err_file = new File(new Uint8Array(), { readonly: false });
  const warnings_file = new File(new Uint8Array(), { readonly: false });
  fileSystem.set("stdin", in_file);
  fileSystem.set("stdout", out_file);
  fileSystem.set("stderr", err_file);
  fileSystem.set("warnings", warnings_file);
  fileSystem.set("xform", new DeviceInode(deviceTransform));   // DEVICE: mount synthetic device
  for (const file in files) {
    await addFile(file, files[file], true);
  }
  // add output file if any
  if (options["output-file"]) {
    await addFile(options["output-file"], new Blob(), false);
  }
  // add media file for extracted media
  if (options["extract-media"]) {
    await addFile(options["extract-media"], new Blob(), false);
  }
  if (stdin) {
    in_file.data = new TextEncoder().encode(stdin);
  }
  instance.exports.convert(opts_ptr, opts_bytes.length);

  if (options["output-file"]) {
    files[options["output-file"]] =
       new Blob([fileSystem.get(options["output-file"]).data]);
  }
  if (options["extract-media"]) {
    const mediaFile = fileSystem.get(options["extract-media"]);
    if (mediaFile && mediaFile.data && mediaFile.data.length > 0) {
      files[options["extract-media"]] =
         new Blob([mediaFile.data], { type: 'application/zip' });
    }
  }
  const rawWarnings = new TextDecoder("utf-8", { fatal: true })
                          .decode(warnings_file.data);
  let warnings = [];
  if (rawWarnings) {
    warnings = JSON.parse(rawWarnings);
  }
  return {
    stdout: new TextDecoder("utf-8", { fatal: true }).decode(out_file.data),
    stderr: new TextDecoder("utf-8", { fatal: true }).decode(err_file.data),
    warnings: warnings
  };
}

async function addFile(filename, blob, readonly) {
  const buffer = await blob.arrayBuffer();
  const file = new File(new Uint8Array(buffer), { readonly: readonly });
  fileSystem.set(filename, file);
}
