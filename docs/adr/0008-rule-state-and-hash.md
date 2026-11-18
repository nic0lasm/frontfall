# 0008 · Rule-owned state, record codecs and a regular hash

Status: Proposed · Date: 2026-11-07

## Context

File and line references in this section are to v1.0 (`b898c0a`). Later commits of this series move or remove some of those files.

`Game` has 47 fields and 905 lines (`packages/engine/src/game.ts`). Rules put their own state on it and on `Player`: `workShare` (`game.ts:173`), `doctrine` (`game.ts:184`), the capital tile, and more. Every rule added in v1.0 widened `Game` or `Player`.

`Game.hash()` (`game.ts:436`) is about 180 inlined lines. Many carry a comment of the form "a rule that is off hashes as before", because the hash of a game without a rule had to stay the same when the rule was added. The order of mixing is the order history left, not an order anyone chose. The snapshot is written and read by two hand-written functions (`packages/engine/src/snapshot.ts`, with `SNAPSHOT_FORMAT` = 5 at line 9, and range checks in `snapshot-bytes.ts`). A new field must be added to the hash, the writer and the reader, and a test only notices if it is exercised.

## Decision

State that belongs to one rule moves out of `Game` and `Player` into parts owned by that rule.

- A part is a typed array of one rule's values. Work share, doctrine and capital are indexed by player id (`PlayerValues`). Pressure, truces and the end of an embargo are indexed by the entry's place in its list (`SlotValues`), because alliances and embargoes have no ids and attack ids grow without bound, and the list's owner keeps the part in step when entries move. Capital falls are a list of records of their own. They are dense typed arrays rather than `Map`s; the engine perf gate decides.
- A new rule never adds a field to `Game` or to an entity.
- Each part has a record codec: one description of its fields from which the snapshot writer, the snapshot reader, the range checks and the hash all run. A field is written once.
- The hash becomes regular: one order driven by the codecs (snapshot order, every list length, full paths). A part is mixed only when its rule is on, so a game without a rule hashes without it. The one value the snapshot carries and the hash leaves out is the fallout map: above the tick it follows from the fallout zones and the terrain, which are hashed, and a pass over every tile of World would cost as much as the owners.

The change is proved by a canonical state dump. Before the migration, a pinned dump of a set of games is recorded in a form independent of the hash and of the snapshot layout. The dump must be identical after the change. If it is, the game is the same and only the hash moved.

- `SNAPSHOT_FORMAT` goes from 5 to 6 with the parts migration, and `DESYNC_REPORT_VERSION` from 2 to 3: a desync report names its release and protocol but not the simulation build, so only its version tells a reader that its hashes are of the old kind.
- The hash changes. Golden replays and the hash pin are rebuilt in that one commit, which is the only one that rebuilds them for this reason. `PROTOCOL_VERSION` stays 29.
- A mutation-based test changes each field and checks that the hash or the dump notices, with an exemption table that documents today's quirks.

## Consequences

- Adding a rule's state touches the rule and its codec. `Game` stops growing.
- One description per field replaces three hand-written places, and "forgot to hash it" becomes a failing test.
- Saved snapshots of format 5 no longer load, and old and new clients disagree on hashes. The release that carries it says so, and the maintainer decides when.
- Rules read their state through the part, one indirection more than a field. Typed arrays offset it where it counts.
- The state dump is a second pin to keep up. It is cheap, and it is the only evidence that a hash change is not a game change.

## Alternatives considered

- **Keep the fields and only tidy the hash.** The next rule still widens `Game`. Rejected.
- **Hash the snapshot bytes.** Simple, but a pure layout change would move the hash, and the hash of a game without a rule would depend on bytes it does not use. Rejected.
- **Keep "off hashes as before" gates for ever.** The reason for them is history. The one-time move to a regular hash costs a rebuild of the goldens and frees every later change. Accepted cost.
- **Maps for every part.** Easier to write, but slower in iteration and allocation on the per-tick path. Rejected for hot parts.

## Deviations from the first proposal

- Parts are not all keyed by entity id: attacks, alliances and embargoes have none, so pressure, truces and embargo ends are keyed by the entry's place in its list.

## Deferred

- Parts for state that is not owned by one rule (the territory, the random state).
