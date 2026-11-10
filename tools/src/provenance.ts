/**
 * Provenance check: who wrote a commit, and what it carries.
 *
 * Every commit of a range must be committed under the project's public address
 * (or by Dependabot, or merged by GitHub) and written by it, or by an outside
 * contributor whose commit the owner integrated, carry no co-author
 * or session trailer, and add no marker of the tooling around it. The
 * patterns are assembled from pieces so that this file passes its own check.
 */

/** Authors and committers a commit may have: the public address, bots, and GitHub's own merges. */
export const ALLOWED_IDENTITIES: readonly RegExp[] = [
  /^.+ <106993577\+nic0lasm@users\.noreply\.github\.com>$/,
  /^dependabot\[bot\] <49699333\+dependabot\[bot\]@users\.noreply\.github\.com>$/,
  /^GitHub <noreply@github\.com>$/,
];

/** Pieces joined at run time: the words must not appear whole in the source. */
const join = (...parts: string[]): RegExp => new RegExp(parts.join(""), "i");

/** Trailers and links a message may not carry. */
const MESSAGE_MARKERS: readonly RegExp[] = [
  join("^co-", "authored-", "by:"),
  join("^", "cla", "ude-", "session:"),
  join("cla", "ude\\.ai/"),
  join("generated with \\[", "cla", "ude"),
];

/** Markers a line added to a file may not hold, wherever the file is. */
const CONTENT_MARKERS: readonly RegExp[] = [
  join("anth", "ropic"),
  join("\\bcla", "ude\\b"),
  join("co-", "authored-", "by"),
  join("\\.cla", "ude/"),
  join("CLA", "UDE\\.md"),
];

/** Words the game keeps out of its code (see tools/test/words.test.ts), checked in source files. */
const GAME_WORDS = join("\\b(nu", "kes?|nu", "clear|hydro", "gen|mi", "rvs?|open", "front\\w*)\\b");
const GAME_ACRONYM = new RegExp(["\\bS", "AMs?\\b"].join(""));
const SOURCE_FILE = /\.(ts|js|mjs|cjs|json|html|css)$/;
/** Files that name what they check for. */
const EXEMPT_FILE =
  /^tools\/(src\/provenance[^/]*|test\/(provenance|words)[^/]*)\.ts$|^pnpm-lock\.yaml$/;

export interface CommitInfo {
  readonly sha: string;
  readonly author: string;
  readonly committer: string;
  readonly message: string;
}

export interface AddedLine {
  readonly sha: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface Violation {
  readonly sha: string;
  readonly where: string;
  readonly reason: string;
}

const allowed = (identity: string): boolean =>
  ALLOWED_IDENTITIES.some((rule) => rule.test(identity));

/** Names of tools and companies an identity may not carry, even as an outside author. */
const TOOL_IDENTITIES: readonly RegExp[] = [join("cla", "ude"), join("anth", "ropic")];

/**
 * An outside contributor keeps the authorship of a commit the owner integrates:
 * any author is accepted when the committer is allowed, unless it names a tool.
 */
const authorAllowed = (author: string, committer: string): boolean =>
  allowed(author) || (allowed(committer) && !TOOL_IDENTITIES.some((rule) => rule.test(author)));

/** The problems of one commit's identities and message. */
export function checkCommit(commit: CommitInfo): Violation[] {
  const found: Violation[] = [];
  const short = commit.sha.slice(0, 7);
  if (!authorAllowed(commit.author, commit.committer)) {
    found.push({ sha: short, where: "author", reason: "identity not allowed" });
  }
  if (!allowed(commit.committer)) {
    found.push({ sha: short, where: "committer", reason: "identity not allowed" });
  }
  for (const [index, line] of commit.message.split("\n").entries()) {
    if (MESSAGE_MARKERS.some((rule) => rule.test(line))) {
      found.push({
        sha: short,
        where: `message line ${String(index + 1)}`,
        reason: "trailer or link not allowed",
      });
    }
  }
  return found;
}

/** The problems of the lines a commit adds. */
export function checkAddedLine(added: AddedLine): Violation[] {
  if (EXEMPT_FILE.test(added.file)) return [];
  const where = `${added.file}:${String(added.line)}`;
  const short = added.sha.slice(0, 7);
  if (CONTENT_MARKERS.some((rule) => rule.test(added.text))) {
    return [{ sha: short, where, reason: "marker not allowed" }];
  }
  if (
    SOURCE_FILE.test(added.file) &&
    (GAME_WORDS.test(added.text) || GAME_ACRONYM.test(added.text))
  ) {
    return [{ sha: short, where, reason: "word kept out of the game" }];
  }
  return [];
}

/** Lines added by `git log -p -U0` output, with the commit and file each belongs to. */
export function parseAddedLines(log: string): AddedLine[] {
  const lines: AddedLine[] = [];
  let sha = "";
  let file = "";
  let line = 0;
  for (const row of log.split("\n")) {
    if (/^commit [0-9a-f]{40}$/.test(row)) sha = row.slice(7);
    else if (row.startsWith("+++ b/")) file = row.slice(6);
    else if (row.startsWith("@@")) line = Number(/\+(\d+)/.exec(row)?.[1] ?? "0");
    else if (row.startsWith("+") && !row.startsWith("+++")) {
      lines.push({ sha, file, line, text: row.slice(1) });
      line += 1;
    }
  }
  return lines;
}
