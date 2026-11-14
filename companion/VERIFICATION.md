# Verification — 14 November 2026

## Passed

- 47 automated tests cover source preservation, location timing and accuracy, movement during recording, observed departure/return, dwell, snooze, storage validation, duplicate prevention, consent/key gates, completion callbacks and notification permission/fallback.
- Capture tests use the official SDK simulator for band 25 and a fake speech adapter; location and notification tests use synthetic data. They do not establish real speech recognition or real travel.
- A real Deepgram WebSocket connection authenticated successfully in Chrome without enabling the microphone. The new 15-second voice test is independent of location; consent and credential readiness are visible before recording.
- Added tests cover connection refusal/redaction, timeout cleanup, no-audio authentication, automatic test stop, and consent/duration limits.
- Syntax checks pass for all application modules and setup script.
- The local server runs in the user’s Terminal. The updated UI and fictional At place → Leave → Return → reminder dialog were verified in Chrome, with no captured browser errors.
- Band 25 was connected over USB in Chrome. The identify command was sent successfully; the physical light was not independently observed.
- Required SDK files match the upstream Git blob hashes in VENDORED_SOURCE.json. The kit is excluded from this repository and installed separately with npm run setup-kit.

## Remaining live checks

- Enter the team’s Deepgram key privately in the app, obtain participant consent, record a distinctive sentence and verify both audio packet receipt and the exact transcript.
- Save a real recording with sufficiently accurate start/end location fixes, then carry the computer outside and back with the page visible.
- Desktop notification permission was enabled for localhost in Chrome. In-page reminder delivery is verified; actual OS banner delivery is not independently verified.
- Bluetooth, background/locked-phone operation, cross-device sync and integration with the Python family-memory pipeline are not verified or claimed.
- A fresh network clone of the pinned kit could not be run in the sandbox (DNS restriction). The setup script’s existing-kit hash verification is tested locally.
