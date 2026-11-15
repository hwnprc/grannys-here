// 03 / Step back into it — build a walkable place from a kept memory.
// Owns the #world section only. Reads the same browser store the rest of the
// app writes; never changes it. The World Labs key stays in /api/*.
import { STORAGE_KEY } from './config.js';

const $ = id => document.getElementById(id);
const sel = $('world-source'), prompt = $('world-prompt'), build = $('world-build');
const status = $('world-status'), stage = $('world-stage'), caption = $('world-caption');
const walkLink = $('world-marble');

let memories = [];
function readMemories() {
  try { memories = (JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').memories) || []; }
  catch { memories = []; }
}
function fill() {
  readMemories();
  const current = sel.value;
  sel.innerHTML = '<option value="">Describe a place yourself…</option>' +
    memories.map(m => `<option value="${m.id}">${esc(m.place?.name || 'A place')}${m.person ? ' · ' + esc(m.person) : ''}</option>`).join('');
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
  $('world-count').textContent = memories.length ? `${memories.length} kept` : 'nothing kept yet';
}
function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

sel.addEventListener('change', () => {
  const m = memories.find(x => x.id === sel.value);
  // Her own words are the prompt: the full conversation, not just the excerpt.
  prompt.value = m ? (m.conversation?.originalText || m.excerpt || '') : '';
  prompt.readOnly = !!m;
  say(m ? `Using the words kept at ${m.place?.name || 'this place'}.` : '');
});
window.addEventListener('storage', fill);
document.addEventListener('visibilitychange', () => { if (!document.hidden) fill(); });
fill();

function say(msg, bad = false) { status.textContent = msg; status.className = 'small' + (bad ? ' world-error' : ''); }

async function api(path, init) {
  const r = await fetch(path, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

build.addEventListener('click', async () => {
  const text = prompt.value.trim();
  if (text.length < 10) return say('Choose a memory, or describe the place in a sentence or two.', true);
  build.disabled = true; sel.disabled = true; stage.hidden = true; walkLink.hidden = true; caption.textContent = '';
  const started = Date.now();
  try {
    say('Sending her words to World Labs…');
    const { operation_id } = await api('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, draft: $('world-draft').checked }),
    });
    let result;
    for (;;) {
      result = await api('/api/status?id=' + encodeURIComponent(operation_id));
      if (result.done) break;
      say(`Building the place — ${Math.round((Date.now() - started) / 1000)}s. This usually takes a few minutes.`);
      await new Promise(r => setTimeout(r, 5000));
    }
    if (result.world_url) { walkLink.href = result.world_url; walkLink.hidden = false; }
    if (result.caption) caption.textContent = 'The model saw: ' + result.caption.slice(0, 220);
    if (!result.splat_url) { say('The place was built, but no 3D file came back. The World Labs link above still works.'); return; }
    await show(result.splat_url);
    say('Drag to look around · scroll to move closer.');
  } catch (e) {
    say('Could not build the place: ' + e.message, true);
  } finally {
    build.disabled = false; sel.disabled = false;
  }
});

// Spark and three.js only load when a place is actually built: they are big,
// and most visits never reach this section.
let viewer = null;
async function show(splatUrl) {
  say('Loading the 3D place…');
  const [THREE, { OrbitControls }, { SparkRenderer, SplatMesh }] = await Promise.all([
    import('three'), import('three/addons/controls/OrbitControls.js'), import('@sparkjsdev/spark'),
  ]);
  stage.hidden = false;
  if (viewer) { viewer.dispose(); viewer = null; }

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.replaceChildren(renderer.domElement);
  const size = () => { renderer.setSize(stage.clientWidth, stage.clientHeight, false); camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix(); };

  const scene = new THREE.Scene();
  scene.add(new SparkRenderer({ renderer }));          // without this, nothing draws
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1000);
  camera.position.set(0, 0, 0.1);
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
  stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
