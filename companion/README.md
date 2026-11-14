# Before I Forget

A local VexoHacks companion: record your own conversation with **Vexo-HACK-25**, save it with the computer’s contemporaneous location, then recall the words after an observed departure and return.

This optional browser companion runs separately from the repository’s Python capture/processing/demo and 3D viewer. It does not read or alter `memories/`, import family memories, or change the family approval and sensitivity gates. Automatic saving is an explicit self-recording option; it is not a caregiver approval system. Close other band programs before connecting here.

## Start the app

Requires Node.js 20 or newer and Chrome or Edge on the Mac. There are no npm dependencies. The Vexo kit is downloaded separately and is never committed.

```bash
cd companion
npm run setup-kit
npm start
```

Open **http://localhost:3000**. If that port is already occupied, use `PORT=3001 npm start` and http://localhost:3001.

The server binds to `127.0.0.1` and serves only the public app and the required SDK modules. It does not expose `.env`, project files or a public website. Do not deploy this prototype.

## Try it without hardware

Open `dist/Before_I_Forget_Demo.html` in Chrome. It is a complete offline preview with hardware, API-key input and GPS disabled. Or choose **Try a demo** in the running app.

1. Load the fictional conversation.
2. Review the reminder and check the place-confirmation box.
3. Choose **Keep this memory**.
4. Expand **Test a simulated return** under the saved card.
5. Click **At place**, **Leave**, then **Return**. Keep the page visible for five seconds.
6. The reminder opens with **Simulated location — demo only** and the original excerpt.

The demo coordinates and words are fictional. Simulation has its own transient state and cannot arm or advance real GPS reminders.

## Connect the real band

1. Use the running localhost app in Chrome or Edge on the Mac. iPhone/iPad browsers cannot connect through this kit’s Web Bluetooth route. First-demo storage is in one browser: the Mac’s memories do not appear automatically on the phone.
2. Close the Vexo dashboard or any other program connected to band 25. Double-tap the band so it blinks blue.
3. Choose **Connect band**, then select **Vexo-HACK-25**. The SDK filters by exact name and service UUID, then verifies the reported band number. It never scans a range of band numbers.
4. **Flash light** checks the documented identify command without recording. The USB button is the documented fallback for a data cable; it still verifies band 25.
5. Obtain everyone’s permission for recording and sending audio to Deepgram. Open **Set up live transcription**. Type your own team’s Deepgram key into the password field and choose **Use key for this session**. Never paste a key into chat. The field is cleared, and the key lives only in tab memory, not browser storage or a source file. No OpenAI key is needed.
6. Optionally name the place. Leave **Save my recording at this device’s location** checked, check the consent box, then select **Record & remember here**. Allow this page’s location request. A fresh location is required before the microphone starts. Audio goes directly to Deepgram through the kit’s fixed WebSocket destination with `mip_opt_out=true`. While recording, the band shows blue and the app displays the destination. Recordings stop at two minutes, on page hide, when the connection ends or when transcription fails.
7. Say a distinctive agreed sentence. Check that both packet receipt and the actual sentence appear. Choose **Stop & save**. The app checks the end location, saves an exact excerpt, and starts watching for a return. The reminder begins: “Last time you were here, you were talking about this…”
8. Walk outside the place radius, then return with the computer and this page visible. A confirmed return opens the reminder. Choose **Enable desktop notifications** for an additional system notification containing the reminder text.
9. If location is stale, inaccurate or movement is observed during capture, the transcript opens for manual review instead of guessing a place. Turning off automatic saving also preserves the manual review flow. Name, reminder and original words remain editable/viewable.

**Verified:** band 25 connected over USB in Chrome and the identify command was sent. **Still unverified:** actual microphone audio, a Deepgram transcript, Bluetooth and a real GPS departure/return. SDK protocol simulation and a fake speech service exercise the adapter in tests. The band has no GPS, speaker or vibration motor. The app uses the computer’s geolocation; there is no phone bridge.

## Return reminders

