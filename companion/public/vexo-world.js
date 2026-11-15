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

// Some stories already have a world. The demo is Granny's Stow Lake story, and that
// place was built from these exact words earlier (memories/sunday-park): point at
// it instead of building it again, so the demo is instant and spends no credits.
const KNOWN_WORLDS = {
  'granny-park-v1': {
    status: 'ready',
    splat_url: '/memories/sunday-park/world.spz',
    pano_url: '/memories/sunday-park/pano.jpg',
    thumbnail_url: '/memories/sunday-park/world_thumb.jpg',
    world_url: 'https://marble.worldlabs.ai/world/4a37eb1b-10f9-427b-ab38-32103e48ce89',
    caption: 'A serene lakeside setting within a city park, under the gentle illumination of a sunny autumn afternoon.',
  },
};
function seedKnownWorld(m) {
  const k = KNOWN_WORLDS[m.conversation?.sourceId];
  if (!k || readWorlds()[m.id]?.splat_url) return false;
  writeWorld(m.id, k);
  say(`This place was already built from these words — step inside below.`);
  show(k.splat_url, k).catch(e => say(e.message, true));
  return true;
}

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
    if (memoryId) writeWorld(memoryId, { status: 'ready', splat_url: result.splat_url || null, world_url: result.world_url || null, pano_url: result.pano_url || null, thumbnail_url: result.thumbnail_url || null, caption: result.caption || null });
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
  if (seedKnownWorld(m)) { decorateCards(); return; }      // already built: nothing to spend
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
    const pic = w.pano_url || w.thumbnail_url;         // draft worlds return no panorama
    img.hidden = !pic; if (pic) img.src = pic;
    cap.textContent = 'This place was built from the words you kept here.';
    go.textContent = 'Step inside this place ↗';
  } else if (w?.status === 'building') {
    img.hidden = true; cap.textContent = 'The place is still being built — it will be ready in a few minutes.'; go.textContent = 'See progress ↗';
  } else {
    img.hidden = true; cap.textContent = 'No place has been built from these words yet.'; go.textContent = 'Build the place ↗';
  }
}
if (dialog) new MutationObserver(decorateReminder).observe(dialog, { attributes: true, attributeFilter: ['open'] });

