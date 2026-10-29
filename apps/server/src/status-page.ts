/** What /api/status and /status tell anyone who asks. */
export interface ServerStatus {
  version: string;
  release: string;
  /** Simulation build: pages of another one are asked to reload. */
  simulation: string;
  /** Whether the games running at a restart are kept for the next run (`FRONTFALL_DATA`). */
  keepsGames: boolean;
  state: "ok" | "stopping";
  /** Players seated in a game, lobbies included, with an open connection. */
  players: number;
  /** Games started, with a player still connected. */
  running: number;
  lobbies: number;
  /** Time before an announced restart, if any. */
  restartInMs: number | null;
  /** When this run of the server began, as an ISO time; it changes with every restart. */
  startedAt: string;
}

/** A page for people, in both languages of the game. Plain HTML: the site's policy forbids inline styles. */
export function statusPage(status: ServerStatus, sections = ""): string {
  const restart =
    status.restartInMs === null
      ? "none planned / aucun prévu"
      : `in ${String(Math.ceil(status.restartInMs / 60_000))} min / dans ${String(Math.ceil(status.restartInMs / 60_000))} min`;
  const rows: [string, string][] = [
    ["Server / Serveur", status.state === "ok" ? "up / en ligne" : "restarting / redémarre"],
    ["Players online / Joueurs en ligne", String(status.players)],
    ["Games running / Parties en cours", String(status.running)],
    ["Lobbies / Salons", String(status.lobbies)],
    ["Restart / Redémarrage", restart],
    ["Release / Version", status.release],
    ["Build", status.version],
  ];
  const escape = (text: string) =>
    text.replace(/[&<>"]/g, (char) => `&#${String(char.charCodeAt(0))};`);
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frontfall status</title>
<body>
<h1>Frontfall</h1>
<table>
${rows.map(([name, value]) => `<tr><th align="left">${escape(name)}</th><td>${escape(value)}</td></tr>`).join("\n")}
</table>
${sections}
<p><a href="./">Play / Jouer</a></p>
</body>
</html>
`;
}
