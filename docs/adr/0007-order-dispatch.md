# 0007 · Order dispatch: validate, plan, execute

Status: Proposed · Date: 2026-11-07

## Context

File and line references in this section are to v1.0 (`b898c0a`). Later commits of this series move or remove some of those files.

An order runs through three places in the engine:

- `orderError` in `packages/engine/src/orders.ts` is a 113-line file built around a `switch` that checks the fields and the phase of every kind.
- `Game.apply` (`packages/engine/src/game.ts:718`) offers a valid order to a list of handlers with `handlers.some(...)` until one carries it out. Each rule registers its handler with `onOrder` (`game.ts:692`).
- Some checks live only in the handler, after validation, so a refused order and an ignored order are different things. Handlers also repeat work the validator did: the patrol search runs twice, and the silo choice (`launchSilo`) and the shore search (`shoreOf`) are repeated.

Nothing checks that every kind of order has a handler. A kind with none is accepted by the validator and silently dropped.

## Decision

Orders are registered by type, one entry per kind:

```ts
defineOrder("attack", {
  phases: PLAY_PHASE,
  validate(game, player, order) {
    // returns a plan, or a refusal
  },
  execute(game, player, plan) {
    // carries it out, no re-checking
  },
});
```

- `validate` returns either a refusal (the string `orderError` returns today) or a plan: the values it had to compute, such as the route, the silo or the shore tile. `execute` takes the plan, so nothing is searched twice.
- `phases` says in which phases of the game the order is allowed (`spawn`, `play`). It gates the six kinds whose phase check came first in their validator: spawn, attack, retreat, embark, build and demolish. The other eleven use `ANY_PHASE` and keep their phase check inside `validate`, after the check of their fields, so that the reason a player is given stays the same (`order-rules.ts`). "Decided" is a status and not a phase: the win rule (`R-WIN-03`) keeps ticks running after a winner is known, and orders still apply.
- The registry is keyed by type. `createGame` asserts that every type in `ORDER_SPEC` ([ADR 0006](0006-contracts-package.md)) has one entry.
- `onApplied` observers stay as they are: nations hear of every carried-out order that way (`R-BOT-20`), and an observer never applies an order itself.
- The change is made without changing any answer. Every refusal string and every outcome stays as it is until the one commit that moves handler-only checks into validation (see below).

## Consequences

- A kind of order is one entry in one file per rule. Dispatch is a lookup, not a scan.
- The double patrol search, the repeated `launchSilo` and the repeated `shoreOf` go away.
- A forgotten registration fails when a game is created, not in play.
- Plans are short-lived objects created per order. Orders are a few per player per second, so the cost is small; the engine perf gate decides.
- The last engine commit moves the checks that only the handler makes (shared border, dead target, sea route, retreat ownership, spawn start) into `validate`. That commit (E11) is labelled a behaviour change and can be dropped on its own. It changes what `orderError` answers for an order the game used to accept and then drop, and `execute` returns `void` (a break for anyone writing rules). It does not change a game: each moved check read the state that `execute` read before changing it, so the hash pin, the state pins and the golden replays are unchanged, and a balance bench of 80 games gives the same final hashes before and after. The one new refusal a player sees is on a spawn click on another player's land or too close to their start (`click.startTaken`, `click.startNear`). The port shore check is already in `warshipError`.

## Alternatives considered

- **Keep the handler chain and add a test that each type is handled.** Leaves the double work and the scan. Rejected.
- **A class per order.** More ceremony for what is a pair of functions. Rejected.
- **Make "decided" a phase.** The win rule keeps ticks running, and orders after a decision still matter for the end screen. A status does not change what is allowed. Rejected.

## Deviations from the first proposal

- The first proposal moved every phase check out of the validators and rebuilt the golden replays. Eleven kinds keep their phase check in `validate`, because moving it would change the refusal string a client shows; the goldens are unchanged.

## Deferred

- Moving the phase check of the eleven `ANY_PHASE` kinds into `phases`, with the refusal strings that change.
- Stored lifecycle states ([ADR 0009](0009-rule-table-and-lifecycles.md) derives them instead).
