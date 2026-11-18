# 0014 · Boundaries enforced by tests on the syntax tree

Status: Proposed · Date: 2026-11-07

## Context

File and line references in this section are to v1.0 (`b898c0a`). Later commits of this series move or remove some of those files.

`tools/test/boundaries.test.ts` already reads every source file of a package with the TypeScript compiler's `preProcessFile` and fails when a file imports something outside an allow list (the engine imports nothing, the protocol imports zod only). It checks packages, not the layers inside them, and it reads import statements only. Today the client has edges that go against [ADR 0003](0003-renderer-split.md) (`render/map-view.ts:3` imports `ui/probe.ts`), nothing checks for import cycles, and nothing says who may write to an engine collection ([ADR 0010](0010-collection-ownership.md)).

## Decision

Extend that test, keeping its approach, to state each rule as data and check it on the syntax tree.

- **Engine** imports `@frontfall/contracts` and nothing else.
- **Protocol** imports `zod` and `@frontfall/contracts`.
- **Server** imports the protocol, `zod`, `nodemailer` and `node:*`.
- **Client** follows a layer table:
  - `app/` may import anything.
  - `ui/`, including `ui/screen/`, imports game, render, input, audio, achievements, stats, net (types only) and the root files.
  - `game/` and `net/` import the root files.
  - `render/` imports the root files (palette, compat).
  - `input/` imports render (types).
  - `audio/`, `achievements/` and `stats/` import game (types) and the root files.
  - Every file directly in `src/` is a root file (`build`, `compat`, `dom`, `maps`, `palette`, `probe`, `release`, `signals`, `storage`, `terrain`, `usage`, `webgl-support`) and imports root files and `i18n` only. `i18n/` is a layer of its own, importing root files, and every layer may import it. `main.ts` belongs to `app/`.
- **No runtime cycles** between modules. A cycle through `import type` only is allowed.
- **Owner-only access:** each list of `GameLists` names its owner modules. A call of `writable(game, "list")` is allowed only in an owner of that list, and an entity type of a list may be named outside its owners only as `Readonly<T>`, never bare or in a cast. Four files write every list: the snapshot loader (`state/layout.ts`), the record codecs it reads entities with (`state/codec.ts`, `state/records.ts`) and the file that hands out the lists (`state/lists.ts`).

A rule that fails names the file, the line and the rule. The exceptions found today are fixed by moving shared types, not by allow-listing them.

## Consequences

- Layer rules become a failing test and not a review comment.
- The test depends on the compiler API, as it already does. Type-only imports need to be told apart from runtime ones, which the syntax tree gives.
- A new top-level folder in the client needs a line in the table. This is a feature: the placement of a new folder is a decision.
- Dynamic `import()` and `require` with a computed argument cannot be followed. The code uses none; the test fails on one so that it cannot slip in.
- Owner-only access is checked by name, so a renamed collection needs the table updated.

## Alternatives considered

- **ESLint `no-restricted-imports` rules.** Works for simple lists. Cycles and owner-only writes need whole-program knowledge. A mix of both is harder to read than one test.
- **A dependency-graph tool (such as dependency-cruiser).** A new dependency for something the existing test does with the compiler already installed. Rejected.
- **Separate packages for each client layer.** The strongest boundary, with far more configuration, for a single app. Rejected.

## Deferred

- Boundaries for `tools`, `bench` and `e2e`.
