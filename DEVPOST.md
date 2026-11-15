# Devpost submission — Granny's Here

Copy each section into the matching Devpost field. Everything here is true of the
repository as submitted; check the two marked **[confirm]** before posting.

---

## Elevator pitch (200 chars)

Granny tells her stories to a wristband. When she returns to the place they happened,
it glows — one tap plays her own voice, and her family can walk the place in 3D.

---

## Inspiration

For people with early-to-mid stage dementia, memories aren't gone — they're hard to
reach. Almost every memory app is passive: you have to already know what to search
for, which is precisely the thing that has become difficult. And family stories
disappear for a second reason nobody builds for — nothing captures the *places* they
happened in. The lake, the kitchen, the pew by the window are the first things lost
when someone moves into care.

So we stopped thinking about an app you open, and started thinking about a place you
stand in.

## What it does

Granny wears the Vexo band and tells her stories out loud, the way she always has. AI
turns each story into a structured memory tied to a place.

When she is near that place again, the band glows warm amber. One tap plays a gentle
invitation in a calm narrator's voice — *"You used to come here with your daughter
every Sunday. Would you like to hear that story?"* — and then her own recorded voice,
telling it herself. Her family can open the place as a navigable 3D world, generated
from one photograph and her own description of it.

Three rules shaped every screen:

- **Invite, never quiz.** The band offers a story. It never tests her, never corrects her.
- **Family approves what can surface.** Nothing reaches her automatically until someone
  approves it, and memories about loss, illness or conflict never auto-trigger at all —
  approved or not.
- **Be honest about listening.** The band's light is solid blue whenever the mic is on,
  and the hardware refuses to let us override it.

## How we built it

- **Vexo Open band** over Bluetooth — microphone, tap detection, colour LED
- **Deepgram** for speech-to-text, **OpenAI** for structured memory extraction
- **ElevenLabs** for the narrator's invitation — deliberately *not* a clone of Granny;
  her voice is only ever her real recording
- **World Labs Marble** for the 3D world, from a reference photo **plus** her own words
- **Static HTML/CSS** for the family-facing pages. No build step, no CDN — a venue's
  wifi cannot break the demo
- A second **browser companion** (Node, 42 tests) that records on the band with real
  GPS and watches for a genuine departure and return

The two halves are bridged: `import_companion.py` converts the companion's exports into
the family pipeline, carrying real latitude, longitude, accuracy and radius across —
and never marks an import approved, so the family gate survives the bridge.

## Challenges we ran into

Most of our time went on things the documentation didn't tell us.

- **The world API returns no video.** Our architecture assumed an `.mp4`. It returns
  Gaussian splats, a GLB mesh, a panorama and a hosted link — and nothing else. We
  rebuilt the viewer around the panorama with the walkable world one click away.
- **`image_prompt` is an object, not a string.** A base64 string gets HTTP 422. The live
  API also returns `media_asset_id` and `world_id` where the docs show `id`.
- **The world page refuses to be embedded** — `X-Frame-Options: DENY`. An iframe renders
  an empty box, which we found by checking the headers rather than at demo time.
- **Sharing can only be set at creation.** There is no update endpoint, so our first
  world was permanently private — *"You don't have permission to view this world"* for
  anyone but us. We regenerated it public and verified it in a signed-out browser.
- **The band refuses LED commands while the microphone is on**, so "show listening with
  the light" was impossible — the hardware's own blue light is the indicator.
- **The band records Ogg Opus, not WAV.** Our `.gitignore` only covered `*.wav`, which
  would have committed a real person's voice to a public repository.

## Accomplishments we're proud of

The safety model is enforced in three independent places — the demo loop, the family
page and the viewer — and we tested the awkward case rather than the easy one: a memory
that is *approved **and** sensitive* still reads "The band will never offer this."

And the 3D world genuinely came from both inputs. The photograph fixed the real geometry
of the lake; her transcript added the stone bridge she mentioned, which the photo doesn't
show.

## What we learned

Read the headers, not the marketing. Half our real blockers — the missing video, the
refused iframe, the permanent privacy setting — were findable in minutes with `curl -I`
and a careful read of a schema, and each would have been fatal if found at 5:40pm.

## What's next

Real GPS on a phone instead of a laptop keystroke. Rendering the Gaussian splat inline
so the family walks the place without leaving the page. And a caregiver view that shows
which memories still bring her joy, so families can stop offering the ones that don't.

## Built with

`python` `javascript` `bluetooth` `vexo-open` `deepgram` `openai` `elevenlabs`
`world-labs-marble` `gaussian-splatting` `html` `css` `node`

## Links

- **Repository:** https://github.com/hwnprc/grannys-here
- **3D world:** https://marble.worldlabs.ai/world/4a37eb1b-10f9-427b-ab38-32103e48ce89
- **Demo video:** **[confirm]** add the link once uploaded

**[confirm]** Record Granny's real story before filming — `capture.py 25 --id sunday-park
--text no`. Until then `audio.wav` is a stand-in recording from the Vexo kit, not her.

---

## Demo video shot list (~2 min)

| # | Shot | Say |
|---|---|---|
| 1 | Band on a wrist, someone telling a short story about the lake | "Granny just talks. The band is listening — that's what the blue light means." |
| 2 | `memory.json` on screen | "AI turns it into a memory tied to a place — and marks whether it's too sensitive to ever surface." |
| 3 | `family.html` | "Her family decides what can reach her. Nothing surfaces until someone approves it." |
| 4 | Press `p`, band glows amber | "She arrives at the park. The band glows. It doesn't speak, it doesn't buzz — it waits." |
| 5 | Tap the band | Let the invitation and her voice play. **Say nothing over this.** |
| 6 | Viewer opens, then "Walk through this place" | "And the family can stand in it again." |

Shot 5 is the whole pitch. Don't narrate it.
