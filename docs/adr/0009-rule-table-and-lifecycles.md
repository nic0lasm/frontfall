# 0009 · Rule table, nations phases and derived lifecycles

Status: Proposed · Date: 2026-11-07

## Context

File and line references in this section are to v1.0 (`b898c0a`). Later commits of this series move or remove some of those files.

`createGame` (`packages/engine/src/create-game.ts:27-41`) installs 15 rules in a hand-ordered list, some of which install nothing when the game does not play with them. The order matters (the rule that reads a value must run after the rule that writes it) and is written down only by the order of the lines.

`installNations` (`packages/engine/src/bots/nations.ts:116`) is a closure in a 1,068-line file with 28 inner functions. The strategy table that bots already use is a good shape for it, but nations sit outside that table.

Several lifecycles are implied by flags and counters rather than named: whether a structure is being built, active or ruined; whether an alliance is requested, running, in its last part or ended; whether a warship is idle, patrolling or sunk.

## Decision

- **An ordered rule table.** `STANDARD_RULES` lists the 15 installs as data: a name and an install function. A rule the game does not play with installs nothing: `installCapitals` checks capital mode and `installLandmarks` checks the map. `createGame` walks the table. The order is the table's order, and a test pins it.
- **Nations as phases.** The code of `installNations` is split into `bots/nations/*.ts` modules, each one phase on the existing strategy table, sharing one `NationContext`. The calls and the random draws stay the same, in the same order, so the hash is identical.
- **Derived lifecycles.** `structureState`, `allianceState` and `warshipState` are functions of the data already stored. They give the states a name, and rules and the client use them instead of re-deriving the conditions. Nothing is stored; state stays in parts ([ADR 0008](0008-rule-state-and-hash.md)).
- **A balance spec.** `BALANCE_SPEC` describes all 110 keys of `Balance` with a range each, and states which keys change the digest only under a rule or a map feature. It guards the values; it does not move any.

## Consequences

- A new rule is one entry in the table with its place stated, not a line in a function.
- Nations can be read and tested a phase at a time. The split is checked by an unchanged hash over the nation games in the golden replays.
- The three derived functions are one more thing to keep equal to the conditions that used to be spread out. Tests compare them against the old conditions over played games before the old code is removed.
- A table is less flexible than code. A rule that needs a custom install still can: the install function is arbitrary code.

## Alternatives considered

- **Declare dependencies between rules and sort them.** More machinery than 15 rules justify, and a wrong sort is a determinism bug. Rejected.
- **Store lifecycle states.** Another field to hash and keep in step with the data. Rejected for now.
- **Leave nations as one closure.** It is the largest single unit of the engine and the hardest to review. Rejected.

## Deviations from the first proposal

- The rule table has no condition column. A rule the game does not play with checks that inside its install function.

## Deferred

- Moving stray tunables into Balance: `DOCTRINE_EFFECTS`, `NATION_WEIGHTS` and `NATION_LEAN`, `OPERATOR_FACTOR`, the `B-NATION-*` constants and the difficulty tables. This changes the balance digest and belongs to the maintainer's balance process.
- Merging the three water searches. They use different algorithms, and the trade search can be resumed.
- Stored lifecycle states.
