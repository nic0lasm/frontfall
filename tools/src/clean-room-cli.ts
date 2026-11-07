import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_OPTIONS, indexReference, scan, type Finding } from "./clean-room.ts";

const usage = "usage: bun run clean-room --reference <dir> [--base <git ref>] [--min-tokens <n>]";

const { values } = parseArgs({
  options: {
    reference: { type: "string" },
    base: { type: "string" },
    "min-tokens": { type: "string" },
  },
});
if (!values.reference) {
  console.error(usage);
  process.exit(2);
}

const options = {
  ...DEFAULT_OPTIONS,
  minTokens: Number(values["min-tokens"] ?? DEFAULT_OPTIONS.minTokens),
};
if (!Number.isInteger(options.minTokens) || options.minTokens < 10) {
  console.error(`--min-tokens must be an integer of at least 10\n${usage}`);
  process.exit(2);
}

const git = (...args: string[]): string[] =>
  execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);

// With a base, only the files a pull request adds or changes; otherwise the whole repository.
const files = (
  values.base
    ? git("diff", "--name-only", "--diff-filter=d", `${values.base}...HEAD`)
    : git("ls-files")
).filter((file) => existsSync(file));

const reference = indexReference(values.reference, options);
const findings = scan(files, reference, options);

function describe(finding: Finding): string {
  const file = relative(process.cwd(), finding.file);
  if (finding.kind === "file") {
    return `::error file=${file}::${file} is identical to a file of the reference codebase`;
  }
  return (
    `::error file=${file},line=${String(finding.startLine)},endLine=${String(finding.endLine)}::` +
    `lines ${String(finding.startLine)}-${String(finding.endLine)} match the reference codebase ` +
    `(${String(finding.tokens)} tokens)`
  );
}

for (const finding of findings) console.log(describe(finding));
console.log(
  `Clean-room scan: ${String(files.length)} files checked, ${String(findings.length)} matches ` +
    `(${String(reference.windows.size)} reference fingerprints, threshold ${String(options.minTokens)} tokens).`,
);
process.exitCode = findings.length > 0 ? 1 : 0;
