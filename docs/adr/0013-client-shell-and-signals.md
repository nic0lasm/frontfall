# 0013 · Client shell, sessions, signals and globe seams

Status: Proposed · Date: 2026-11-07

## Context

File and line references in this section are to v1.0 (`b898c0a`). Later commits of this series move or remove some of those files.

`apps/client/src/main.ts` is 1,129 lines of module-level variables that decide which screen shows and what the address bar says. `apps/client/src/ui/game-screen.ts` is 1,146 lines. Upstream has begun to split it into `ui/screen/` (`map-scene.ts`, `orders.ts`, `overlays.ts`, `feed-host.ts`, `guide-host.ts`, `preview-host.ts`, `ship-motion.ts`, `game-keys.ts`, and others).

One session class, `LocalSession` (`game/local-session.ts:30`), serves every mode, and `SoloGame` (`game/solo-game.ts:43`) drives the worker. Panels are refreshed by the screen calling each of them on every update. Some modules in `render/` import from `ui/` and `game/` (`render/map-view.ts:3`, `render/minimap.ts:2`, `render/prebaked-ground.ts:1`), against the direction [ADR 0003](0003-renderer-split.md) intends. Switching between the map and the globe rebuilds the renderer and the input.

## Decision

**App shell.** An application state machine decides the screen. The URL is kept in step with it in both directions, including the view (map or globe), so a reload or a shared link returns to the same place. The view is not stored: only an address with `view=` opens the globe. `main.ts` becomes a bootstrap, with its DOM ids unchanged.

**Sessions per mode.** Solo, Online and Replay are each a session with declared capabilities (`canPause`, `canOrder`, `canSetSpeed`, `recordable`, `relayed`, `canHide`, `canReport`, `guided`). `SoloGame` is renamed `GameRunner`. A `canAct()` policy answers from the capabilities, in one place, instead of each handler checking the mode.

**Signals.** `@preact/signals-core` holds the game view. A panel subscribes through `select(signal, pick, equals)`, so it redraws only when what it shows changes. The worker protocol does not change. The bundle size is measured before the library is adopted and the figure goes in the pull request; the client performance budget (`bun run perf:client`) must still pass. Where a step of this work takes the build over it, the commit that adds the weight raises the budget by what it measured, as [performance.md](../performance.md) asks, and says why.

**Layers.** The client is divided into layers with allowed imports, enforced by a test ([ADR 0014](0014-enforced-boundaries.md)). Shared unit marks, used by both the map and the globe, move into `render/`, which removes the edges from `render/` up to `ui/` and `game/`.

**GameScreen split.** `game-screen.ts` is split along upstream's `ui/screen/` modules and names. Nothing is renamed that upstream already named.

**Globe seams.** One WebGL context lives across switches: `MapScene` swaps the kind of renderer and keeps the input. A `Renderer` capabilities object replaces optional hooks. The in-game switch between map and globe takes under 500 ms, measured by a Chromium end-to-end test (M7-07, #66). All of this stays behind the existing `?view=globe` and `globeAllowed` path until the maintainer chooses, because it overlaps v1.1; the only new way in is `?view=map`, the address the page writes once G switched back to the flat map, so that a reload keeps the view.

## Consequences

- A screen is a state with a URL; adding one means adding a state.
- Updates reach only the panels whose data changed, which should lower the work per frame; the budget measures it.
- A new runtime dependency in the client, small but not free, and a new way of writing panels that contributors learn.
- Large, mostly mechanical moves in a client that upstream is changing. The client pull request goes last and is sequenced with the maintainer.
- Session capabilities make a mode's rules visible in one place, at the price of a type to extend when a mode gains a power.

## Alternatives considered

- **A framework (React, Preact components, Lit).** Replaces the vanilla DOM approach that the bundle and the 3D scene were built around. Rejected.
- **A hand-written event emitter.** Less code to adopt, but panels would still need their own change detection. Rejected.
- **Keep one session class with mode flags.** The flags are what the capabilities make explicit. Rejected.
- **Rebuild the renderer on a switch.** Costs the context and several hundred milliseconds. Rejected by the 500 ms target.

## Deviations from the first proposal

- Sessions have no seek capability. Their capabilities are the ones the screen asks for today.

## Deferred

- Anything that changes the worker protocol.
- Changes to the globe itself ([ADR 0005](0005-globe-spike.md)) beyond the seams and the switch.
