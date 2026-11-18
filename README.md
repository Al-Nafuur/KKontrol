# KKontrol

**Open-source, browser-based laser engraver control.**

KKontrol is a static Progressive Web App (PWA). It uses the Web Serial API to talk directly to a USB-to-serial controller. Artwork processing runs locally in the browser; no backend is required.

> Early access / developer preview. The K3/K5 protocol has been tested by the project owner with one KKmoon engraver, but this PWA itself still needs hardware validation. The legacy KKengraver profile is experimental.

## Current features (0.1.0)

- WebSerial connection at 115200 baud, 8N1
- K3/K5 raster protocol profile
- KKengraver legacy protocol profile (experimental)
- Text artwork using system fonts or a locally loaded TTF/OTF/WOFF font
- PNG, JPEG, WebP and BMP image input
- Black/white thresholding and raster preview
- Output dimensions at the documented 500 DPI scale
- Dry-run report download
- Manual relative jog controls
- Offline app shell through a service worker
- No automatic homing

## Browser requirements

WebSerial requires a secure context (HTTPS, or localhost) and a browser that exposes `navigator.serial`. Current desktop Chromium browsers (Chrome / Edge) are the recommended target. Firefox support is release/build dependent and may be experimental; the app detects WebSerial at runtime and shows a warning if it is unavailable.

## Deploy on GitHub Pages

1. Create an empty repository named `kkontrol`.
2. Copy the contents of this directory into the repository root (not the parent directory).
3. Push the default branch (for example `main`).
4. In GitHub, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
6. Open the Pages URL, normally `https://<account>.github.io/kkontrol/`.

The app uses relative paths, so it works from a project-site subdirectory. After first load, the service worker caches the app shell for offline use. A browser must be online for the first visit to GitHub Pages.

## Local development

WebSerial is also allowed on `http://localhost`:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in a supported browser.

## Connecting a device

1. Connect the engraver by USB.
2. Close any other application using its serial port (for example `kkengraver`, a Windows control app, a serial monitor, or another browser tab).
3. Open KKontrol over HTTPS or localhost.
4. Select the protocol profile before connecting.
5. Click **Connect engraver** and choose the USB serial device in the browser dialog.

The port is opened at 115200 baud, 8 data bits, no parity and 1 stop bit. The browser asks the user to grant access; KKontrol does not enumerate arbitrary OS devices outside that chooser. The operating system still needs its USB-to-serial driver (for example, the CH340 driver on your machine).

## Protocol profiles

### K3 / K5

Based on the published K3 serial protocol description and the working test performed with the project owner's K5-compatible machine. The profile sends the documented connection command, disables discrete mode, resets the controller, optionally switches on the fan, starts raster mode at the current head position and transfers non-blank raster rows. A single `0x09` ACK is expected for each command and non-blank raster row. A 100 ms inter-row delay is used as described by the protocol author.

The K3/K5 raster row header contains opcode `0x09`, total row-packet length, depth/on-time, the documented 1000 mW field, and the current raster Y row. Pixels are packed MSB-first; dark pixels are set bits. The 1000 mW field is kept fixed in this version because the protocol source notes that changing it had no visible effect on its hardware.

No homing command is issued. Raster start is relative to the controller's current position with zero offset; the operator must position the head and ensure there is enough travel room.

### KKengraver legacy (experimental)

Based on the public `aquamorta/kkengraver` protocol implementation. It sends the 8-byte connect sequence, expects one `0x09` ACK and deliberately does not wait for the firmware-version bytes (some devices do not return them). The profile uses the 15-byte `0x23` header, `0x22` row records with a checksum, then the documented end records. It expects the normal one-byte `0x09` ACK after each row, as in the original `kkengraver` transport method.

This profile has not been validated on the project owner's hardware and should be treated as experimental.

## Safety

Laser engravers can cause permanent eye injury, fire and harmful fumes. This software is not a safety system and cannot verify the enclosure, interlocks, laser state, material or extraction system.

- Always use suitable laser-rated eye protection and a closed enclosure.
- Use appropriate extraction and fire supervision; never leave the machine unattended.
- Do not engrave PVC, vinyl or unknown materials.
- Keep a physical means of cutting machine power within reach.
- Do not use the software's browser disconnect as an emergency stop.
- The application does not send a home command. The head's absolute position is unknown to the UI; position the head manually and leave adequate mechanical clearance.
- Start with conservative settings on known laser-safe scrap material.

Live output is deliberately gated by an explicit safety checkbox and a confirmation dialog. That is an operator reminder, not a hardware interlock.

## Development checks

Run the packet-construction unit tests with Node.js:

```bash
node --test tests/protocol.test.mjs
```

The tests verify packet construction only. They do not simulate a controller or prove hardware compatibility.

## Protocol references

- RBEGamer, [K3_LASER_ENGRAVER_PROTOCOL](https://github.com/RBEGamer/K3_LASER_ENGRAVER_PROTOCOL) — protocol documentation and source are published under Apache-2.0.
- aquamorta, [kkengraver](https://github.com/aquamorta/kkengraver) — legacy protocol reference; project is GPL-3.0.

KKontrol is an independent browser implementation of the documented packet formats; it does not bundle either upstream project's source code.

## License

KKontrol's original application code is released under the MIT License. See [LICENSE](./LICENSE). Third-party protocol documentation remains the property of its respective authors and is linked above for attribution.