// ---------- "Add the demo memories": three stories, through his own forms ----------
// Drives his Try-a-demo and Paste-text paths exactly as a person would, so his
// validation, duplicate check and place confirmation all still apply. Stories
// already in the box are skipped. The park's place is instant (already built);
// the others are built for real by the auto-build above.
const DEMO_STORIES = [
  { kind: 'demo', place: 'Stow Lake, Golden Gate Park' },           // his demo button: Granny's park story
  { kind: 'manual', place: 'The kitchen on Alabama Street', person: 'your mother', lat: '37.7512', lon: '-122.4119',
    text: "My mother's kitchen was the back room on Alabama Street, the one with the long counter under the window. " +
          "Every December she'd have all of us in there making tamales — the corn husks soaking in the sink, the pot " +
          "going on the stove, flour on everything. I was seven the first Christmas she let me spread the masa myself. " +
          "The light came in low over the counter in the afternoon and the whole room smelled of chiles and steam.",
    excerpt: "I was seven the first Christmas she let me spread the masa myself.",
    reminder: 'You learned to make tamales at this counter, the Christmas you were seven. Shall we remember it?' },
  { kind: 'manual', place: 'The church on Dolores Street', person: 'your grandfather', lat: '37.7598', lon: '-122.4253',
    text: "Your grandfather sang in the choir at the church on Dolores Street, the one with the two white towers. " +
          "We sat in the third pew on the left every Sunday because he said the sound came down best there. " +
          "After the service he'd take me across to the park and buy me an orange from the man with the cart. " +
          "In spring the jacaranda outside dropped purple all over the steps and he'd grumble about his shoes.",
    excerpt: "We sat in the third pew on the left every Sunday because he said the sound came down best there.",
    reminder: 'Your grandfather sang here, and you sat in the third pew on the left. Would you like to hear about it?' },
];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function keepStory(st) {
  if (readMemories().some(m => m.place?.name === st.place)) return 'already';
  if (st.kind === 'demo') { $('tab-demo').click(); $('load-demo').click(); }
  else {
    $('tab-manual').click(); $('manual-text').value = st.text; $('use-manual').click(); await pause(300);
    $('person').value = st.person; $('place-name').value = st.place;
    $('excerpt').value = st.excerpt; $('reminder').value = st.reminder;
    $('latitude').value = st.lat; $('longitude').value = st.lon;
    $('latitude').dispatchEvent(new Event('input'));       // his handler: manual coords, no anchor
  }
  await pause(300);
  $('place-confirm').checked = true;
  document.querySelector('#memory-form button[type=submit]').click();
  await pause(700);
  return readMemories().some(m => m.place?.name === st.place) ? 'kept' : 'failed';
}
const seedBtn = $('world-keep-another');
seedBtn?.addEventListener('click', async () => {
  try {
    seedBtn.disabled = true;
    const out = [];
    for (const st of DEMO_STORIES) out.push(`${st.place.split(',')[0]}: ${await keepStory(st)}`);
    const kept = out.filter(o => o.endsWith('kept')).length;
    say(kept ? `${kept} new memor${kept === 1 ? 'y' : 'ies'} kept — ${out.join(' · ')}. The park's place is ready now; the others are being built.`
             : `All three are already in the box — ${out.join(' · ')}.`, !kept && out.some(o => o.endsWith('failed')));
    $('memories').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { say(e.message, true); }
  finally { seedBtn.disabled = false; }
});

// ---------- the way in ----------
$('begin-band')?.addEventListener('click', () => { $('tab-band').click(); document.querySelector('.source-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('begin-type')?.addEventListener('click', () => { $('tab-manual').click(); document.querySelector('.source-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('manual-text')?.focus(), 400); });
$('begin-demo')?.addEventListener('click', async () => {
  const btn = $('begin-demo'); btn.disabled = true;
  try {
    const park = DEMO_STORIES[0];
    const r = await keepStory(park);
    const m = readMemories().find(x => x.place?.name === park.place);
    if (!m) { say('Could not keep the story — see the message above the form.', true); return; }
    sel.value = m.id; sel.dispatchEvent(new Event('change'));
    const w = readWorlds()[m.id];
    if (w?.splat_url) await show(w.splat_url, w);
    $('world').scrollIntoView({ behavior: 'smooth', block: 'start' });
    say(r === 'kept' ? 'Her story is kept, and this is the place she described. Drag to look around.' : 'This is the place she described. Drag to look around.');
  } catch (e) { say(e.message, true); }
  finally { btn.disabled = false; }
});

// one button: "Step inside" when the place exists, "Build this place" when it does not
function refreshBuildLabel() {
  const m = memories.find(x => x.id === sel.value);
  const built = m && readWorlds()[m.id]?.splat_url;
  build.textContent = built ? 'Step inside ↗' : 'Build this place ↗';
  build.dataset.mode = built ? 'open' : 'build';
  $('world-words').open = !m;                                   // typing a place: words visible; kept memory: folded
}
sel.addEventListener('change', refreshBuildLabel);
new MutationObserver(refreshBuildLabel).observe($('memory-list'), { childList: true });
refreshBuildLabel();
build.addEventListener('click', e => {
  if (build.dataset.mode !== 'open') return;                    // the build handler above runs otherwise
  e.stopImmediatePropagation();
  const m = memories.find(x => x.id === sel.value); const w = m && readWorlds()[m.id];
  if (w?.splat_url) show(w.splat_url, w).catch(err => say(err.message, true));
}, true);

// if someone presses Keep with no location at all, open the by-hand fields instead of a silent refusal
document.querySelector('#memory-form button[type=submit]')?.addEventListener('click', () => {
  if (!$('latitude').value || !$('longitude').value) { const d = document.querySelector('.coords'); if (d) d.open = true; }
});

// ---------- the reminder is one tap away, everywhere ----------
const fab = $('remind-fab');
function fmtLeft(ms) { const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; }
function updateFab() {
  if (!fab) return;
  fab.hidden = readMemories().length === 0;                  // nothing to be reminded of yet
  const cd = $('remind-countdown');
  const mins = Number(timedSel?.value || 0);
  cd.textContent = mins > 0 && nextTimedAt ? `next in ${fmtLeft(nextTimedAt - Date.now())}` : 'only on return';
}
setInterval(updateFab, 1000);
new MutationObserver(updateFab).observe($('memory-list'), { childList: true });
$('remind-now')?.addEventListener('click', () => {
  if (!readMemories().length) { say('Keep a memory first — then there is something to be reminded of.', true); $('capture').scrollIntoView({ behavior: 'smooth' }); return; }
  fireTimedReminder();
});
$('remind-timing')?.addEventListener('click', () => {
  $('world-options').open = true;
  $('world').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => timedSel?.focus(), 500);
});
updateFab();

// ---------- a first reminder, by itself, shortly after arriving ----------
// Once per visit, about half a minute in: if something is kept and no one is
// typing or recording, one memory comes up on its own — so the reminder is seen,
// not hunted for. Never while the form or a recording has their attention.
const FIRST_KEY = 'before-i-forget.worlds.firstShown';
function busy() {
  const a = document.activeElement; const tag = a?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const recording = /recording|listening|starting|stopping/i.test($('recording-status')?.textContent || '');
  return typing || recording || document.getElementById('return-dialog')?.open || document.getElementById('edit-dialog')?.open;
}
function firstReminder(attempt = 0) {
  if (sessionStorage.getItem(FIRST_KEY)) return;
  if (!readMemories().length) { if (attempt < 20) setTimeout(() => firstReminder(attempt + 1), 15000); return; }
  if (busy() || document.hidden) { if (attempt < 20) setTimeout(() => firstReminder(attempt + 1), 15000); return; }
  try { sessionStorage.setItem(FIRST_KEY, '1'); } catch {}
  fireTimedReminder();
}
setTimeout(() => firstReminder(), 30000);
