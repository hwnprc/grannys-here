# Devpost submission — Granny's Here

Paste each section into the matching Devpost field. Everything here is true of the
site and repository as submitted.

---

## Elevator pitch (under 200 chars)

Granny tells a story to her wristband. Her family keeps it, the place she described
is built in 3D from her own words, and when she returns there — or now and then — it
comes back to her.

---

## Inspiration

For people with early-to-mid stage dementia, memories aren't gone — they're hard to
reach. Most memory apps are passive: you have to already know what to search for, which
is precisely the thing that has become difficult. And family stories disappear for a
second reason nobody builds for: nothing captures the *places* they happened in. The
lake, the kitchen, the pew by the window are the first things lost when someone moves
into care.

So we stopped thinking about an app you open, and started thinking about a place you
stand in.

## What it does

**One site: https://grannys-here.vercel.app**

1. **She talks.** Wearing the Vexo band, Granny tells a story the way she always has.
   The band streams audio over Bluetooth; it is written down live in the browser.
2. **It becomes a memory.** The words are kept with the place they belong to. Nothing is
   invented: the memory is her full conversation, word for word.
3. **The place is built — from her words.** The moment a memory is kept, World Labs
   builds a walkable 3D world from the transcript, and it is rendered *on the page*,
   not on another site. No hand-written prompt, no photo needed: a story about a
   kitchen, a church or a bakery becomes somewhere you can look around.
4. **It comes back to her.** When she returns to the place, a reminder opens with a
   gentle invitation in her family's words and the place beneath them — *Step inside*.
   Reminders also arrive now and then on a timer, and a **Remind me** button is one tap
   away on every screen, phone included.
5. **Her family decides what surfaces.** Nothing is offered automatically until approved,
   and memories about loss, illness or conflict never auto-trigger — approved or not.

The memory box is never empty on a first visit: four memories and their built places
are there to try — Granny's park, a kitchen, a church, a café — and a one-click
*Show me with Granny's story* keeps her Stow Lake memory and steps straight into it.

## How we built it

- **Vexo Open band** over Web Bluetooth — microphone, taps, colour LED
- **Deepgram** for live speech-to-text in the browser
- **World Labs Marble** for the 3D world, generated from the transcript (with a reference
  photo when there is one); **Spark**, World Labs' own Gaussian-splat renderer, draws it
  inside the page
- **Vercel** — static site plus three serverless functions that keep the World Labs key
  server-side and proxy the splat so the page fetches it same-origin
- **Plain HTML, CSS and ES modules.** No framework, no build step. 47 automated tests on
  the capture, location and reminder logic
- **Type for the people it's for:** Atkinson Hyperlegible (drawn for low-vision readers),
  Bricolage Grotesque, IBM Plex Mono
- A Python pipeline alongside it (`capture.py`, `process.py`, `place_to_world.py`,
  `demo.py`) that drives the band locally, with OpenAI and ElevenLabs for the structured
  memory and a narrator voice

## Challenges we ran into

Most of our time went on things the documentation didn't tell us.

- **The world API returns no video.** It returns Gaussian splats, a GLB mesh, a panorama
  and a hosted link — nothing else. We rebuilt around the splat and render it ourselves.
- **The world page cannot be embedded** — `X-Frame-Options: DENY`. Found by reading the
  headers, not at demo time.
- **Sharing can only be set at creation.** No update endpoint exists, so our first world
  was permanently private. We regenerated it public and checked in a signed-out browser.
- **`image_prompt` is an object, not a string**; the live API names fields differently
  from the docs (`media_asset_id`, `world_id`); inline images are capped at 10 MB.
- **The band refuses LED commands while its microphone is on**, so the hardware's own
  blue light is the listening indicator — we couldn't override it, and shouldn't.
- **The band records Ogg Opus, not WAV**, and our `.gitignore` would have committed a
  real person's voice to a public repository. Caught and fixed.
- **One Bluetooth connection at a time.** A band held by one tab is invisible to
  everything else. We lost an hour to this before reading the rule properly.

## Accomplishments we're proud of

The safety model is enforced in three independent places and we tested the awkward
case rather than the easy one: a memory that is *approved **and** sensitive* still reads
"The band will never offer this."

The 3D world genuinely comes from her words. For Stow Lake the photograph fixed the lake
and the boathouse, and her transcript added the stone bridge the photo doesn't show. For
a kitchen and a church there was no photo at all — the counter under the window, the
jacaranda on the church steps, all of it came out of the sentences.

And it works on a first visit, on any device, with nothing to set up.

## What we learned

Read the headers, not the marketing. Half our real blockers were findable in minutes
with `curl -I` and a careful read of a schema — and each would have been fatal at 5:40pm.

Design for the actual reader. We threw out a cream-and-serif look that read as
machine-made, and chose a typeface drawn for low-vision eyes, 17px body text, and a
form that asks "What do you call this place?" instead of "Latitude".

## What's next

A push that wakes a locked phone (service worker, push server, home-screen install on
iPhone). Real GPS on a phone instead of a laptop. A caregiver view that shows which
memories still bring her joy, so families can stop offering the ones that don't.

## Built with

`javascript` `web-bluetooth` `vexo-open` `deepgram` `world-labs-marble`
`gaussian-splatting` `spark` `three.js` `vercel` `python` `openai` `elevenlabs`

## Links

- **Try it live:** https://grannys-here.vercel.app
- **Repository:** https://github.com/hwnprc/grannys-here
- **A world built from a story alone (no photo):**
  https://marble.worldlabs.ai/world/50dd409d-3ec5-471e-bfc4-24a49ae9553d
- **Demo video:** add the link once uploaded

---

## Demo video shot list (~2 min)

| # | Shot | Say |
|---|---|---|
| 1 | Band on a wrist, "Record & remember here", someone tells a short story | "Granny just talks. The blue light means it's listening." |
| 2 | The words appearing live, then *Keep this memory* | "It's written down and kept with the place." |
| 3 | The card: *Building the place…* → *A place is built from these words* | "And the place she described is built — from her words." |
| 4 | *Step inside*, drag around the world | Let it breathe. Say nothing. |
| 5 | A reminder opens on its own — invitation, her words, the place beneath | "When she comes back — or now and then — it comes back to her." |
| 6 | Family page: *approved and sensitive* still "never offered" | "Her family decides what reaches her." |

Shot 4 is the whole pitch. Don't narrate it.
