# Lookie Studio

A 3D shopfront in a sunlit Victorian conservatory. **Creators** upload their designs, turn
them into seamless patterns with the [Arcade](https://platform.arcade.ai) API, put them on
the furniture and textiles in the room, and publish them as real print-on-demand products at
their own link (`/s/<slug>`). **Shoppers** walk the room, click a product, and check out
through Arcade with no account needed.

Live: https://lookie-studio.gloria-f43.workers.dev

```
npm install
npm run dev        # Vite + the Worker (D1, R2, /api) together; ?dev for stats + free camera, ?q=0|1|2 pins a quality tier
npm run build
npx wrangler deploy
npm run assets     # re-run the GLB pipeline after re-exporting from ixi
```

Local dev needs `.dev.vars` with `ARCADE_API_KEY=…` and the local database:
`npx wrangler d1 migrations apply lookie-studio --local`. Production uses
`npx wrangler secret put ARCADE_API_KEY` and `--remote` migrations.

## How it fits together

- **Worker** (`worker/`, Cloudflare Workers + Assets): API described in `CONTRACT.md`. D1
  `lookie-studio` holds creators, sessions, shops, designs, patterns and products; R2
  `lookie-studio` holds uploads and copies of every Arcade image (served from `/files/*`).
  Auth is email + password (PBKDF2), with an HttpOnly session cookie. Arcade jobs (patterns,
  products) are polled lazily when the app asks for them.
- **Modes** (`src/ui/`): `/` landing (Shop or Create), `/studio` creator studio (patterns,
  products per slot, shop link), `/s/:slug` a creator's shop (product card, bag, checkout).
- **Scene** (`src/scene/`): product meshes highlight on hover, click to select and fly the
  camera to a close-up. Patterns are projected triplanar onto the products (the ixi meshes have
  no UVs), crossfading when they change. `src/slots.js` maps each product mesh to its Arcade
  category.
- **State**: `src/state/appStore.js` is shared by the UI and the 3D scene across the Canvas
  boundary.

## Where things come from

| Asset | Source |
|---|---|
| Conservatory room | ixi canvas "Lookie" (`ent_03b47b9ec22f4c6c`), model3d **glass garden** (`model3d-4249taw`), GLB export → `raw/glass-garden.glb` |
| Bedroom room | same canvas, model3d **bedroom scene** (`model3d-1718adt`), GLB export → `raw/bedroom.glb` |
| Trees | [ez-tree](https://github.com/dgreenheck/ez-tree) (MIT), generated in the browser |
| Flowers, grass card, ground textures | ez-tree demo assets (MIT), flowers simplified ~55% |

`npm run assets` (`scripts/optimize-scene.mjs`, per-room settings in `scripts/scenes.config.mjs`)
turns each room's ixi export into a meshopt GLB (garden 10 MB → 2.9 MB, bedroom 13.7 MB → 1.9 MB):
Z-up mm → Y-up m, product meshes tagged with `extras.slot` (see `src/slots.js`, one shop spans
every room), product UVs in metres (+v = print up), baked per-vertex AO (`_ao`), WebP textures.
`node scripts/optimize-scene.mjs bedroom` rebuilds one room.

## Layout

- `src/scene/` – `GlassGarden` (materials by role), `Lighting` (sky → env map, sun, static
  shadows), `Ground` (lawn/path/beds in one shader), `Grass`, `Flowers`, `Trees`, `wind.js`
- `src/tour/` – scroll tour ported from `gloria/merchtailor-3d`: `stops.js` (camera waypoints),
  `tourStore.js`, `ScrollCameraDirector.jsx` (one stop per wheel/swipe/key, eased fly-to),
  `TourNav.jsx` (dots, caption, hint)
- `src/perf/` – quality tiers + `PerformanceMonitor`

## Performance notes

- Shadows render once (and when trees/textures finish loading), not every frame.
- Image-based lighting is the procedural sky rendered once into a 128px cube map: no HDRI download.
- Glass has no transmission pass; it is a thin physical material with environment reflections.
- Grass is chunked instancing with frustum culling and camera-distance thinning. Flowers and
  trees are instanced per variety/species.
- ez-tree, its textures and postprocessing are code-split. Postprocessing (N8AO + vignette)
  only loads on the high tier. Only the bark/leaf textures that are used get downloaded.
- Tiers (`src/perf/quality.js`) scale DPR, shadow map size, grass/flower density and effects;
  drei's `PerformanceMonitor` moves between them.
- The camera rig does no work once a flight has settled.

## Tuning stops

Open `?dev`, press **O** for orbit controls, frame the shot, press **P**, and paste the logged
`pos`/`target` into `src/tour/stops.js`.
