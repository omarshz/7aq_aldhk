# Dubly — Desktop Avatar Companion App

## Context

A floating 3D avatar (VRM format, CC0 from opensourceavatars.com) that lives on your desktop, watches your screen via periodic screenshots, and comments on what you're doing using a local LLM via LM Studio. Must work on Mac + Windows, be lightweight, and respond fast.

**Stack:** Tauri v2 + Three.js + @pixiv/three-vrm + LM Studio (OpenAI-compatible API)

---

## Project Structure

```
dubly/
├── src-tauri/                              # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json                     # Window config (transparent, always-on-top)
│   ├── capabilities/default.json           # Tauri v2 permissions
│   └── src/
│       ├── main.rs
│       ├── lib.rs                          # Builder, command registration
│       ├── commands/
│       │   ├── screenshot.rs               # Screen capture via xcap crate
│       │   └── llm.rs                      # HTTP calls to LM Studio
│       └── utils.rs                        # Base64, image helpers
├── src/                                    # Frontend (vanilla TypeScript + Vite)
│   ├── index.html                          # Transparent shell
│   ├── main.ts                             # Bootstrap, event wiring
│   ├── avatar/
│   │   ├── AvatarManager.ts                # VRM load, Three.js scene, render loop
│   │   ├── AnimationController.ts          # State machine: idle/talking/reacting/moving
│   │   ├── ExpressionController.ts         # Facial expressions, blink, lip sync
│   │   └── MovementController.ts           # Autonomous screen roaming
│   ├── ui/
│   │   ├── SpeechBubble.ts                 # DOM speech bubble with typewriter effect
│   │   ├── SettingsPanel.ts                # Config UI (interval, model, etc.)
│   │   └── styles.css
│   ├── pipeline/
│   │   ├── ScreenshotPipeline.ts           # Orchestrator: capture -> LLM -> display
│   │   ├── LLMClient.ts                    # Wraps Rust invoke calls
│   │   └── ResponseParser.ts              # Extract mood + comment from LLM
│   └── types/
│       ├── llm.ts
│       └── avatar.ts
├── public/models/avatar.vrm               # Default CC0 avatar
├── package.json
├── tsconfig.json
└── vite.config.ts
```

**No framework (React/Vue)** — the app is a transparent canvas + a speech bubble. Three.js owns the rendering. Vite provides HMR.

---

## Implementation Phases

### Phase 0: Scaffolding (Day 1)

- `npm create tauri-app@latest -- --template vanilla-ts`
- Git workflow from `dubly agents.md`: `main` → `dev` → `feature/*` branches, PRs reviewed before merge
- Install deps:
  - **Frontend:** `three`, `@pixiv/three-vrm`, `@tauri-apps/api`
  - **Rust:** `xcap` (screen capture), `image` (resize), `base64`, `reqwest` (HTTP), `serde`, `serde_json`
- Download a default CC0 VRM avatar from opensourceavatars.com → `public/models/avatar.vrm`

### Phase 1: Transparent Always-on-Top Window (Days 2-3) — Dev 1

**The foundation everything else depends on.**

`tauri.conf.json` window config:
```json
{
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "shadow": false,
  "resizable": false,
  "width": 400,
  "height": 500
}
```

CSS: `html, body { background: transparent; }`. Three.js renderer with `alpha: true`, `setClearColor(0x000000, 0)`.

**Click-through:** Use `setIgnoreCursorEvents(true)` by default. On `mousemove`, read canvas pixel alpha — if opaque (avatar), set `false`; if transparent, set `true`. Also check `elementFromPoint` for the speech bubble.

**Dragging:** Call `appWindow.startDragging()` on mousedown over the avatar (raycasting).

### Phase 2: VRM Avatar Rendering (Days 3-5) — Dev 2 *(parallel with Phase 1)*

- `GLTFLoader` + `VRMLoaderPlugin` to load `.vrm` files
- `VRMUtils.removeUnnecessaryVertices/Joints` to optimize
- Render loop: `requestAnimationFrame` → `vrm.update(delta)` → `renderer.render()`

**Animation state machine:**
| State | Behavior |
|-------|----------|
| `idle` | Breathing (spine rotation), periodic blink, random head look |
| `talking` | Cycle mouth expressions (aa/ih/ou/ee/oh), head nods |
| `reacting` | Expression change based on mood, body pose shift |
| `moving` | Lean in movement direction |

**Expression mapping:** LLM mood → VRM expression (`happy`, `surprised`, `sad`, `angry`, `neutral`). Smooth lerp transitions over ~300ms.

### Phase 3: Screenshot Capture (Days 5-7) — Dev 1

Rust command using `xcap` crate:
1. **Hide** avatar window → wait 150ms → **capture** screen → **show** window (prevents recursive self-observation)
2. Resize to 1024x768 (JPEG, ~100-200KB vs 2-4MB at full res)
3. Base64 encode and return to frontend

**macOS:** Requires "Screen Recording" permission — detect denial on startup and show dialog.
**Windows:** No special permission needed.

