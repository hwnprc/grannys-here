# Band 25: BLE protocol and live verification

Checked on 14 November 2026 against [Vexo Open contract v1.1, revision 2026-11-12](https://github.com/VexoAI-Org/vexo-open-kit/blob/1e4291e2fa4896b1f603d3d4f0b009c483425da0/contract/contract.md) and the unchanged JavaScript SDK pinned in [VENDORED_SOURCE.json](VENDORED_SOURCE.json). This describes the documented interface; the kit does not include the firmware implementation.

## Observed results

- The existing Chrome companion tab reported **Vexo-HACK-25**, **Connected over Bluetooth**, and a received battery reading (7% initially, 9% later). These are historical observations.
- Initially the microphone was off, consent was unchecked, and the app had received 0 audio packets. Deepgram authentication was already verified.
- A subsequent completed voice test at **15:58 Pacific** showed **531 received audio packets**, a populated Deepgram transcript, consent checked, and the microphone off after completion. Exact transcription accuracy was not independently assessed. No conversation text or audio is committed here.
- The earlier macOS Bluetooth Settings check did not show the band. That pairing-list check was insufficient to rule out the app-level BLE connection subsequently observed in Chrome.
- Physical location departure/return, iPhone background notifications, and the physical band's exact firmware version/capability values have not been independently verified here.

These results update the older connection-only observations in README.md and VERIFICATION.md. The current companion still uses the computer's location; it does not yet provide iPhone background return notifications.

## Discovery and connection

The team's number is **25**, configured once in `public/config.js`. Connect only to `Vexo-HACK-25`; verify the number reported by GET_INFO. A double-tap opens a 60-second advertising window with a blue blink. The band accepts one Bluetooth connection at a time and stops advertising while connected. There is no pairing/bonding; use Chrome's Web Bluetooth chooser, not macOS pairing. Close any other band client before connecting.

Filter on both the exact device name and the service UUID:

```js
{ filters: [{
  name: 'Vexo-HACK-25',
  services: ['254f0001-df82-4a9c-a2b5-563a0f6b2021']
}] }
```

| Attribute | UUID | Operation |
|---|---|---|
| Service | `254f0001-df82-4a9c-a2b5-563a0f6b2021` | Vexo Open |
| RX | `254f0002-df82-4a9c-a2b5-563a0f6b2021` | Computer writes commands |
| TX | `254f0003-df82-4a9c-a2b5-563a0f6b2021` | Band sends notifications |

Subscribe to TX before sending the first command. Use write-with-response, one command at a time, with a 2-second protocol-response timeout. Match sequence and opcode, validate status and response length. One BLE notification is one complete frame. USB COBS framing does not apply to BLE. Respect GET_INFO's negotiated `max_frame` (at most 244 bytes). All multibyte integers are little-endian and packed without padding.

## Exposed frames

| Frame type | Meaning | Body after type |
|---|---|---|
| `0x01` | Command | `seq:u8, opcode:u8, args...` |
| `0x02` | Response | `seq:u8, opcode:u8, status:u8, data...` |
| `0x03` | Notice | `code:u8, arg:u8` |

Status 0 means success. Notices include low/critical battery, dropped stream frames, and USB power changes. Query GET_INFO capabilities before assuming all sensors work.

STREAM_START is command opcode `0x10`, STREAM_STOP is `0x11`, and STREAM_GET is `0x12`. START/STOP take a `u16` mask and return the active mask. Stream bit n maps to outer frame type `0x10+n`. Command opcodes and outer frame types are distinct fields.

| Bit | Frame | Stream | Body / data | Default cadence |
|---|---|---|---|---|
| 0 | `0x10` | MOTION | `t_ms:u32, period_ms:u8, count:u8`, then accel/gyro samples | 25 samples/s, batched |
| 1 | `0x11` | EVENT | `t_ms:u32, event:u8, arg:u8`; taps, tilt, free-fall, movement | On events |
| 2 | `0x12` | ACTIVITY | `t_ms:u32, steps_total:u32, cadence_spm:u8, state:u8, motion_mg:u16` | 1/s |
| 3 | `0x13` | AUDIO | `seq:u16, len:u8, opus[len]` | 50 packets/s |
| 4 | `0x14` | BATTERY | `percent:u8, state:u8, millivolts:u16` | Initially, then on changes |
| 5 | `0x15` | TEMP | `t_ms:u32, temp_mc:i32` | Every 5 s |
| 6 | `0x16` | LINK | `t_ms:u32, rssi_dbm:i8, tx_dbm:i8, phy:u8` | 1/s; BLE only |
| 7 | `0x17` | MIC_LEVEL | `t_ms:u32, peak_db:u8, rms_db:u8` | 10/s |
| 8 | `0x18` | MOTION2 | `t_ms:u32, sample_no:u32, period_us:u32, sensors:u8, count:u8`, then samples | Configurable |

Acceleration samples are signed i16 milli-g; gyroscope samples are signed i16 tenths of a degree/second. TEMP is chip temperature, not skin temperature. The band has no GPS, heart-rate sensor, speaker or vibration motor exposed by this contract.

## Why the microphone is off after connection

The current `public/vexo-capture.js` initially requests only:

```js
await band.configure({ battery: true, events: true }); // mask 0x0012
```

The separate recording flow checks consent and the key, opens the speech WebSocket, and then requests:

```js
await band.configure({ audio: true }); // audio bit 3, mask 0x0008
```

Consent and Deepgram readiness are app prerequisites. The firmware itself needs no API key or internet to stream audio locally. The Deepgram authentication-only check deliberately does not start audio. After a completed voice test, the microphone is off because the app stopped it.

## Audio decoding

| Byte offset | Size | Meaning |
|---|---|---|
| 0 | 1 | `0x13` AUDIO frame type |
| 1 | 2 | Unsigned audio sequence, little-endian |
| 3 | 1 | Opus payload length N |
| 4 | N | One complete Opus packet |

Each packet contains **20 ms of 16 kHz mono Opus**, approximately 24 kbit/s: 50 packets per second. Validate the frame and pass only the Opus bytes onward, excluding the Vexo header. It is not raw PCM or an Ogg file. Local playback/WAV output requires an Opus decoder and suitable output conversion. The app passes `a.opus` directly to the official Deepgram helper, which requests `encoding=opus&sample_rate=16000&channels=1`.

Audio sequence numbers restart at 0 on STREAM_START and wrap at 65535. Gaps mean lost packets; a local decoder can apply packet-loss concealment. AUDIO has no timestamp. The contract places the first sound about 140 ms after STREAM_START (about 40 ms if MIC_LEVEL already had the microphone on). Receipt time is not an exact capture timestamp.

MIC_LEVEL reports loudness only, in dB below full scale: 0 is maximum, 96 is silence. It powers the microphone even without AUDIO. Either stream forces the LED solid blue. LED_SET and IDENTIFY are denied while the microphone indicator is on; a failed LED prevents these streams starting.

## Start/stop byte examples

These examples use command sequence values 1 and 2; a real client must manage its counter.

| Operation | Bytes written to RX |
|---|---|
| Start AUDIO, mask `0x0008` | `01 01 10 08 00` |
| Stop AUDIO and MIC_LEVEL, mask `0x0088` | `01 02 11 88 00` |

A successful start response is `02 01 10 00 active_lo active_hi`. The active mask can include streams already running. Prefer the SDK rather than manually writing frames:

```js
await band.configure({ audio: false, micLevel: false });
```

Disconnecting a transport stops its streams. USB and BLE can coexist but can take streams from one another; use one capture client for the demo.

Validation: the band name, initial mask, start/stop bytes and synthetic AUDIO layout were checked against the pinned official JavaScript codec without issuing hardware commands.

## Next checks

Check transcript accuracy against the actual speech, then save a place memory with measured location and test a physical departure/return. The 15-second voice test itself does not require GPS. A local-only packet-count test could separate BLE diagnostics from transcription, but no such additional UI is implemented by this documentation.
