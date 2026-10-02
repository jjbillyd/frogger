# Frogger — Wetland Crossing

A browser/Quest Frogger game inside the existing stereo-photo room. Serve this directory over HTTP, open `index.html`, and select **PLAY FROGGER**. Use arrow keys on desktop or the left controller stick in VR. A-Frame still loads from its existing CDN.

```sh
python3 -m http.server 8765
```

## Wetland art

The five original models in `Assets/models/` were authored and exported in Blender 5.2. The editable workshop is `blender/wetland-assets.blend`. The original unrelated open Blender project was preserved. No external model, generated-image service, or third-party texture is required by these assets.

- **Frog:** 13 bones, 14,152 triangles. Quad rings along the folded hindlegs and forelegs, normalized joint weights, long feet and splayed toes, mottled vertex-colour skin, amber eyes and horizontal pupils. The authored hop has crouch, hindlimb push, extension, forelimb reach, landing and recovery poses. The browser samples that clip over the game's 240 ms hop and adds an in-place 0.58 m visual arc; gameplay still owns the landing position and moving-platform drift.
- **Crocodile:** 11 bones, 19,172 triangles. An elliptical torso continues into a tapered, four-bone tail; weighted sections carry a travelling lateral wave. Raised dorsal scutes, limbs, eyes, snout, teeth and the upper warning jaw are included. The game controls the jaw independently of swimming, preserving the grace period and bite warning.
- **Driftwood:** 1 rigid bone, 2,912 triangles. Irregular bark rings, grain, moss tint and end-grain rings. A single fully weighted root provides gentle flotation and roll without bending solid wood. Length scaling follows each level's collision deck.
- **Vehicles:** rounded car and truck meshes, 4,572 and 8,268 triangles, with separate paint, glass, rubber, metal and light materials. Lane colours and day/night headlamp behaviour remain driven by gameplay.

The shader in `js/wetland.js` replaces the blue river and scrolling white overlay. It combines shallow geometric waves, advected irregular ripple normals, sediment variation, green-brown absorption colour, Fresnel sky approximation and sun highlights. Lane currents follow platform direction and speed; game time pauses the flow consistently. This is a real-time visual approximation, not a fluid solver or scene-reflection/refraction simulation.

Banks use instanced curved grass/reeds and stones. A small generated environment map provides soft material reflections. Desktop receives directional contact shadows; VR disables that extra shadow pass. The existing day/dusk/night cycle is retained. Vehicles immediately around the follow camera fade to keep them from obscuring the frog when the camera passes through a traffic lane. The first start waits for all models, and reports asset failures rather than spawning invisible hazards. Models share cached geometry but have independent skeletons and materials; removal disposes instance resources.

## Research and decisions

1. [Blender: Armature modifier](https://docs.blender.org/manual/en/4.5/modeling/modifiers/deform/armature.html) explains named vertex-group deformation. These assets use explicit, normalized joint weights, with blends across limb/tail junctions rather than relying on automatic bone envelopes.
2. [Blender: Retopology](https://docs.blender.org/manual/en/3.0/modeling/meshes/retopology.html) describes topology simplification. The animals were built with controlled ring topology directly; disconnected overlapping surface islands remain at some anatomical joins and details. They are editable game meshes, not watertight biological reconstructions.
3. [Blender: glTF 2.0 export](https://docs.blender.org/manual/en/2.90/addons/import_export/scene_gltf2.html) documents portable skinning, materials and animation export. The installed 5.2 exporter was inspected directly and used with active-scene/selection filtering to avoid exporting any unrelated scene objects. Procedural colours are stored as vertex colours so they survive the Blender-to-browser handoff.
4. [Nauwelaerts & Aerts, *Take-off and landing forces in jumping frogs*](https://journals.biologists.com/jeb/article/209/1/66/33403/Take-off-and-landing-forces-in-jumping-frogs) informed the hindlimb-driven push and forelimb-first landing sequence. The timing is compressed for arcade play, not fitted to measured biological kinematics.
5. [Fish, *Kinematics of Undulatory Swimming in the American Alligator*](https://www.wcupa.edu/sciences-mathematics/biology/fFish/documents/1984CopeiaKinematics.pdf) describes travelling lateral waves beginning near the pelvis. This informed the phase offset along the crocodile's tail; it is a crocodilian motion reference rather than a species-specific crocodile simulation.
6. [NVIDIA GPU Gems, *Effective Water Simulation from Physical Models*](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models) informed the separation between larger geometric undulations and finer shading ripples. Dense offline fluid caches were avoided for this browser/VR runtime.

## Rebuild and verify

From the repository root, with Blender available:

```sh
blender --background --python blender/build_wetland.py
python3 tests/assets_test.py
```

`build_wetland.py` also runs `build_vehicles.py`, creates a separate scene and writes only its dependencies to the workshop `.blend`. It does not overwrite the project currently open in Blender. For a live Blender Python console:

```python
p = '/absolute/path/to/frogger/blender/build_wetland.py'
exec(compile(open(p).read(), p, 'exec'), {'__file__': p})
```

For browser tests, install Playwright in your development environment, start the local server, then run `node tests/browser.cjs`. Optional variables: `GAME_URL`, `CHROME_PATH` (existing Chrome executable), `AFRAME_PATH` (local copy of the existing A-Frame dependency), and `PREVIEW_PATH` (screenshot destination).

The asset check validates bone counts, normalized weights, joint indices, finite vertices, non-static animations, triangle budgets and isolation from unrelated Blender scenes. Browser checks cover model loading, repeated articulated hops, moving-platform arcs, independent crocodile skeletons, upward jaw opening/reset, current directions, shader/runtime errors and stage resource cleanup. Actual Quest frame rate and comfort require device testing.
