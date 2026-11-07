import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { checkAddedLine, checkCommit, parseAddedLines, type Violation } from "./provenance.ts";

const usage = "usage: bun run provenance --range <git revision range>";

const { values } = parseArgs({ options: { range: { type: "string" } } });
if (!values.range) {
  console.error(usage);
  process.exit(2);
}

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30 });

const SEPARATOR = "\u001e";
const FIELDS = "\u001f";
const commits = git(
  "log",
  `--format=%H${FIELDS}%an <%ae>${FIELDS}%cn <%ce>${FIELDS}%B${SEPARATOR}`,
  values.range,
)
  .split(SEPARATOR)
  .map((record) => record.replace(/^\n/, ""))
  .filter((record) => record !== "")
  .map((record) => {
    const [sha = "", author = "", committer = "", message = ""] = record.split(FIELDS);
    return { sha, author, committer, message };
  });

const violations: Violation[] = commits.flatMap(checkCommit);
const log = git(
  "log",
  "-p",
  "-U0",
  "--no-color",
  "--no-ext-diff",
  "--text",
  "--format=commit %H",
  values.range,
);
violations.push(...parseAddedLines(log).flatMap(checkAddedLine));

for (const violation of violations) {
  console.error(
    `::error title=Provenance check::${violation.sha} ${violation.where}: ${violation.reason}`,
  );
}
console.log(
  `Provenance check: ${String(commits.length)} commit(s), ${String(violations.length)} problem(s).`,
);
process.exit(violations.length > 0 ? 1 : 0);
