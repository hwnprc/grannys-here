// GET /api/status?id=<operation_id> -> {done, world_url, pano_url, splat_url, caption}
const API = "https://api.worldlabs.ai/marble/v1";

function pickSpz(urls = {}) {
  for (const size of ["500k", "100k", "full_res"]) if (urls[size]) return urls[size];
  return Object.values(urls)[0] || null;
}

export default async function handler(req, res) {
  const key = process.env.WORLDLABS_API_KEY;
  if (!key) return res.status(500).json({ error: "The server has no World Labs key configured." });
  const id = String(req.query.id || "");
  if (!/^[A-Za-z0-9-]{10,}$/.test(id)) return res.status(400).json({ error: "bad operation id" });

  try {
    const r = await fetch(`${API}/operations/${id}`, { headers: { "WLT-Api-Key": key } });
    if (!r.ok) return res.status(r.status).json({ error: "poll failed: HTTP " + r.status });
    const op = await r.json();
    if (op.error) return res.status(500).json({ error: JSON.stringify(op.error).slice(0, 200) });
    if (!op.done) {
      return res.status(200).json({ done: false, status: op.metadata?.progress?.status || "IN_PROGRESS" });
    }
    const world = op.response || {};
    const assets = world.assets || {};
    const spz = pickSpz(assets.splats?.spz_urls);
    return res.status(200).json({
      done: true,
      world_url: world.world_marble_url || null,
      pano_url: assets.imagery?.pano_url || null,
      // Proxied, so the page never depends on the CDN's CORS headers.
      splat_url: spz ? "/api/splat?u=" + encodeURIComponent(spz) : null,
      caption: assets.caption || null,
    });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach World Labs: " + e.message });
  }
}
