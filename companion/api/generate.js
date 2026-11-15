// POST /api/generate {prompt, draft} -> {operation_id}
// The World Labs key lives in this function's environment, never in the page.
const API = "https://api.worldlabs.ai/marble/v1";
const REALISM =
  "Photorealistic, like a real photograph of this real place, natural light, " +
  "true-to-life materials and textures.";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.WORLDLABS_API_KEY;
  if (!key) return res.status(500).json({ error: "The server has no World Labs key configured." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const prompt = String(body.prompt || "").trim();
  if (prompt.length < 10) {
    return res.status(400).json({ error: "Say a little more about the place first." });
  }

  try {
    const r = await fetch(API + "/worlds:generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "WLT-Api-Key": key },
      body: JSON.stringify({
        display_name: prompt.slice(0, 60),
        model: body.draft ? "marble-1.0-draft" : "marble-1.1",
        permission: { public: true },
        world_prompt: { type: "text", text_prompt: prompt.slice(0, 3500) + " " + REALISM },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 402) return res.status(402).json({ error: "World Labs is out of API credits." });
    if (!r.ok) return res.status(r.status).json({ error: data?.detail ? JSON.stringify(data.detail).slice(0, 200) : "World Labs error " + r.status });
    return res.status(200).json({ operation_id: data.operation_id });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach World Labs: " + e.message });
  }
}
