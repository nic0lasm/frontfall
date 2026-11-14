import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Every module a package's sources import, as written, with the importing file. */
function imports(packageDir: string): { file: string; specifier: string }[] {
  return sourceFiles(join(root, packageDir, "src")).flatMap((file) =>
    ts
      .preProcessFile(readFileSync(file, "utf8"), true, true)
      .importedFiles.map(({ fileName }) => ({ file, specifier: fileName })),
  );
}

function escapes(file: string, specifier: string, packageDir: string): boolean {
  const target = relative(join(root, packageDir), resolve(dirname(file), specifier));
  return target.startsWith("..") || target.startsWith(sep);
}

/** Imports that leave the package and are not in its allow list of bare modules. */
function violations(packageDir: string, allowed: string[]): string[] {
  return imports(packageDir)
    .filter(({ file, specifier }) =>
      specifier.startsWith(".")
        ? escapes(file, specifier, packageDir)
        : !allowed.includes(specifier),
    )
    .map(({ file, specifier }) => `${relative(root, file)} imports ${specifier}`);
}

describe("package boundaries", () => {
  it("lets the engine depend on the contracts only", () => {
    expect(violations("packages/engine", ["@frontfall/contracts"])).toEqual([]);
    const manifest = JSON.parse(
      readFileSync(join(root, "packages/engine/package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.dependencies).toEqual({ "@frontfall/contracts": "workspace:*" });
  });

  it("lets the protocol depend on zod and the contracts only", () => {
    expect(violations("packages/protocol", ["zod", "zod/mini", "@frontfall/contracts"])).toEqual(
      [],
    );
  });

  it("keeps the contracts free of any dependency", () => {
    expect(violations("packages/contracts", [])).toEqual([]);
    const manifest = JSON.parse(
      readFileSync(join(root, "packages/contracts/package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.dependencies).toBeUndefined();
  });

  it("detects an import that reaches into an app", () => {
    const file = join(root, "packages/engine/src/x.ts");
    expect(escapes(file, "../../../apps/client/src/main.ts", "packages/engine")).toBe(true);
    expect(escapes(file, "./random.ts", "packages/engine")).toBe(false);
  });
});
