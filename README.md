# Frogger

A 3D WebXR Frogger (Meta Quest + desktop). Hop across the highway and the river;
don't get squished — or, on later levels, eaten by crocodiles. Day → dusk → night
as you climb; procedural audio; scoring, lives and a high score.

It is authored as a **Games Room module** (`frogger.js` registers itself via
`window.GamesHost.register('frogger', …)`), so the [Games Room](../games-room/)
lobby mounts it into its live scene. It also runs **standalone** here.

## Run standalone

```
# from this folder (frogger/)
python3 -m http.server 8000
# open http://localhost:8000/  and click PLAY FROGGER
```

`index.html` is a ~40-line host shim implementing the same `ctx` contract the
Games Room provides — proof the game never depends on the lobby.

Controls: **arrow keys** (desktop) or the **left thumbstick** (VR) to hop.

## Layout

| File | Role |
|---|---|
| `frogger.js` | the game: AUDIO engine + palettes + `frogger-game` component + module registration |
| `game.json` | metadata (name, description, players, poster, module) read by the lobby |
| `index.html` | standalone host shim |
| `Assets/stereo/` | the stereoscopic poster image pair |

## In the Games Room

`frogger.js` is the same file the lobby loads. On `mount(ctx)` it builds its whole
world under `ctx.root`, drives `ctx.rig` while you play, tints `ctx.ambientLight`/
`ctx.dirLight` for its day/night palette, and on game-over calls `ctx.requestExit()`;
`unmount()` disposes everything (entities, textures, timers, listeners, audio) so
the lobby returns leak-free.
