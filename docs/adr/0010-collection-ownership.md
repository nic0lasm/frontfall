# 0010 · Collection ownership

Status: Proposed · Date: 2026-11-07

## Context

`Game` exposes its collections (attacks, boats, warships, missiles, trade ships and others) as plain arrays. Any rule may push to or splice them. A rule that sinks a boat, recalls an attack or starts a reload does it by editing another module's array. Nothing says who may write, so a change to a collection needs a search through every rule.

Players are different: `Player` is a ledger of gold, troops and counts that many rules legitimately update.

## Decision

- Collections are public to read as `readonly Readonly<T>[]`.
- Only the owning module, and the snapshot loader, get a writable view. Other rules change a collection through functions the owner exports. The cases found today are `recallAttacks` (`attack-recall.ts`, a second owner of the attacks list), `sinkBoat`, `takeTradeShip` and `startReload`. Three more moves cross rules but change the `Player` ledger, not a collection, and each has a name in the rule that makes it: `handOverCapital`, `killTroops` (a missile's blast) and `passOnGold` (an eliminated player's).
- `Player` stays a shared ledger. This is stated in the code and in `docs/engine.md`.
- A test on the TypeScript AST checks that only owner modules write to their collections ([ADR 0014](0014-enforced-boundaries.md)). The compiler checks the rest through `readonly`.

## Consequences

- The question "who changes this list" has a one-file answer.
- Behaviour stays the same: each owner function does what the inline edit did, in the same order, which the hash and goldens verify.
- Some rules gain a call where they had a one-line edit, and the owner module gains an export per cross-rule action. The list above is the whole list, and a new entry is a visible choice in review.
- `readonly` is a type-level promise. A cast can break it, which the AST test is there to find.

## Alternatives considered

- **Classes with private fields.** Heavier than the case needs, and slower on hot paths. Rejected.
- **Events instead of calls.** The order of delivery becomes part of the determinism contract. Rejected.
- **Make `Player` owned too.** Gold and troops are touched by growth, trade, gifts, attacks and more. Forcing every change through one module would only move the sprawl. Rejected.

## Deviations from the first proposal

- Three of the moves first listed as owner functions (a capital handed over, troops killed by a missile, gold passed on) change the `Player` ledger, not a collection, and stay named moves in their rules. `recallAttacks` lives in its own file and is a second owner of the attacks list.

## Deferred

- Ownership of the territory layer's own arrays, which already have a narrow interface.
