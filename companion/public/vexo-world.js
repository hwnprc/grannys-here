// 03 / Step back into it — build a walkable place from a kept memory.
// Owns the #world section and the small "place" line on each memory card.
// Reads the same browser store the rest of the app writes; never changes it.
// The World Labs key stays in /api/*.
import { STORAGE_KEY } from './config.js';

const WORLDS_KEY = 'before-i-forget.worlds.v1';   // memoryId -> built world (ours, separate from his store)
const AUTO_KEY = 'before-i-forget.worlds.auto';   // "1" | "0"

const $ = id => document.getElementById(id);
const sel = $('world-source'), prompt = $('world-prompt'), build = $('world-build');
const status = $('world-status'), stage = $('world-stage'), caption = $('world-caption');
const walkLink = $('world-marble'), autoBox = $('world-auto');

// ---------- store access ----------
let memories = [];
function readMemories() {
  try { memories = (JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').memories) || []; }
  catch { memories = []; }
  return memories;
}
function readWorlds() { try { return JSON.parse(localStorage.getItem(WORLDS_KEY) || '{}'); } catch { return {}; } }
function writeWorld(id, data) {
  const all = readWorlds(); all[id] = { ...(all[id] || {}), ...data, updatedAt: Date.now() };
  try { localStorage.setItem(WORLDS_KEY, JSON.stringify(all)); } catch {}
}
function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function say(msg, bad = false) { status.textContent = msg; status.className = 'small' + (bad ? ' world-error' : ''); }

// ---------- section 03: the picker ----------
function fill() {
  readMemories();
  const current = sel.value;
  sel.innerHTML = '<option value="">Describe a place yourself…</option>' +
    memories.map(m => `<option value="${m.id}">${esc(m.place?.name || 'A place')}${m.person ? ' · ' + esc(m.person) : ''}</option>`).join('');
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
  $('world-count').textContent = memories.length ? `${memories.length} kept` : 'nothing kept yet';
}
function wordsFor(m) { return (m.conversation?.originalText || m.excerpt || '').trim(); }  // her full words, not just the excerpt
sel.addEventListener('change', () => {
  const m = memories.find(x => x.id === sel.value);
  prompt.value = m ? wordsFor(m) : '';
  prompt.readOnly = !!m;
  const built = m && readWorlds()[m.id];
  say(m ? (built?.splat_url ? `A place is already built for ${m.place?.name}. Build again to redo it, or step inside below.` : `Using the words kept at ${m.place?.name || 'this place'}.`) : '');
  if (built?.splat_url) show(built.splat_url, built).catch(() => {});
});

// auto-build preference
autoBox.checked = localStorage.getItem(AUTO_KEY) !== '0';
autoBox.addEventListener('change', () => { try { localStorage.setItem(AUTO_KEY, autoBox.checked ? '1' : '0'); } catch {} });

// ---------- building ----------
async function api(path, init) {
  const r = await fetch(path, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

let building = null;   // memory id (or '' for a typed place) currently in flight

async function buildFor(memoryId, text, { draft = true, auto = false } = {}) {
  if (building !== null) { if (auto) return; throw new Error('A place is already being built. Wait for it to finish.'); }
  if (text.length < 10) throw new Error('Choose a memory, or describe the place in a sentence or two.');
  building = memoryId || '';
  build.disabled = true; sel.disabled = true; stage.hidden = true; walkLink.hidden = true; caption.textContent = '';
  if (memoryId) writeWorld(memoryId, { status: 'building', splat_url: null });
  decorateCards();
  const started = Date.now();
  try {
    say(auto ? 'You kept a memory — building its place now…' : 'Sending her words to World Labs…');
    const { operation_id } = await api('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, draft }),
    });
    let result;
    for (;;) {
      result = await api('/api/status?id=' + encodeURIComponent(operation_id));
      if (result.done) break;
      const s = Math.round((Date.now() - started) / 1000);
      say(`Building the place — ${s}s. This usually takes a few minutes.`);
      setCardLine(memoryId, `Building the place… ${s}s`);
      await new Promise(r => setTimeout(r, 5000));
    }
    if (memoryId) writeWorld(memoryId, { status: 'ready', splat_url: result.splat_url || null, world_url: result.world_url || null, pano_url: result.pano_url || null, caption: result.caption || null });
    if (result.world_url) { walkLink.href = result.world_url; walkLink.hidden = false; }
    if (result.caption) caption.textContent = 'The model saw: ' + result.caption.slice(0, 220);
    if (!result.splat_url) { say('The place was built, but no 3D file came back. The World Labs link above still works.'); return; }
    await show(result.splat_url, result);
    say('Drag to look around · scroll to move closer.');
  } catch (e) {
    if (memoryId) writeWorld(memoryId, { status: 'failed', error: e.message });
    say('Could not build the place: ' + e.message, true);
  } finally {
    building = null; build.disabled = false; sel.disabled = false; decorateCards();
  }
}

build.addEventListener('click', () => {
  buildFor(sel.value || null, prompt.value.trim(), { draft: $('world-draft').checked })
    .catch(e => say(e.message, true));
});

// ---------- the renderer (three.js + Spark, loaded only when first needed) ----------
let viewer = null;
async function show(splatUrl, meta = {}) {
  say('Loading the 3D place…');
  const [THREE, { OrbitControls }, { SparkRenderer, SplatMesh }] = await Promise.all([
    import('three'), import('three/addons/controls/OrbitControls.js'), import('@sparkjsdev/spark'),
  ]);
  stage.hidden = false;
  if (viewer) { viewer.dispose(); viewer = null; }
  if (meta.world_url) { walkLink.href = meta.world_url; walkLink.hidden = false; }
  if (meta.caption) caption.textContent = 'The model saw: ' + meta.caption.slice(0, 220);

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.replaceChildren(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1000);
  camera.position.set(0, 0, 0.1);
  const size = () => { renderer.setSize(stage.clientWidth, stage.clientHeight, false); camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix(); };
  const scene = new THREE.Scene();
  scene.add(new SparkRenderer({ renderer }));          // without this, nothing draws
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = -0.4;
  controls.target.set(0, 0, -1.2);
  const splats = new SplatMesh({ url: splatUrl });
  splats.quaternion.set(1, 0, 0, 0);                   // SPZ is y-down
  scene.add(splats);
  await (splats.initialized ?? Promise.resolve());
  size();
  const ro = new ResizeObserver(size); ro.observe(stage);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
  viewer = { dispose() { renderer.setAnimationLoop(null); ro.disconnect(); renderer.dispose(); } };
  say('Drag to look around · scroll to move closer.');
  stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- section 02: a "place" line on every memory card ----------
function setCardLine(memoryId, text) {
  if (!memoryId) return;
  const card = document.querySelector(`.memory-card[data-memory="${CSS.escape(memoryId)}"]`);
  const line = card?.querySelector('.place-line span');
  if (line) line.textContent = text;
}
function decorateCards() {
  const worlds = readWorlds();
  for (const card of document.querySelectorAll('.memory-card')) {
    const id = card.dataset.memory; if (!id) continue;
    let row = card.querySelector('.place-line');
    if (!row) {
      row = document.createElement('p'); row.className = 'small place-line';
      const txt = document.createElement('span');
      const go = document.createElement('button'); go.type = 'button'; go.className = 'text-button'; go.textContent = 'Step inside ↗';
      go.addEventListener('click', () => {
        const w = readWorlds()[id];
        sel.value = id; sel.dispatchEvent(new Event('change'));
        if (w?.splat_url) show(w.splat_url, w).catch(e => say(e.message, true));
        else buildFor(id, wordsFor(memories.find(m => m.id === id) || {}), { draft: true }).catch(e => say(e.message, true));
        $('world').scrollIntoView({ behavior: 'smooth' });
      });
      row.append(txt, ' ', go);
      card.querySelector('.card-actions')?.before(row);
    }
    const w = worlds[id];
    const txt = row.querySelector('span'), go = row.querySelector('button');
    if (w?.status === 'building' || building === id) { txt.textContent = 'Building the place…'; go.hidden = true; }
    else if (w?.splat_url) { txt.textContent = 'A place is built from these words.'; go.textContent = 'Step inside ↗'; go.hidden = false; }
    else if (w?.status === 'failed') { txt.textContent = 'The place could not be built.'; go.textContent = 'Try again ↗'; go.hidden = false; }
    else { txt.textContent = 'No place built yet.'; go.textContent = 'Build it ↗'; go.hidden = false; }
  }
}

// ---------- auto-build: notice a newly kept memory without touching his save code ----------
// renderMemories() replaces #memory-list's children after every save, edit or delete.
// We diff the set of memory ids on each render; an id we have not seen before was just kept.
let known = new Set(readMemories().map(m => m.id));     // seeded on load: old memories are not rebuilt
new MutationObserver(() => {
  const now = readMemories();
  fill(); decorateCards();
  const fresh = now.filter(m => !known.has(m.id));
  known = new Set(now.map(m => m.id));
  if (!fresh.length || !autoBox.checked) return;
  const m = fresh[fresh.length - 1];
  const words = wordsFor(m);
  if (words.length < 10) return;
  sel.value = m.id; prompt.value = words; prompt.readOnly = true;
  buildFor(m.id, words, { draft: true, auto: true }).catch(() => {});
}).observe($('memory-list'), { childList: true });

window.addEventListener('storage', () => { fill(); decorateCards(); });
fill(); decorateCards();

// ---------- reminders: when she returns, the place comes with the words ----------
// Jack's return dialog is populated and opened in his code. We never touch that;
// we watch the dialog's `open` attribute and add the place beneath the words.
const dialog = $('return-dialog');
function reminderMemory() {
  const place = $('return-place')?.textContent.trim();
  const quoted = $('return-excerpt')?.textContent.trim().replace(/^[“"]|[”"]$/g, '');
  const ms = readMemories();
  return ms.find(m => m.place?.name === place && m.excerpt === quoted) || ms.find(m => m.place?.name === place) || null;
}
function decorateReminder() {
  if (!dialog?.open) return;
  const m = reminderMemory();
  let box = dialog.querySelector('.return-world');
  if (!box) {
    box = document.createElement('div'); box.className = 'return-world';
    const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy';
    const cap = document.createElement('p'); cap.className = 'small';
    const go = document.createElement('button'); go.type = 'button'; go.className = 'secondary';
    box.append(img, cap, go);
    dialog.querySelector('.button-row')?.before(box);
  }
  const [img, cap, go] = [box.querySelector('img'), box.querySelector('p'), box.querySelector('button')];
  if (!m) { box.hidden = true; return; }
  const w = readWorlds()[m.id];
  box.hidden = false;
  go.onclick = () => {
    $('close-return')?.click();                      // the neutral close: no snooze, no state change
    sel.value = m.id; sel.dispatchEvent(new Event('change'));
    if (w?.splat_url) show(w.splat_url, w).catch(e => say(e.message, true));
    else buildFor(m.id, wordsFor(m), { draft: true }).catch(e => say(e.message, true));
    $('world').scrollIntoView({ behavior: 'smooth' });
  };
  if (w?.splat_url) {
    img.hidden = !w.pano_url; if (w.pano_url) img.src = w.pano_url;
    cap.textContent = 'This place was built from the words you kept here.';
    go.textContent = 'Step inside this place ↗';
  } else if (w?.status === 'building') {
    img.hidden = true; cap.textContent = 'The place is still being built — it will be ready in a few minutes.'; go.textContent = 'See progress ↗';
  } else {
    img.hidden = true; cap.textContent = 'No place has been built from these words yet.'; go.textContent = 'Build the place ↗';
  }
}
if (dialog) new MutationObserver(decorateReminder).observe(dialog, { attributes: true, attributeFilter: ['open'] });
