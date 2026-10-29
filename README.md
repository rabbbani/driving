# PARKLITE — Lightweight 3D Parking Simulator

**PARKLITE** is a lightweight, fast-loading 3D manual driving and precision parking browser game built with vanilla **HTML5**, **CSS3**, **JavaScript (ES Modules)**, and **Three.js**.

Inspired by clean, smooth web driving games like Drune.io, PARKLITE focuses on approachable manual transmission control, responsive vehicle handling, and structured parking missions while maintaining smooth 60 FPS performance on desktops and mid-range mobile devices.

---

## Features

- **Manual Transmission & Clutch (`P`, `R`, `N`, `1`, `2`, `3`, `4`)**:
  - Distinct gear ratios and speed ranges per gear.
  - Functional clutch bite-point coupling, live **Engine RPM** gauge, **Speedometer (km/h)**, and **Engine Stalling** when releasing the clutch improperly at very low speeds (tall gear launches, zero-throttle dumps, or braking to a standstill in gear without pressing the clutch).
  - Procedural Web Audio engine sound with adjustable volume and zero external audio downloads.
- **5 Playable Parking Missions** (3 Core Driving Tests + 2 Bonus Precision Challenges):
  1. **Forward Bay Park** — Smooth manual launch and alignment into a marked stall.
  2. **Reverse Bay Park** — Reverse cleanly between two parked cars.
  3. **Curbside Parallel Park** — Pull alongside the lead car and reverse S-turn into a street-side slot.
  4. **Narrow Cone Slot** — Navigate traffic cones into a tight precision space without collisions.
  5. **Campus Road & Timed Park** — Drive the loop road checkpoint using higher gears and park before time expires.
- **Three Camera Modes**:
  1. **Chase Camera** — Smooth spring-damped third-person view with subtle reverse visibility elevation.
  2. **Hood Camera** — Mounted ahead of the windshield looking over the hood for tight front clearance.
  3. **Driver's Seat Camera** — First-person cabin view with low-poly dashboard, rotating 3D steering wheel, and live digital gear/speed/RPM display.
- **Desktop & Mobile Multi-Touch Controls**:
  - Interactive visible steering wheel supporting mouse dragging on PC and multi-touch rotation on Android/iOS.
  - Dedicated virtual **Clutch**, **Brake**, **Gas**, **Handbrake**, and **Gear (`P R N 1 2 3 4`)** controls with portrait and landscape responsive layouts.
- **Performance-First Architecture**:
  - Compact driving-academy environment using shared geometries/materials and `THREE.InstancedMesh` for road markings, cones, perimeter posts, and trees.
  - Zero-allocation fixed-timestep (`120 Hz`) 2D OBB Separating Axis Theorem collision detection and smooth sliding wall response.
  - `Low`, `Medium`, and `High` graphics presets, automatic FPS fallback scaler, and automatic pause/render suspension when the browser tab is hidden.

---

## Project Structure

```text
index.html                  # Game HTML structure, HUD, menus, and modals
style.css                   # Responsive desktop & mobile CSS3 interface
js/
  main.js                   # Game loop, Three.js renderer, camera modes & quality scaling
  physics.js                # Vehicle dynamics, manual gearbox/clutch/stall & OBB collisions
  car.js                    # Low-poly player car, 1st-person cockpit & shared parked cars
  environment.js            # Compact driving school lot using instanced geometry
  missions.js               # Mission definitions, 3D bay markers, detection & scoring
  controls.js               # Keyboard, mouse wheel drag & multi-touch mobile controls
  ui.js                     # Menu navigation, settings persistence & dirty-checked HUD
  audio.js                  # Lightweight Web Audio API engine & SFX synthesizer
  vendor/
    three.module.min.js     # Self-contained Three.js r160 ES module (no CDN required)
    three.LICENSE.txt       # Three.js MIT license
```

---

## Running Locally

Because the game uses standard JavaScript ES modules (`<script type="module">`), serve the directory over any local static HTTP server (opening `file://` directly blocks ES module imports in modern browsers).

**Option 1 — Python 3 (built-in):**

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

**Option 2 — Node.js (`npx`):**

```bash
npx serve -l 8080 .
```

**Option 3 — VS Code Live Server:**
Right-click `index.html` and choose **Open with Live Server**.

---

## Deploying as a Static Website

PARKLITE requires **no build step, bundler, backend, or database**. Every dependency (including `three.module.min.js`) is self-contained in the repository.

- **GitHub Pages**: Push the repository to GitHub, open **Settings → Pages**, and deploy directly from the root (`/`) of your branch.
- **Netlify / Cloudflare Pages / Vercel**: Connect the repository (or drag-and-drop the project folder) with **Build command:** *(empty)* and **Publish directory:** `.` (root).
- **Any Static Host (Nginx / S3 / Apache)**: Upload `index.html`, `style.css`, and the `js/` directory as-is.

---

## Controls

### PC (Keyboard & Mouse)
| Action | Control |
| :--- | :--- |
| **Steer** | Drag on-screen Steering Wheel with Mouse, or `A` / `D`, or `←` / `→` |
| **Accelerate** | `W` or `↑` |
| **Brake** | `S` or `↓` |
| **Clutch** | Hold `E` while shifting/stopping (or quick-tap `E` to latch/unlatch; `Shift` also works) |
| **Forward Gears (`1`–`4`)** | `1`, `2`, `3`, `4` |
| **Reverse / Neutral / Park** | `R`, `N`, `P` (or number keys `6`, `0`/`5`, `7`) |
| **Handbrake** | `Space` |
| **Switch Camera** | `C` |
| **Reset Car** | `T` or `Backspace` |
| **Restart Stalled Engine** | `F`, or press Clutch (`E`) + Gas (`W`), or click HUD banner |
| **Pause** | `Esc` |

### Mobile (Android & iOS Touch)
- **Virtual Steering Wheel (Bottom-Left)**: Touch and rotate around the rim to steer.
- **Clutch / Brake / Gas Pedals (Bottom-Right)**: Multi-touch supported; quick-tapping **Clutch** latches it briefly so you can tap a gear button (`P R N 1 2 3 4`) and press **Gas** smoothly with one thumb.
- **HUD Top-Right**: One-tap buttons for **Reset**, **Camera**, and **Pause**.
