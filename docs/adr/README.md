# Architecture decision records

Each record captures one decision that shapes the code: the context, what was decided, and what follows from it. Records are never rewritten once accepted; a later record supersedes an earlier one and both stay.

| Record                                    | Decision                                                      | Status   |
| ----------------------------------------- | ------------------------------------------------------------- | -------- |
| [0001](0001-deterministic-lockstep.md)    | Every client simulates; the server relays orders in turns     | Accepted |
| [0002](0002-topology.md)                  | All geometry goes through a `Topology`                        | Accepted |
| [0003](0003-renderer-split.md)            | The simulation never depends on rendering                     | Accepted |
| [0004](0004-sub-path-hosting.md)          | The game works unchanged under any path prefix                | Accepted |
| [0005](0005-globe-spike.md)               | The globe ray-traces the same territory layer                 | Accepted |
| [0006](0006-contracts-package.md)         | One order spec in a dependency-free contracts package         | Proposed |
| [0007](0007-order-dispatch.md)            | Orders are registered by type: validate, plan, execute        | Proposed |
| [0008](0008-rule-state-and-hash.md)       | Rules own their state; one codec drives snapshot and hash     | Proposed |
| [0009](0009-rule-table-and-lifecycles.md) | An ordered rule table, nations as phases, derived lifecycles  | Proposed |
| [0010](0010-collection-ownership.md)      | Only the owning module writes a collection                    | Proposed |
| [0013](0013-client-shell-and-signals.md)  | An app shell tied to the URL, sessions per mode, signals      | Proposed |
| [0014](0014-enforced-boundaries.md)       | Layer, cycle and ownership rules are tests on the syntax tree | Proposed |

To propose a decision, copy the structure of an existing record into the next number, with status `Proposed`, and open a pull request.
