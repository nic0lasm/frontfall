# Playtest guide

For people who play Frontfall to help find what tests do not: a confusing screen, a slow device, a game that feels unfair. Five sessions of about 30 minutes are enough to tell a lot. No setup beyond a recent browser.

Playtests run on the preview, [nclsmgr.com/frontfall-next/](https://nclsmgr.com/frontfall-next/), which is the next version before it ships, and on the game itself, [nclsmgr.com/frontfall/](https://nclsmgr.com/frontfall/). Say which one you played.

## Before you start

- Play on the device you normally use, a phone included. Do not read the rules first: how far a new player gets alone is the first thing to learn.
- To measure speed on a phone or a laptop, add `?perf` to the game's address (for example `https://nclsmgr.com/frontfall-next/?perf`): a small report appears that you can copy into your notes.
- Take notes as you go, in your own words: what you tried, what you expected and what happened. A screenshot or a short screen recording beats a long description.

## What to try

Each session has one focus. Do them in any order and stop when you are tired; an unfinished game tells us something too.

| Session | What to do                                                                                                   | What we want to learn                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1       | Play the tutorial from the menu, without help from anyone.                                                   | Where a new player gets stuck, and whether the five minutes teach enough.           |
| 2       | A solo game against bots on a map you pick, at the difficulty you think fits you.                            | Whether the difficulty is right, whether a game feels worth finishing.              |
| 3       | A public game or a private game with friends: join through the lobby, play until the end or until you leave. | Lobby clarity, lag, what happens when someone leaves, whether the end screen helps. |
| 4       | The same on a phone or a tablet, held both ways.                                                             | Whether the controls fit a finger and the screen holds what matters.                |
| 5       | A long game (an hour or more) with ports, trade, alliances and a few structures.                             | Late-game pace, clutter on the map, whether it stays smooth, what you stop doing.   |

Things worth trying in any session: change the language, turn on high contrast or a larger interface size, play with the keyboard, reload the page in the middle of a game, leave a game and come back, and let a game run to its end.

## How to report

- **Something broke or looks wrong:** open a [bug report](https://github.com/nic0lasm/frontfall/issues/new?template=bug.yml) with the steps, your browser and system, and a screenshot. The links on the end screen and in the menu open the same form with the version already filled in.
- **A thought, a feeling, a question:** post it in the playtest thread in [Discussions](https://github.com/nic0lasm/frontfall/discussions). One short message per session is plenty: which session, what you played on, what you liked, what spoilt it, and what you would change first. Ideas can also go to the "Frontfall Ideas" category, which the end screen links to.
- **After a game**, the page asks whether you enjoyed it and, after a thumbs down, what spoilt it most. A tap is enough: the answer carries no name and no free text (see [privacy.md](privacy.md)).

You do not need an account on GitHub to play, but you need one to open a report or post in Discussions. Without one, send your notes to the person who invited you and they will post them.

## The three questions

Whatever the session, answer these three in your message, in a line each:

1. **Did you want to play another game right after?** Yes, maybe or no, and what made you say so.
2. **What was the first moment you did not know what to do, or where you stopped understanding the screen?** A time and a place in the game is enough.
3. **If you could change one thing before v1.0, what would it be?**

Everything else is welcome, but these three are what the summary counts.

## Measuring a playtest

The one figure that matters is how many games are played to the end. The game already counts it, with no name and no cookie (see [privacy.md](privacy.md)): a game is **finished** when it ends on the end screen, won or lost, and **abandoned** when the player goes back to the menu, closes the tab or loses the connection. From the repository:

```sh
bun run playtest-report 2026-11-04   # games counted from this day (UTC) on
bun run playtest-report              # since the server began counting
```

It reads `https://nclsmgr.com/frontfall/api/stats` (set `FRONTFALL_URL` for another server) and prints, per mode, the games played, finished and abandoned, the share finished, the games left within two minutes and the thumbs. Before the v1.0 playtest, with all versions mixed, 28 of 54 games were finished (52 %): 26 of 44 solo games and 1 of 8 private ones. A good result for v1.0 is more than 60 % of solo games finished and no rise in games left within two minutes.

The counters cannot tell testers from other players, so the report is read for the days of the playtest, next to the notes in the thread.

## What happens with it

The maintainer reads every report and summarises the five sessions in the playtest thread: what was seen, how many times, and what was decided. Each point that needs a change becomes an issue, filed in the version it blocks: a problem that stops a player from playing or understanding goes into the next version, the rest is ranked after it. A report with steps to reproduce is fixed faster than one without, and a report from a phone or an older browser is worth more than a fifth report from a fast laptop.

Thank you for playing.
