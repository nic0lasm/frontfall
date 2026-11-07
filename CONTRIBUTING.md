# Contributing to Frontfall

Thanks for taking the time to help. This page explains how to propose a change and what a pull request needs before it is merged.

## Your first contribution

v1.0 is out. Fixes and polish for it are welcome in [v1.0.x](https://github.com/nic0lasm/frontfall/milestones); new features wait for v1.1 (the 3D globe) and v1.x (community maps, replay links, spectators). Propose them in [Discussions](https://github.com/nic0lasm/frontfall/discussions) first.

1. Pick an issue labelled [`good first issue`](https://github.com/nic0lasm/frontfall/labels/good%20first%20issue) or [`help wanted`](https://github.com/nic0lasm/frontfall/labels/help%20wanted).
2. Comment on it to claim it, so nobody else starts the same work.
3. If you get stuck, ask in [Discussions](https://github.com/nic0lasm/frontfall/discussions). No question is too small.
4. Open a draft pull request early. Feedback on a sketch is cheaper than on a finished change.

## Before you start

- **Bugs**: open an issue with the bug form, including steps to reproduce.
- **Ideas and questions**: start in [Discussions](https://github.com/nic0lasm/frontfall/discussions). Agreeing on the idea first saves everyone a rewrite.
- **Larger changes**: comment on the issue to say you are working on it, and share your approach before writing much code.

## Set up

```sh
corepack enable
pnpm install
pnpm dev
```

The repository is a pnpm workspace:

| Path                | Contents                                    |
| ------------------- | ------------------------------------------- |
| `packages/engine`   | Deterministic simulation, no dependencies   |
| `packages/protocol` | Message schemas shared by client and server |
| `apps/server`       | Lobbies, turn relay, static file server     |
| `apps/client`       | Browser client, Three.js rendering          |
| `tools`             | Repository checks, clean-room scan          |
| `e2e`               | Playwright tests of the built game          |

Design documents live in `docs/`: the game rules ([rules.md](docs/rules.md)), their numbers ([balance.md](docs/balance.md)) and the architecture decisions ([adr/](docs/adr/)).

For how the packages fit together and how to add an order, a rule or a screen, read the [architecture guide](docs/architecture.md).

## Clean room

Frontfall is written from scratch. Gameplay work starts from [docs/rules.md](docs/rules.md); do not read other games' source code while working on Frontfall, and copy no code, assets, maps or text from them. Third-party assets must be public domain, CC0 or MIT-compatible, and listed in [CREDITS.md](CREDITS.md). The full policy, and the CI check that enforces it, are in [docs/clean-room.md](docs/clean-room.md).

## Rules of the engine

The simulation runs on every client and must give exactly the same result everywhere.

- Use the seeded `Random` from `@frontfall/engine`, never `Math.random`.
- Never read the clock (`Date`, `performance`) in `packages/engine`.
- Use integer arithmetic for game state. Functions such as `Math.sin` or `Math.pow` can differ in the last bit between browsers and are rejected.
- Neighbours and distances come from the grid, never from index arithmetic: the world wraps east to west.
- Every engine change comes with tests, citing the rule identifiers it implements (`R-ATTACK-03`).

ESLint enforces the first three rules, and the engine compiles without browser or Node types.

## Changing a rule or the balance

Golden replays in `packages/engine/test/replays/` pin the state hash of scripted games every 50 ticks, and the hash covers every balance value. A change that alters how games play out, a rule in `packages/engine` or any value in `balance.ts`, therefore fails the bench tests and the Determinism job with the first tick that differs. When that change is meant:

1. Run `pnpm golden`, which writes the replays again.
2. Update the pinned hash in `packages/engine/test/hash.test.ts` if it changed.
3. Commit the new replay files with the change, and say in the changelog how games change.

A replay that fails after a change not meant to alter games, a refactor or a speed-up, is a bug: find it before regenerating anything.

## Pull requests

1. Branch from `next`, where finished work lands before a release (`main` is what is deployed): `feat/…`, `fix/…`, `docs/…`, `chore/…`.
2. Keep the change focused; split unrelated work into separate pull requests.
3. Title in [Conventional Commits](https://www.conventionalcommits.org/) form, for example `feat(engine): add troop growth`. CI checks it.
4. Make sure `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` and `pnpm build` pass. CI runs the same commands, plus the end-to-end tests (`pnpm build && pnpm test:e2e`, after a one-time `pnpm --filter @frontfall/e2e exec playwright install chromium firefox`; Firefox runs headed, so without a display `--project root --project prefix` runs Chromium alone; CI splits the suite over six runners with `--shard=1/6` to `--shard=6/6`, which work locally too) and the clean-room scan. A pre-commit hook formats and lints the files you stage.
5. Fill in the template. Say how you checked the change, and separate what you **verified** (a test, a measurement, something you saw in game) from what is a **hypothesis** (a reasoned guess you could not confirm). Reviewers rely on that distinction.

Pull requests are squash-merged once CI is green and a maintainer has approved.

## Sign your commits off

Frontfall uses the [Developer Certificate of Origin](https://developercertificate.org/). Add a `Signed-off-by` line to each commit to certify that you wrote the change or have the right to submit it under the MIT license:

```sh
git commit -s -m "fix(client): keep the camera inside the map"
```

## Code style

Prettier formats, ESLint checks. Name things precisely, keep functions small, and write a comment only when it explains something the code cannot: a reason, a constraint, a trade-off.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## How changes reach main

CI and CodeQL run on every pushed branch, and a branch is merged, by squashing a pull request or by fast-forwarding `main`, only once both have passed on it. Force-pushes and deletion of `main` are blocked, and its history stays linear.

When `main` has moved since the branch went green, rebase it. If the rebase is clean, run `pnpm typecheck && pnpm lint && pnpm test` locally; when they pass, the branch can be fast-forwarded without waiting for CI to run again on the rebased commit. Watch the run on `main` after the push and fix it straight away if it fails. A branch that only changes documentation is merged as soon as it is rebased.