### Phase 4: LLM Integration (Days 7-9) — Dev 2 *(parallel with Phase 3)*

Rust command: POST to `localhost:1234/v1/chat/completions` with OpenAI-compatible vision payload.

```
System prompt: "You are a small desktop companion. Give a brief, witty
one-sentence comment about what you see on the user's screen.
Format: MOOD: <mood>\nCOMMENT: <comment>"
```

- `max_tokens: 100`, `temperature: 0.8`
- HTTP call in Rust (not frontend) — avoids CSP issues, more robust
- Timeout: 30s. Graceful fallback if LM Studio is offline ("confused" mood + error message)

### Phase 5: Speech Bubble (Days 8-10) — Dev 1

- DOM-based (not Three.js text) — sharp, styleable, accessible
- Positioned above avatar, CSS speech bubble with tail
- **Typewriter effect** at ~30ms/char, synced with talking animation
- Auto-hide after 8 seconds
- `pointer-events: auto` so click-through logic detects it

### Phase 6: Autonomous Movement (Days 10-12) — Dev 2

- Move by changing **Tauri window position** (not Three.js camera)
- Pick random target on screen every 15-45s, lerp toward it at 2px/frame
- Stay in bottom half of screen (avatars look better "standing")
- Clamp to monitor bounds via `currentMonitor()`
- Flip VRM model (rotate Y) when changing direction
- Pause movement during LLM response display

### Phase 7: Pipeline Integration (Days 12-14) — Both Devs

Full flow:
```
Timer (30s default)
  → invoke('capture_screen')  [Rust: hide → xcap → resize → base64 → show]
  → invoke('query_llm')       [Rust: POST to LM Studio]
  → ResponseParser            [Extract mood + comment]
  → ExpressionController      [Set avatar expression]
  → AnimationController       [Transition to 'talking']
  → SpeechBubble              [Typewriter display]
  → After text: 'reacting' 2s → 'idle'
```

Pipeline mutex prevents overlap. Performance budget: ~300ms capture + 2-8s inference + ~10ms display.

### Phase 8: Settings & System Tray (Days 14-16) — Dev 1

System tray menu: Settings, Pause/Resume, Move to Center, Quit.

Settings window (non-transparent, `tauri-plugin-store`):
- Screenshot interval (10-120s)
- LM Studio endpoint URL
- Model name
- Custom VRM file path
- Movement speed/frequency toggle

---

## Task Ownership (from dubly agents.md workflow)

| Phase | Branch | Owner |
|-------|--------|-------|
| 0 - Scaffold | `dev` | Either |
| 1 - Transparent window | `feature/transparent-window` | Dev 1 |
| 2 - VRM avatar | `feature/vrm-avatar` | Dev 2 |
| 3 - Screenshots | `feature/screenshot-capture` | Dev 1 |
| 4 - LLM integration | `feature/llm-integration` | Dev 2 |
| 5 - Speech bubble | `feature/speech-bubble` | Dev 1 |
| 6 - Movement | `feature/avatar-movement` | Dev 2 |
| 7 - Integration | `feature/pipeline-integration` | Both |
| 8 - Settings/tray | `feature/settings-tray` | Dev 1 |

**Conflict zones** (coordinate before editing): `lib.rs`, `tauri.conf.json`, `capabilities/default.json`, `main.ts`, `package.json`

---

## Tauri Plugins & Rust Crates

| Dependency | Purpose |
|---|---|
| `@tauri-apps/api/window` | setIgnoreCursorEvents, setPosition, show/hide, startDragging |
| `tauri-plugin-store` | Persist settings |
| `xcap` (Rust) | Cross-platform screen capture |
| `image` (Rust) | Resize screenshots |
| `reqwest` (Rust) | HTTP client for LM Studio |
| `base64` (Rust) | Encode images |

---

## Verification

1. **Phase 0:** `cargo tauri dev` opens a window with Vite HMR
2. **Phase 1:** Window is transparent, frameless, always-on-top. Clicking empty areas passes through. Avatar area blocks clicks.
3. **Phase 2:** VRM avatar renders on transparent background. Idle animation plays (breathing, blinking).
4. **Phase 3:** `invoke('capture_screen')` returns a base64 JPEG string. Avatar window is not visible in the screenshot.
5. **Phase 4:** With LM Studio running a vision model, `invoke('query_llm')` returns a mood + comment. Graceful error when offline.
6. **Phase 5:** Speech bubble appears with typewriter text, auto-hides after 8s.
7. **Phase 6:** Avatar window moves smoothly across screen, stays in bounds, faces movement direction.
8. **Phase 7:** Full pipeline: screenshot → LLM → expression change + talking animation + speech bubble, every 30s.
9. **Phase 8:** Tray icon works. Settings persist across restarts. Pause/resume toggles pipeline.

**End-to-end test:** Launch app + LM Studio with a 4B vision model → avatar appears → after 30s it comments on your screen → avatar expresses appropriate mood → moves around between comments.
