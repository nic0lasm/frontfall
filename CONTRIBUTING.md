# Contributing to Frontfall

Thanks for taking the time to help. This page explains how to propose a change and what a pull request needs before it is merged.

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

## Rules of the engine

The simulation runs on every client and must give exactly the same result everywhere.

- Use the seeded `Random` from `@frontfall/engine`, never `Math.random`.
- Never read the clock (`Date.now`, `performance`) in `packages/engine`.
- Prefer integer arithmetic; floating-point results must not decide game state.
- Every engine change comes with tests.

ESLint enforces the first two rules.

## Pull requests

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
2. Keep the change focused; split unrelated work into separate pull requests.
3. Title in [Conventional Commits](https://www.conventionalcommits.org/) form, for example `feat(engine): add troop growth`. CI checks it.
4. Make sure `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` and `pnpm build` pass. CI runs the same commands.
5. Fill in the template, including how you tested the change.

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
