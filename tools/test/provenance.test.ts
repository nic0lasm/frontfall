import { describe, expect, it } from "vitest";
import { checkAddedLine, checkCommit, parseAddedLines } from "../src/provenance.ts";

const OWNER = "Nicolas Maigre <106993577+nic0lasm@users.noreply.github.com>";
const commit = (over: Partial<Parameters<typeof checkCommit>[0]> = {}) => ({
  sha: "a".repeat(40),
  author: OWNER,
  committer: OWNER,
  message:
    "fix(x): y\n\nSigned-off-by: Nicolas Maigre <106993577+nic0lasm@users.noreply.github.com>\n",
  ...over,
});
/** Built here from pieces: this file must pass the check it tests. */
const trailer = ["Co-", "Authored-", "By: X <x@example.org>"].join("");
const session = ["Cla", "ude-Session: https://example.org/s"].join("");
const tool = ["Cla", "ude"].join("");
const company = ["Anthr", "opic"].join("");
const game = ["Open", "Front"].join("");

describe("provenance check", () => {
  it("accepts the public address, bots and GitHub's merges", () => {
    expect(checkCommit(commit())).toEqual([]);
    expect(
      checkCommit(
        commit({
          author: "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>",
          committer: "GitHub <noreply@github.com>",
        }),
      ),
    ).toEqual([]);
  });

  it("refuses another author or committer", () => {
    const found = checkCommit(
      commit({ author: "A <a@example.org>", committer: `${tool} <n@example.org>` }),
    );
    expect(found.map((v) => v.where)).toEqual(["author", "committer"]);
  });

  it("refuses co-author and session trailers", () => {
    const found = checkCommit(commit({ message: `fix\n\n${trailer}\n${session}\n` }));
    expect(found).toHaveLength(2);
  });

  it("refuses markers and kept-out words in added lines", () => {
    const line = (file: string, text: string) =>
      checkAddedLine({ sha: "b".repeat(40), file, line: 3, text });
    expect(line("README.md", `by ${company}`)).toHaveLength(1);
    expect(line("a.ts", `// ${tool} wrote this`)).toHaveLength(1);
    expect(line("a.ts", `const x = "${game}";`)).toHaveLength(1);
    expect(line("README.md", `inspired by ${game}`)).toEqual([]);
    expect(line("a.ts", "const names = ['Sam'];")).toEqual([]);
  });

  it("does not read the lock files, only at the root", () => {
    const line = (file: string, text: string) =>
      checkAddedLine({ sha: "b".repeat(40), file, line: 3, text });
    const name = `${company.toLowerCase()}-x`;
    expect(line("bun.lock", `"${name}": ["a"]`)).toEqual([]);
    expect(line("pnpm-lock.yaml", `${name}:`)).toEqual([]);
    expect(line("bun.lockb", name)).toHaveLength(1);
    expect(line("sub/bun.lock", name)).toHaveLength(1);
  });

  it("reads added lines with their file and number", () => {
    const log = [
      `commit ${"c".repeat(40)}`,
      "",
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,0 +10,2 @@",
      "+one",
      "+two",
    ].join("\n");
    expect(parseAddedLines(log).map((l) => `${l.file}:${String(l.line)}:${l.text}`)).toEqual([
      "f.ts:10:one",
      "f.ts:11:two",
    ]);
  });
});
