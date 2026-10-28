# What the game records

Frontfall counts how it is played, to know which maps and modes people use, where they give up and what breaks. It does this without knowing who plays. This page lists everything the game sends, in full. The short version for players is in the README.

## Nothing that points to you

- No account unless you ask for one, no cookie unless you sign in, no advertising service: the game's reports go to the game's own server and nowhere else. The public server at nclsmgr.com sits behind Cloudflare, whose Web Analytics counts page views without cookies; that is the site's, not the game's, and a self-hosted server has none of it.
- No player name, no address, no identifier that outlives a game. The page draws a random number for each game, only so that the same game is not counted twice; it is never stored in the browser.
- The server reads each report, adds one to a few counters, and forgets the report. Only the counters are kept: how many games were played on a phone yesterday, not who played them.
- Your network address is held in memory for a few minutes to limit how often one address can report, and is never written down. The server's logs follow the rules in [server.md](server.md#logs).
- A browser set to **Do Not Track** or **Global Privacy Control** sends nothing at all.

## What stays on your device

The game keeps a few things in your browser, for you and nobody else. None of it is ever sent to the server, and none of it is in the reports below.

- **Your setup:** the name you typed, the last map, bots, difficulty, mode and whether nations play, so the menu starts where you left it. The language you picked is kept the same way.
- **Your profile:** the colour you want in solo games, and the last ten games you finished (map, mode, how it ended, minutes played and the day). The menu's **Your profile** panel shows them, and **Forget my profile and achievements** erases the profile, your setup with your name, your achievements and any game in progress from the device. Clearing the site's data in the browser does the same.
- **Your achievements:** which you have earned and the counts behind them, kept the same way, and with your account too if you sign in ([below](#if-you-sign-in)).
- **Your seat in an online game,** and a snapshot of it, so that a reload brings you back; both are dropped when you leave the game.

## If you sign in

Signing in is optional; it keeps your name and your achievements for you. You can sign in with Discord or Google, or with a link sent to your email address.

With Discord or Google, the game asks Discord only who you are (`identify`), and Google only your profile (`openid profile`), once, at sign-in. With email, the server sends one message to the address you type, with a link that works once and for 15 minutes; the address is used for that message only and then forgotten. Of all this, the server keeps:

- the name you play under, which starts as your first name or display name at the service, or the name in the menu when you sign in by email, and which you can change;
- your id at that service, or your email address, scrambled with a random key kept on the server (HMAC-SHA256), so that it finds your account next time but the file alone does not say who you are;
- how you signed in, and the day the account was made and last used;
- your achievements and the counts behind them, once you are signed in, so that they follow you to another device.

No email address in clear, no picture, no friends list, and the service's token is forgotten at once. The email address is not written in the server's logs either, and the link's code is kept only as a hash, in memory, until it is used or expires. The message goes out through the mailbox of the server's operator (for nclsmgr.com, a mailbox at OVH, in the European Union), which handles it as any email it sends. A cookie, `frontfall_session`, keeps you signed in for 30 days; it holds your account number and is used for nothing else. Sign out ends it on every device where you signed in. **Delete my account**, under your name in the menu, erases the account and its achievements from the server at once, and your name becomes free again; **Forget my profile and achievements** only erases them from the device, and signing in again brings the account's back. Your games and reports are never linked to your account: the reports below stay as anonymous as a guest's.

## Reports

A page sends three kinds of report to `POST /api/usage`, as JSON of at most 1 kB. The server accepts the exact fields below and refuses anything else.

**A game**, once per game played, when it ends for you: on the end screen, when you go back to the menu, or when you close the tab.

| Field        | Values                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release`    | Version of the game, such as `0.5.0`                                                                                                                                                                                                      |
| `game`       | Random number of the game, used only to count it once                                                                                                                                                                                     |
| `mode`       | `solo`, `public` or `private`                                                                                                                                                                                                             |
| `map`        | The map's id, or `generated`                                                                                                                                                                                                              |
| `teams`      | `0` (everyone for themselves), `2`, `3` or `4`                                                                                                                                                                                            |
| `nations`    | Whether the map's nations played                                                                                                                                                                                                          |
| `bots`       | Number of bots, counted in ranges: 0, 1–5, 6–20, 21–50, 51+                                                                                                                                                                               |
| `humans`     | Number of human players, in ranges: 1, 2, 3–4, 5–8, 9+                                                                                                                                                                                    |
| `difficulty` | `easy`, `normal` or `hard`                                                                                                                                                                                                                |
| `disabled`   | Structures the game left out ([R-MODE-03](rules.md))                                                                                                                                                                                      |
| `rules`      | Special rules the game was played with, such as capital mode ([R-MODE-08](rules.md))                                                                                                                                                      |
| `minutes`    | Time you played, in ranges: under 2, 2–5, 5–10, 10–20, 20–40, 40+                                                                                                                                                                         |
| `outcome`    | `victory`; `defeat`, the game was lost or you were wiped out; `left`, you went back to the menu while still in the game; `closed`, the tab was closed; `disconnected`, an online game was lost to the connection or stopped by the server |
| `firstOrder` | Seconds before your first order once play began, counted in ranges: under 10, 10–30, 30–60, 60–120, 120+; left out if you gave none                                                                                                       |
| `device`     | `phone`, `tablet` or `desktop`, from the size of the screen and the kind of pointer                                                                                                                                                       |
| `touch`      | Whether the screen is a touch screen                                                                                                                                                                                                      |
| `lang`       | Language of the game, `en` or `fr`                                                                                                                                                                                                        |
| `view`       | `flat` map or `globe`                                                                                                                                                                                                                     |

**An error**, at most five per visit: an error the game did not catch (`exception`, `rejection`), the simulation failing (`worker`), no WebGL 2 (`webgl`), the graphics context lost (`context_lost`), or a game out of step with the other players (`desync`). An error from the game's own code may come with its message, cut to 120 characters, with web addresses, file paths, anything in quotes and every number taken out, first by the page and again by the server. The message is not counted or stored: it is written once to the server's log, at most 60 times an hour, so that a developer can find the bug.

**A vote**, if you give one on the end screen: thumbs `up` or `down`, the game's `mode` and `outcome`, and, after a thumbs down, one reason if you pick it: `too_hard`, `too_long`, `unclear` (you did not know what to do) or `slow_or_buggy`. There is no free text. One vote per game.

## Reporting a player

The player menu of an online game has **Report this player**, with four reasons to pick from: insults or harassment, an offensive name, cheating, something else. There is no text to type. The server keeps the report for 30 days for its operator to read, and shows it to nobody else; the player reported is not told. A report holds its time, the game, the reason, the number and the name the reported player played under, and for both players a reference drawn from their network address with a secret key that never leaves the server. The address itself is not written down. The operator can ban a network by its address or by such a reference, to keep someone who abuses others away from the server; the details are in [server.md](server.md#reports-and-bans).

## What is published

`GET /api/stats` returns the counters as JSON, for every day of the last 90 days (UTC) and in total, for anyone to read or export:

```json
{
  "release": "0.5.0",
  "since": "2026-10-25",
  "total": { "games": { "solo": 120, "public": 40 }, "device": { "phone": 52, "desktop": 108 } },
  "days": [{ "day": "2026-10-25", "counts": { "games": { "solo": 12 } } }]
}
```

Each counter is one dimension, such as `games` by mode or `map` by map, never a combination that could narrow down to one player. The same totals are in `/metrics` as `frontfall_usage_total{dimension, value}`. With `FRONTFALL_DATA` set, the server keeps the counters in `usage/usage.json` under that directory, readable by its own user only, so that they survive a restart.

## Ideas and bugs

The end screen and the menu link to GitHub: **Share an idea** opens the [Frontfall Ideas](https://github.com/nic0lasm/frontfall/discussions) discussions, **Report a bug** the bug form with the game's version filled in. Both need a GitHub account and are public; nothing is sent until you post.
