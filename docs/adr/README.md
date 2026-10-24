# Architecture decision records

Each record captures one decision that shapes the code: the context, what was decided, and what follows from it. Records are never rewritten once accepted; a later record supersedes an earlier one and both stay.

| Record                                 | Decision                                                  | Status   |
| -------------------------------------- | --------------------------------------------------------- | -------- |
| [0001](0001-deterministic-lockstep.md) | Every client simulates; the server relays orders in turns | Accepted |
| [0002](0002-topology.md)               | All geometry goes through a `Topology`                    | Accepted |
| [0003](0003-renderer-split.md)         | The simulation never depends on rendering                 | Accepted |
| [0004](0004-sub-path-hosting.md)       | The game works unchanged under any path prefix            | Accepted |
| [0005](0005-globe-spike.md)            | The globe ray-traces the same territory layer             | Proposed |

To propose a decision, copy the structure of an existing record into the next number, with status `Proposed`, and open a pull request.
