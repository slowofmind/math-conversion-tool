# Overleaf → Accessible STEM transfer bookmarklet

Status: Checkpoint 3 of the Overleaf transfer workstream, revised to show
transfer status on the PLATFORM tab (the tab the user lands on) via
`atc-transfer-note` messages, in addition to the overlay on the Overleaf
page. Full plain-language + technical documentation, including where this
breaks if Overleaf changes, is a planned separate deliverable.

## What it does

Clicked while an Overleaf project is open, it: (1) immediately opens the
tool in a new tab with the `#overleaf-import` flag (must happen first,
inside the click's user-activation window, or the popup is blocked);
(2) fetches the project as a zip from Overleaf's own download endpoint,
same-origin with the user's session cookies; (3) waits for the tool tab's
`atc-import-ready` ping, then tells the tool tab it is fetching so the
user (now on the tool tab) sees progress in the status bar; (4) posts the
zip bytes via postMessage; (5) also maintains a status overlay on the
Overleaf page (covers the popup-blocked case). The zip travels tab-to-tab
in memory and touches no server of ours.

## Install

Create a new bookmark (right-click the bookmarks bar -> "Add page..." in
Chrome/Edge), name it (e.g. "Send to ATC tool"), and paste one of the
compact strings below as the URL. The leading `javascript:` must survive
the paste — some browsers strip it; retype it if so. Bookmarklets cannot
be pasted into the address bar directly.

## Readable source

```javascript
javascript:(() => {
  const TOOL = 'http://localhost:8000/index.html'; // or the Pages URL
  const TOOL_ORIGIN = new URL(TOOL).origin;
  const m = location.pathname.match(/\/project\/([a-f0-9]{24})/i);
  if (!m) { alert('Open an Overleaf project first.'); return; }
  let box = document.getElementById('atc-transfer-status');
  if (!box) {
    box = document.createElement('div');
    box.id = 'atc-transfer-status';
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;' +
      'background:#1a3c6e;color:#fff;padding:10px 16px;border-radius:6px;' +
      'font:13px sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3)';
    document.body.appendChild(box);
  }
  const say = (t) => { box.textContent = 'ATC transfer: ' + t; };
  const done = (t) => { say(t); setTimeout(() => box.remove(), 4000); };
  const child = window.open(TOOL + '#overleaf-import');
  if (!child) { done('popup blocked - allow popups for overleaf.com'); return; }
  say('fetching project...');
  const name = document.title.replace(/\s*[-\u2013|].*Overleaf.*$/i, '').trim();
  let zip = null, ready = false, sent = false;
  const go = () => {
    if (!zip || !ready || sent) return;
    sent = true;
    child.postMessage({ type: 'atc-overleaf-zip', zip, projectName: name }, TOOL_ORIGIN);
    say('sending...');
  };
  window.addEventListener('message', (ev) => {
    if (ev.origin !== TOOL_ORIGIN || ev.source !== child) return;
    const d = ev.data;
    if (d && d.type === 'atc-import-ready') {
      ready = true;
      if (!zip) {
        child.postMessage({ type: 'atc-transfer-note',
          text: 'Fetching project from Overleaf' + (name ? ' (' + name + ')' : '') + '...' },
          TOOL_ORIGIN);
      }
      go();
    }
    if (d && d.type === 'atc-zip-received') { done('sent \u2713'); }
  });
  fetch('/project/' + m[1] + '/download/zip', { credentials: 'same-origin' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(b => { zip = b; say('fetched ' + Math.round(b.byteLength / 1024) + ' KB...'); go(); })
    .catch(e => done('failed: ' + e.message));
  setTimeout(() => { if (!sent) done('timed out waiting for the tool tab'); }, 90000);
})();
```

## Compact form - LOCAL TESTING (tool at http://localhost:8000)

```
javascript:(()=>{const TOOL='http://localhost:8000/index.html';const TO=new URL(TOOL).origin;const m=location.pathname.match(/\/project\/([a-f0-9]{24})/i);if(!m){alert('Open an Overleaf project first.');return;}let box=document.getElementById('atc-transfer-status');if(!box){box=document.createElement('div');box.id='atc-transfer-status';box.style.cssText='position:fixed;top:12px;right:12px;z-index:99999;background:#1a3c6e;color:#fff;padding:10px 16px;border-radius:6px;font:13px sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3)';document.body.appendChild(box);}const say=t=>{box.textContent='ATC transfer: '+t;};const done=t=>{say(t);setTimeout(()=>box.remove(),4000);};const child=window.open(TOOL+'#overleaf-import');if(!child){done('popup blocked');return;}say('fetching project...');const name=document.title.replace(/\s*[-\u2013|].*Overleaf.*$/i,'').trim();let zip=null,ready=false,sent=false;const go=()=>{if(!zip||!ready||sent)return;sent=true;child.postMessage({type:'atc-overleaf-zip',zip,projectName:name},TO);say('sending...');};window.addEventListener('message',ev=>{if(ev.origin!==TO||ev.source!==child)return;const d=ev.data;if(d&&d.type==='atc-import-ready'){ready=true;if(!zip)child.postMessage({type:'atc-transfer-note',text:'Fetching project from Overleaf'+(name?' ('+name+')':'')+'...'},TO);go();}if(d&&d.type==='atc-zip-received'){done('sent \u2713');}});fetch('/project/'+m[1]+'/download/zip',{credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();}).then(b=>{zip=b;say('fetched '+Math.round(b.byteLength/1024)+' KB...');go();}).catch(e=>done('failed: '+e.message));setTimeout(()=>{if(!sent)done('timed out');},90000);})();
```

## Compact form - HARVARD PAGES (deployed tool)

Identical except for the first constant:

```
javascript:(()=>{const TOOL='https://code.harvard.edu/pages/nim022/math-conversion-tool/index.html';const TO=new URL(TOOL).origin;const m=location.pathname.match(/\/project\/([a-f0-9]{24})/i);if(!m){alert('Open an Overleaf project first.');return;}let box=document.getElementById('atc-transfer-status');if(!box){box=document.createElement('div');box.id='atc-transfer-status';box.style.cssText='position:fixed;top:12px;right:12px;z-index:99999;background:#1a3c6e;color:#fff;padding:10px 16px;border-radius:6px;font:13px sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3)';document.body.appendChild(box);}const say=t=>{box.textContent='ATC transfer: '+t;};const done=t=>{say(t);setTimeout(()=>box.remove(),4000);};const child=window.open(TOOL+'#overleaf-import');if(!child){done('popup blocked');return;}say('fetching project...');const name=document.title.replace(/\s*[-\u2013|].*Overleaf.*$/i,'').trim();let zip=null,ready=false,sent=false;const go=()=>{if(!zip||!ready||sent)return;sent=true;child.postMessage({type:'atc-overleaf-zip',zip,projectName:name},TO);say('sending...');};window.addEventListener('message',ev=>{if(ev.origin!==TO||ev.source!==child)return;const d=ev.data;if(d&&d.type==='atc-import-ready'){ready=true;if(!zip)child.postMessage({type:'atc-transfer-note',text:'Fetching project from Overleaf'+(name?' ('+name+')':'')+'...'},TO);go();}if(d&&d.type==='atc-zip-received'){done('sent \u2713');}});fetch('/project/'+m[1]+'/download/zip',{credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();}).then(b=>{zip=b;say('fetched '+Math.round(b.byteLength/1024)+' KB...');go();}).catch(e=>done('failed: '+e.message));setTimeout(()=>{if(!sent)done('timed out');},90000);})();
```

## Notes

- The localhost variant works against REAL Overleaf: the local receiver
  accepts messages from www.overleaf.com, so full end-to-end testing needs
  no deployment.
- The Harvard Pages variant assumes the user's browser is signed in to
  code.harvard.edu (see AUTH note below).
- The status overlay is plain inline DOM manipulation, which Overleaf's
  CSP permits; loading external scripts from a bookmarklet would not be.
- Timeout: 90 s waiting for fetch + tool tab, then the overlay reports
  and removes itself. Clicking again retries cleanly (overlay is reused).
- AUTH (open question, needs deployed testing): if the tool URL sits
  behind HarvardKey/GHES sign-in and the user is NOT already signed in,
  the opened tab shows the login page, the receiver never arms, and the
  bookmarklet times out at 90 s. Whether the #overleaf-import fragment
  survives the SSO redirect chain is untested; do not rely on it. The
  practical posture: users signed in earlier in the day are fine; a cold
  visit should sign in first (or after a timeout, click the bookmarklet
  again). A public github.io Pages deployment would remove the wall.
