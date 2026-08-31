// cleanup/smart-cleanup.js
//
// Extracted from index.html 20260824-135655. Dependencies are injected by
// initSmartCleanup(ctx) rather than reached for as globals, so this module can be
// imported and tested on its own — see cm6-src/test-*.mjs.
//
// Everything below is the original code, moved verbatim.

export function initSmartCleanup(ctx) {
  const editor = ctx.editor;
  const updateStatus = (...a) => ctx.updateStatus(...a);
  const updateLog = (...a) => ctx.updateLog(...a);
  const activateOutputTab = (...a) => ctx.activateOutputTab(...a);

  // ════════════════════════════════════════════════════════════════════
  // SECTION 8b: SMART CLEANUP — ordered-list numbering
  // ════════════════════════════════════════════════════════════════════
  //   Source-level preprocessing that runs BEFORE Pandoc. Rewrites the
  //   optional argument of every enumerate in the document body so that
  //   Pandoc reproduces the numbering pdflatex would have shown, and
  //   translates the two enumitem keys Pandoc cannot read ([resume],
  //   [start=N]) into \setcounter{enumi}{N}.
  //
  //   Supersedes the default-lists Lua filter. Engine mirrors
  //   000-BBB…\smart-cleanup\ (presets.mjs / scan.mjs / numbering.mjs);
  //   keep the two in step if either is edited.
  // ════════════════════════════════════════════════════════════════════

  const SmartCleanup = (function () {
    'use strict';

    // ─── presets ───────────────────────────────────────────────────
    const STYLE_SAMPLE = {
      decimal: '1', 'lower-alpha': 'a', 'upper-alpha': 'A',
      'lower-roman': 'i', 'upper-roman': 'I',
    };
    const DELIMS = {
      period: (s) => s + '.', oneparen: (s) => s + ')', twoparens: (s) => '(' + s + ')',
    };
    const DEFAULT_PRESET = {
      name: 'default',
      levels: [
        { style: 'decimal',     delim: 'period' },
        { style: 'lower-alpha', delim: 'period' },
        { style: 'lower-roman', delim: 'period' },
        { style: 'upper-alpha', delim: 'period' },
      ],
      overflow: { style: 'decimal', delim: 'period' },
    };

    function markerForDepth(depth, preset) {
      const p = preset || DEFAULT_PRESET;
      const spec = p.levels[depth - 1] || p.overflow;
      return DELIMS[spec.delim](STYLE_SAMPLE[spec.style]);
    }

    // ─── scan ──────────────────────────────────────────────────────
    const VERBATIM_ENVS = new Set([
      'verbatim', 'Verbatim', 'BVerbatim', 'LVerbatim',
      'lstlisting', 'minted', 'alltt', 'comment',
      'tikzpicture', 'tikzcd', 'pgfpicture', 'picture', 'asy', 'filecontents',
    ]);
    const LIST_ENVS = new Set([
      'enumerate', 'itemize', 'description', 'list',
      'enumerate*', 'itemize*', 'description*',
    ]);

    function skipBalanced(s, i, open, close) {
      if (s[i] !== open) return i;
      let depth = 0;
      for (let j = i; j < s.length; j++) {
        const c = s[j];
        if (c === '\\') { j++; continue; }
        if (c === '%') { while (j < s.length && s[j] !== '\n') j++; continue; }
        if (c === open) depth++;
        else if (c === close) { depth--; if (depth === 0) return j + 1; }
      }
      return s.length;
    }

    function documentScope(s) {
      const b = s.match(/\\begin\s*\{document\}/);
      if (!b) return { start: 0, end: s.length, wholeFile: true };
      const start = b.index + b[0].length;
      const e = s.indexOf('\\end{document}', start);
      return { start, end: e === -1 ? s.length : e, wholeFile: false };
    }

    function readOptionalArg(s, i) {
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] !== '[') return null;
      const to = skipBalanced(s, j, '[', ']');
      return { body: s.slice(j + 1, to - 1), from: j, to };
    }

    function readBracedName(s, i) {
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] !== '{') return null;
      const to = skipBalanced(s, j, '{', '}');
      return { name: s.slice(j + 1, to - 1).trim(), to };
    }

    function scanEvents(s) {
      const scope = documentScope(s);
      const events = [];
      let i = scope.start;
      while (i < scope.end) {
        const c = s[i];
        if (c === '%') { while (i < scope.end && s[i] !== '\n') i++; continue; }
        if (c !== '\\') { i++; continue; }
        const m = /^\\([A-Za-z@]+|[\s\S])/.exec(s.slice(i));
        if (!m) { i++; continue; }
        const cs = m[1];
        const after = i + m[0].length;
        if (cs === 'begin' || cs === 'end') {
          const nm = readBracedName(s, after);
          if (!nm) { i = after; continue; }
          if (cs === 'begin' && VERBATIM_ENVS.has(nm.name)) {
            const tag = '\\end{' + nm.name + '}';
            const close = s.indexOf(tag, nm.to);
            i = close === -1 ? scope.end : close + tag.length;
            continue;
          }
          const opt = cs === 'begin' ? readOptionalArg(s, nm.to) : null;
          events.push({ kind: cs, name: nm.name, at: i, after: opt ? opt.to : nm.to, opt });
          i = opt ? opt.to : nm.to;
          continue;
        }
        if (cs === 'item') {
          const opt = readOptionalArg(s, after);
          events.push({ kind: 'item', at: i, custom: !!opt });
          i = opt ? opt.to : after;
          continue;
        }
        if (cs === 'setcounter' || cs === 'addtocounter') {
          const ctr = readBracedName(s, after);
          if (ctr) {
            const val = readBracedName(s, ctr.to);
            if (val && /^-?\d+$/.test(val.name)) {
              events.push({
                kind: 'counter', op: cs === 'setcounter' ? 'set' : 'add',
                ctr: ctr.name, value: parseInt(val.name, 10), at: i, after: val.to,
              });
              i = val.to;
              continue;
            }
          }
          i = after;
          continue;
        }
        i = after;
      }
      return { events, scope };
    }

    // ─── options ───────────────────────────────────────────────────
    const MARKER_SAMPLE = /^\s*\(?\s*(?:\d+|[a-z]|[A-Z]|i+v?|I+V?)\s*[.)]?\s*\)?\s*$/;

    function splitKeys(body) {
      const out = [];
      let buf = '', depth = 0;
      for (const c of body) {
        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') depth--;
        if (c === ',' && depth === 0) { out.push(buf.trim()); buf = ''; }
        else buf += c;
      }
      if (buf.trim()) out.push(buf.trim());
      return out;
    }

    function parseOptions(body) {
      const res = { resume: false, start: null, label: null, other: [], bareMarker: null, raw: body };
      if (body == null) return res;
      if (MARKER_SAMPLE.test(body) && body.indexOf('=') === -1) {
        res.bareMarker = body.trim();
        return res;
      }
      for (const k of splitKeys(body)) {
        const eq = k.indexOf('=');
        const name = (eq === -1 ? k : k.slice(0, eq)).trim();
        const val = eq === -1 ? null : k.slice(eq + 1).trim();
        if (name === 'resume' || name === 'resume*') res.resume = true;
        else if (name === 'start' && /^-?\d+$/.test(val || '')) res.start = parseInt(val, 10);
        else if (name === 'label') res.label = val;
        else res.other.push(k);
      }
      return res;
    }

    const lineOf = (s, off) => s.slice(0, off).split('\n').length;

    // ─── ledger ────────────────────────────────────────────────────
    function buildLedger(source) {
      const scanned = scanEvents(source);
      const entries = [];
      const warnings = [];
      const envStack = [];
      const enumStack = [];

      const owner = () => {
        for (let i = envStack.length - 1; i >= 0; i--) {
          if (LIST_ENVS.has(envStack[i].name)) return envStack[i];
        }
        return null;
      };

      for (const ev of scanned.events) {
        if (ev.kind === 'begin') {
          const frame = { name: ev.name, entry: null };
          if (ev.name === 'enumerate' || ev.name === 'enumerate*') {
            const depth = enumStack.length + 1;
            const opts = parseOptions(ev.opt ? ev.opt.body : null);
            const entry = {
              index: entries.length, depth, line: lineOf(source, ev.at),
              at: ev.at, afterOpen: ev.after,
              optFrom: ev.opt ? ev.opt.from : null,
              optTo: ev.opt ? ev.opt.to : null,
              opts, itemCount: 0, customLabels: 0,
              startValue: 0, current: 0, finalValue: 0,
              closed: false, endAt: null, resolvedFrom: null,
              ownSetCounter: false, midListCounter: false,
            };
            if (opts.resume) {
              let src = null;
              for (let i = entries.length - 1; i >= 0; i--) {
                if (entries[i].closed && entries[i].depth === depth) { src = entries[i]; break; }
              }
              if (!src) {
                for (let i = entries.length - 1; i >= 0; i--) {
                  if (entries[i].closed) { src = entries[i]; break; }
                }
                if (src) warnings.push({ line: entry.line, code: 'RESUME_DEPTH_FALLBACK',
                  msg: '[resume] at depth ' + depth + ' found no closed list at that depth; used the list opened at line ' + src.line + ' (depth ' + src.depth + ').' });
              }
              if (src) { entry.startValue = src.finalValue; entry.resolvedFrom = src.index; }
              else warnings.push({ line: entry.line, code: 'RESUME_NO_SOURCE',
                msg: '[resume] with no preceding list in the document body; numbering starts from 1.' });
            } else if (opts.start !== null) {
              entry.startValue = opts.start - 1;
            }
            entry.current = entry.startValue;
            entries.push(entry);
            enumStack.push(entry.index);
            frame.entry = entry;
          }
          envStack.push(frame);
          continue;
        }

        if (ev.kind === 'end') {
          let idx = -1;
          for (let i = envStack.length - 1; i >= 0; i--) {
            if (envStack[i].name === ev.name) { idx = i; break; }
          }
          if (idx === -1) continue;
          for (let i = envStack.length - 1; i >= idx; i--) {
            const f = envStack[i];
            if (f.entry) {
              f.entry.closed = true;
              f.entry.endAt = ev.at;
              f.entry.finalValue = f.entry.current;
              enumStack.pop();
            }
          }
          envStack.length = idx;
          continue;
        }

        if (ev.kind === 'item') {
          const own = owner();
          if (own && own.entry) {
            own.entry.itemCount++;
            own.entry.current++;
            if (ev.custom) own.entry.customLabels++;
          }
          continue;
        }

        if (ev.kind === 'counter') {
          if (!/^enum(i|ii|iii|iv)$/.test(ev.ctr)) continue;
          const own = owner();
          if (!own || !own.entry) continue;
          const e = own.entry;
          if (ev.op === 'set') e.current = ev.value; else e.current += ev.value;
          if (e.itemCount === 0) {
            e.ownSetCounter = true;
          } else {
            e.midListCounter = true;
            warnings.push({ line: lineOf(source, ev.at), code: 'MIDLIST_COUNTER',
              msg: '\\' + (ev.op === 'set' ? 'setcounter' : 'addtocounter') + '{' + ev.ctr +
                '} appears mid-list (list opened line ' + e.line + '). Pandoc only reads a counter ' +
                'immediately after \\begin{enumerate}, so this list will diverge from the PDF. ' +
                'Later resumed lists are still computed correctly.' });
          }
          continue;
        }
      }

      for (const f of envStack) {
        if (f.entry) {
          f.entry.finalValue = f.entry.current;
          warnings.push({ line: f.entry.line, code: 'UNCLOSED_ENUMERATE',
            msg: 'enumerate opened at line ' + f.entry.line + ' is never closed in the document body.' });
        }
      }

      return { entries, warnings, scope: scanned.scope };
    }

    // ─── rewrite ───────────────────────────────────────────────────
    function rewrite(source, ledger, options) {
      const o = options || {};
      const preset = o.preset || DEFAULT_PRESET;
      const applyCascade = o.applyCascade !== false;
      const honorAuthorMarkers = o.honorAuthorMarkers === true;

      const edits = [];
      const changes = [];
      const warnings = ledger.warnings.slice();

      for (const e of ledger.entries) {
        let marker = markerForDepth(e.depth, preset);
        let markerNote = 'preset';
        if (honorAuthorMarkers && e.opts.bareMarker) {
          marker = e.opts.bareMarker;
          markerNote = 'author';
        }

        let needCounter = e.startValue !== 0;
        if (needCounter && e.ownSetCounter) {
          needCounter = false;
          warnings.push({ line: e.line, code: 'COUNTER_CONFLICT',
            msg: 'list at line ' + e.line + ' has both a resume/start key and its own \\setcounter ' +
              'immediately after \\begin{enumerate}; the author\u2019s counter was kept.' });
        }
        if (e.opts.label) {
          warnings.push({ line: e.line, code: 'LABEL_DROPPED',
            msg: 'label=' + e.opts.label + ' cannot be read by Pandoc; replaced with the depth-' +
              e.depth + ' marker "' + marker + '".' });
        }

        const keepOriginal = e.optFrom !== null && !e.opts.resume && e.opts.start === null;
        const bracket = applyCascade
          ? '[' + marker + ']'
          : (keepOriginal ? source.slice(e.optFrom, e.optTo) : '');
        const counter = needCounter ? '\\setcounter{enumi}{' + e.startValue + '}' : '';
        const replacement = bracket + counter;

        const from = e.optFrom !== null ? e.optFrom : e.afterOpen;
        const to = e.optTo !== null ? e.optTo : e.afterOpen;
        const before = source.slice(from, to);
        if (before === replacement) continue;

        edits.push({ from, to, text: replacement });
        changes.push({
          index: e.index, line: e.line, depth: e.depth,
          before, after: replacement, items: e.itemCount,
          startValue: e.startValue, finalValue: e.finalValue,
          trigger: e.opts.resume ? 'resume' : (e.opts.start !== null ? 'start' : 'cascade'),
          resolvedFrom: e.resolvedFrom, markerSource: markerNote,
          droppedKeys: e.opts.other.slice(),
        });
      }

      edits.sort((a, b) => b.from - a.from);
      let out = source;
      for (const ed of edits) out = out.slice(0, ed.from) + ed.text + out.slice(ed.to);

      return { text: out, changes, warnings };
    }

    function run(source, options) {
      const ledger = buildLedger(source);
      const result = rewrite(source, ledger, options);
      return { text: result.text, changes: result.changes, warnings: result.warnings, ledger };
    }

    return { run, buildLedger, rewrite, markerForDepth, DEFAULT_PRESET, parseOptions };
  })();

  // ─── Smart Cleanup runner (all scripts, then report) ───────────────
  // Registry so later scripts in this family can be added without touching
  // the button handler.
  const SMART_CLEANUP_SCRIPTS = [
    {
      id: 'list-numbering',
      name: 'Ordered-list numbering',
      run: (src) => SmartCleanup.run(src),
    },
  ];

  function runSmartCleanup() {
    const before = editor.getText();
    if (!before || !before.trim()) {
      updateStatus('ready', 'Nothing to process — the editor is empty');
      return;
    }

    let text = before;
    const logs = [];
    let totalChanges = 0;

    for (const script of SMART_CLEANUP_SCRIPTS) {
      let res;
      try {
        res = script.run(text);
      } catch (err) {
        logs.push({ line: null, column: null, level: 'error', type: 'smart-cleanup',
          matchedText: null,
          message: script.name + ' failed: ' + (err && err.message ? err.message : String(err)) });
        console.error('[smart-cleanup] ' + script.id, err);
        continue;
      }
      text = res.text;
      totalChanges += res.changes.length;

      const byTrigger = { resume: 0, start: 0, cascade: 0 };
      for (const c of res.changes) byTrigger[c.trigger]++;

      logs.push({
        line: null, column: null, level: 'info', type: 'smart-cleanup', matchedText: null,
        message: script.name + ': ' + res.changes.length + ' list' +
          (res.changes.length === 1 ? '' : 's') + ' rewritten (' +
          byTrigger.cascade + ' marker, ' + byTrigger.resume + ' resume, ' +
          byTrigger.start + ' start) across ' + res.ledger.entries.length +
          ' enumerate environment' + (res.ledger.entries.length === 1 ? '' : 's') +
          (res.ledger.scope.wholeFile
            ? ' — no \\begin{document} found, so the whole file was treated as body'
            : ''),
      });

      for (const w of res.warnings) {
        logs.push({
          line: w.line || null, column: 1,
          level: w.code === 'RESUME_NO_SOURCE' || w.code === 'UNCLOSED_ENUMERATE' ? 'warning' : 'info',
          message: '[' + w.code + '] ' + w.msg,
          matchedText: null, type: 'smart-cleanup',
        });
      }
    }

    if (text !== before) {
      editor.setText(text);
    }

    updateLog(logs);
    const logTab = document.getElementById('outtab-log');
    if (logTab && typeof activateOutputTab === 'function') activateOutputTab(logTab);

    updateStatus('ready', totalChanges > 0
      ? 'Smart Cleanup: ' + totalChanges + ' list' + (totalChanges === 1 ? '' : 's') +
        ' rewritten — see Log'
      : 'Smart Cleanup: nothing to change');
  }

  const btnSmartCleanup = document.getElementById('btnSmartCleanup');
  if (btnSmartCleanup) btnSmartCleanup.addEventListener('click', runSmartCleanup);


}