- Defaults: 150 m radius, 50 m exit buffer, max 100 m uncertainty for each location, 5 seconds dwell, max 30-second sample age, max 15-second gap during return confirmation. Settings live in `public/config.js`; each memory can select its radius.
- Both place-anchor and current-fix uncertainty are included. Manual coordinates retain unknown accuracy and therefore cannot produce real GPS reminders. Use a measured anchor at the actual place.
- Live auto-save records start/end fixes and checks observed fixes during recording. A fresh end fix establishes the initial inside baseline. It cannot prove that the user never moved between observations.
- The first observation must establish that the user is inside. Saving, importing or being initially outside never triggers a reminder or proves a departure.
- A confirmed departure arms a return; consecutive fresh, sufficiently accurate inside observations over the dwell period trigger once. An uncertain/stale fix breaks pending dwell. Staying inside does not repeat the alert.
- Pause, reload or hiding the page clears pending dwell and requires a new observed baseline. Time offline never proves departure. Snooze lasts ten minutes and still requires a later departure/return cycle.
- The band has no location sensor. Take the computer with you; leaving it on a desk cannot detect your return. Keep the page visible and the computer awake. Hiding/reloading pauses tracking and requires a new baseline.
- Desktop notifications are optional, permission-gated and contain the reminder text. If blocked or unsupported, the in-page dialog still works. No service worker or background/locked-phone delivery is provided. Do not rely on room/table-level positioning or use this prototype as a medical device.

## Data and privacy

Only manually saved memories or recordings made with the automatic-save option selected, their source transcripts, place coordinates, source metadata and reminder state go into this browser’s localStorage under `before-i-forget.v3`. Other versions’ storage keys remain untouched; no v0.2 migration is claimed. Corrupt or unrecognised data is not overwritten. Export and delete controls are available per the interface. Delete removes the stored conversation with the memory; exports already downloaded remain wherever you saved them. The active unsaved conversation stays in tab memory until replaced or the tab closes.

Vexo capture uses the kit’s unique live session ID scoped to band 25, not an invented provider recording ID. Audio event times are receipt times. The conversation occurrence time stays unknown; capture start and receipt times are recorded separately. Manual conversation dates are user-entered. Source IDs deduplicate matching saved excerpts at the same coordinates; manual entries with no source ID are kept distinct. Original transcripts and editable reminders remain separate. No AI summaries or inferred identities are used.

No raw audio is saved. Live audio is sent to Deepgram only after explicit consent and start. The app itself does not upload saved memories. Keys are forgotten on reload/close or **Forget key**. Exported JSON contains private conversation and location data.

## Files and validation

- `server.mjs`: dependency-free Node server with restricted static paths and privacy headers.
- `public/vexo.html`, `vexo.css`, `base.css`, `vexo-ui.js`: responsive UI, local storage, export/delete/edit, source inspection and reminder interactions.
- `public/vexo-data.js`: coordinate validation, original/excerpt validation and tested return state machine.
- `public/vexo-remember.js`: time-matched place association, exact excerpt reminders and optional desktop notifications.
- `public/vexo-capture.js`: real SDK integration and consented transcription using the kit’s unchanged Deepgram helper.
- `public/config.js`: one confirmed band number and configurable thresholds.
- `test/*.test.mjs`: domain, adapter and request-handler tests. HTTP tests invoke the handler in process; they do not claim a listening server was verified.
- `scripts/build-preview.mjs`: generates the self-contained offline preview.

```bash
npm test
npm run check
node scripts/build-preview.mjs
```

The server is verified running from the user’s Terminal, and the labelled simulated-return flow was verified in Chrome. See `VERIFICATION.md` for the precise scope of validation.

## Starting point and third-party source

The v0.2 starter archive could not be downloaded in this environment. This is an isolated implementation from the project handoff in the same dependency-free Node/HTML/JS stack; the earlier archive and legacy 3D code were not modified, and its earlier 12 tests were not rerun here. The browser companion is prepared for its own feature branch; no deployment is required.

The actual event kit was found through the team’s **YC hackathon hardware** document, which links to https://github.com/VexoAI-Org/vexo-open-kit. The setup script downloads and verifies the required JavaScript files and speech helper unchanged under ignored `vexo-open-kit/` from commit `1e4291e2fa4896b1f603d3d4f0b009c483425da0`. The local development copy initially used a selected runtime subset; a fresh setup clones the pinned repository. `VENDORED_SOURCE.json` records the required file hashes. SDK source and generated offline bundles are excluded from Git. The kit’s MIT license applies to its own source. Do not edit the kit to change application behavior.
