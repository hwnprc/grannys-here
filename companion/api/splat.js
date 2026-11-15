// GET /api/splat?u=<marble cdn url> -> the .spz bytes, same-origin.
// Marble's CDN is another origin; proxying removes any CORS question and keeps
// the page's fetch simple. Only Marble's own CDN is allowed through.
export default async function handler(req, res) {
  const u = String(req.query.u || "");
  let url;
  try { url = new URL(u); } catch { return res.status(400).json({ error: "bad url" }); }
  if (url.protocol !== "https:" || !/(^|\.)worldlabs\.ai$/.test(url.hostname)) {
    return res.status(403).json({ error: "only World Labs assets may be proxied" });
  }
  try {
    const r = await fetch(url.toString());
    if (!r.ok) return res.status(r.status).json({ error: "upstream HTTP " + r.status });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: "proxy failed: " + e.message });
  }
}
