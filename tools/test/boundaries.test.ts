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

/** Whether an allow list names a module: exactly, or by a prefix ending in `*` such as `node:*`. */
function allows(allowed: string[], specifier: string): boolean {
  return allowed.some((entry) =>
    entry.endsWith("*") ? specifier.startsWith(entry.slice(0, -1)) : entry === specifier,
  );
}

/** Imports that leave the package and are not in its allow list of bare modules. */
function violations(packageDir: string, allowed: string[]): string[] {
  return imports(packageDir)
    .filter(({ file, specifier }) =>
      specifier.startsWith(".")
        ? escapes(file, specifier, packageDir)
        : !allows(allowed, specifier),
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
    expect(violations("packages/protocol", ["zod", "@frontfall/contracts"])).toEqual([]);
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

/**
 * The modules a source file needs at run time, as written: `import type`,
 * imports of types only and `export type` are left out, since they are
 * erased and cannot make a cycle when the code runs.
 */
function runtimeSpecifiers(source: string): string[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, false);
  const found: string[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const typesOnly =
        clause !== undefined &&
        (clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
          (clause.name === undefined &&
            bindings !== undefined &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly)));
      if (!typesOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
        found.push(statement.moduleSpecifier.text);
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const clause = statement.exportClause;
      const typesOnly =
        statement.isTypeOnly ||
        (clause !== undefined &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((element) => element.isTypeOnly));
      if (!typesOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
        found.push(statement.moduleSpecifier.text);
      }
    }
  }
  return found;
}

/** Each source file of a package, with the files of the same package it imports at run time. */
function runtimeGraph(packageDir: string): Map<string, string[]> {
  const files = sourceFiles(join(root, packageDir, "src"));
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const targets = runtimeSpecifiers(readFileSync(file, "utf8"))
      .filter((specifier) => specifier.startsWith("."))
      .map((specifier) => resolve(dirname(file), specifier))
      .filter((target) => known.has(target));
    graph.set(
      relative(root, file),
      [...new Set(targets)].map((target) => relative(root, target)),
    );
  }
  return graph;
}

/** Every import cycle of a graph, once each, as the files along it from its first file in sort order. */
function cycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const found = new Map<string, string[]>();
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const visit = (file: string): void => {
    state.set(file, "open");
    path.push(file);
    for (const next of graph.get(file) ?? []) {
      if (state.get(next) === "open") {
        const cycle = path.slice(path.indexOf(next));
        const first = cycle.indexOf([...cycle].sort()[0] as string);
        const rotated = [...cycle.slice(first), ...cycle.slice(0, first)];
        found.set(rotated.join(" -> "), rotated);
      } else if (state.get(next) === undefined) {
        visit(next);
      }
    }
    path.pop();
    state.set(file, "done");
  };
  for (const file of [...graph.keys()].sort()) if (state.get(file) === undefined) visit(file);
  return [...found.values()];
}

/** The workspaces whose sources the cycle rule covers. */
const WORKSPACES = ["packages", "apps"].flatMap((group) =>
  readdirSync(join(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${group}/${entry.name}`),
);

describe("package rules (ADR 0014)", () => {
  it("lets the server use the protocol, zod, its mail module and the runtime only", () => {
    expect(
      violations("apps/server", [
        "@frontfall/protocol",
        "zod",
        "nodemailer",
        "bun",
        "node:*",
        "bun:*",
      ]),
    ).toEqual([]);
  });

  it("matches allow list entries exactly or by prefix", () => {
    expect(allows(["node:*", "zod"], "node:fs/promises")).toBe(true);
    expect(allows(["node:*", "zod"], "zod")).toBe(true);
    expect(allows(["node:*", "zod"], "zod/mini")).toBe(false);
    expect(allows(["node:*"], "nodemailer")).toBe(false);
  });

  it.each(WORKSPACES)("finds no import cycle at run time in %s", (workspace) => {
    expect(cycles(runtimeGraph(workspace)).map((cycle) => cycle.join(" -> "))).toEqual([]);
  });

  it("reads what a file needs at run time, leaving out types", () => {
    const source = [
      'import type { A } from "./a.ts";',
      'import { type B, type C } from "./b.ts";',
      'import { D, type E } from "./d.ts";',
      'import F from "./f.ts";',
      'import * as G from "./g.ts";',
      'import "./h.ts";',
      'export type { I } from "./i.ts";',
      'export { type J } from "./j.ts";',
      'export { K } from "./k.ts";',
      'export * from "./l.ts";',
    ].join("\n");
    expect(runtimeSpecifiers(source)).toEqual([
      "./d.ts",
      "./f.ts",
      "./g.ts",
      "./h.ts",
      "./k.ts",
      "./l.ts",
    ]);
  });

  it("names each cycle once, from its first file", () => {
    const graph = new Map([
      ["b.ts", ["c.ts"]],
      ["c.ts", ["a.ts", "d.ts"]],
      ["a.ts", ["b.ts"]],
      ["d.ts", ["d.ts"]],
      ["e.ts", ["a.ts"]],
    ]);
    expect(cycles(graph)).toEqual([["a.ts", "b.ts", "c.ts"], ["d.ts"]]);
  });
});

/** Where the engine's lists are declared, with their owner modules in the comment of each field. */
const LISTS_FILE = "packages/engine/src/state/lists.ts";
/**
 * Modules that write every list: the snapshot loader (the state layout) with the record codecs
 * it reads entities by, and the file that hands out the lists.
 */
const WRITE_ANY = [
  "packages/engine/src/state/layout.ts",
  "packages/engine/src/state/codec.ts",
  "packages/engine/src/state/records.ts",
  LISTS_FILE,
];

interface OwnedList {
  readonly name: string;
  /** The entity type of the list, as `GameLists` names it. */
  readonly entity: string;
  /** Owner modules, from the root of the repository. */
  readonly owners: readonly string[];
}

/** The lists of `GameLists`, each with its entity type and its owners. */
function ownedLists(source: string): OwnedList[] {
  const file = ts.createSourceFile("lists.ts", source, ts.ScriptTarget.Latest, true);
  const lists: OwnedList[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "GameLists") {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || !member.type) continue;
        if (!ts.isArrayTypeNode(member.type)) continue;
        const docs = ts
          .getJSDocCommentsAndTags(member)
          .map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? "");
        lists.push({
          name: member.name.getText(file),
          entity: member.type.elementType.getText(file),
          owners: docs
            .join(",")
            .split(",")
            .map((owner) => owner.trim())
            .filter((owner) => owner !== "")
            .map((owner) => `packages/engine/src/${owner}`),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lists;
}

/**
 * ADR 0010: who writes the engine's lists. In each file but those of
 * `WRITE_ANY`, a call of `writable(game, "list")` must name its list with a
 * string and be made in an owner of that list; and an entity type of a list (`Attack`, `Alliance`
 * and the others) may be named outside its owners only as `Readonly<T>`,
 * never bare nor in a cast, so that no other module writes an entity it reads.
 */
function ownerViolations(
  files: readonly { readonly path: string; readonly source: string }[],
  lists: readonly OwnedList[],
): string[] {
  const byName = new Map(lists.map((list) => [list.name, list]));
  const byEntity = new Map(lists.map((list) => [list.entity, list]));
  const found: string[] = [];
  for (const { path, source } of files) {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const owns = (list: OwnedList) => WRITE_ANY.includes(path) || list.owners.includes(path);
    const at = (node: ts.Node) =>
      `${path}:${String(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)}`;
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "writable"
      ) {
        const name = node.arguments[1];
        const list = name && ts.isStringLiteral(name) ? byName.get(name.text) : undefined;
        // The snapshot loader walks every list by name.
        if (!list && !WRITE_ANY.includes(path)) {
          found.push(`${at(node)} writes a list it does not name`);
        } else if (list && !owns(list)) {
          found.push(`${at(node)} writes ${list.name}, owned by ${list.owners.join(", ")}`);
        }
      }
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const list = byEntity.get(node.typeName.text);
        const parent = node.parent;
        const readonly =
          ts.isTypeReferenceNode(parent) &&
          ts.isIdentifier(parent.typeName) &&
          parent.typeName.text === "Readonly";
        let cast = false;
        for (let up: ts.Node = node; !ts.isSourceFile(up); up = up.parent) {
          if (ts.isAsExpression(up) || ts.isTypeAssertionExpression(up)) cast = true;
        }
        if (list && !owns(list) && cast) {
          found.push(`${at(node)} casts to ${list.entity} outside ${list.owners.join(", ")}`);
        } else if (list && !owns(list) && !readonly) {
          found.push(
            `${at(node)} names ${list.entity} without Readonly outside ${list.owners.join(", ")}`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

describe("owner-only writes of the engine's lists (ADR 0010)", () => {
  const lists = ownedLists(readFileSync(join(root, LISTS_FILE), "utf8"));
  const engineFiles = sourceFiles(join(root, "packages/engine/src"));

  it("names owner modules that exist for every list", () => {
    // The capitals that fell are a rule part (ADR 0008), no longer one of the lists.
    expect(lists.length).toBeGreaterThanOrEqual(15);
    const known = new Set(engineFiles.map((file) => relative(root, file)));
    for (const list of lists) {
      expect(list.owners.length, list.name).toBeGreaterThan(0);
      for (const owner of list.owners)
        expect(known.has(owner), `${list.name}: ${owner}`).toBe(true);
    }
  });

  it("lets only the owners of each list, and the snapshot loader, write it", () => {
    const files = engineFiles.map((file) => ({
      path: relative(root, file),
      source: readFileSync(file, "utf8"),
    }));
    expect(ownerViolations(files, lists)).toEqual([]);
  });

  it("finds a write by a module that does not own the list, a cast, and a bare entity type", () => {
    const sample: OwnedList[] = [
      { name: "boats", entity: "Boat", owners: ["packages/engine/src/boats.ts"] },
    ];
    const source = [
      'import type { Boat } from "./boats.ts";',
      'writable(game, "boats").push(boat);',
      "writable(game, name);",
      "const kept: Readonly<Boat>[] = [];",
      "const seen: Boat[] = [];",
      "(game.boats as Readonly<Boat>[]).pop();",
    ].join("\n");
    const outside = "packages/engine/src/warships.ts";
    const owner = "packages/engine/src/boats.ts";
    expect(ownerViolations([{ path: outside, source }], sample)).toEqual([
      `${outside}:2 writes boats, owned by ${owner}`,
      `${outside}:3 writes a list it does not name`,
      `${outside}:5 names Boat without Readonly outside ${owner}`,
      `${outside}:6 casts to Boat outside ${owner}`,
    ]);
    expect(ownerViolations([{ path: owner, source }], sample)).toEqual([
      `${owner}:3 writes a list it does not name`,
    ]);
  });
});

/**
 * Reads of the time and of the random source in a file, found in its syntax
 * so that comments and strings do not count: `Date.now()`, `new Date()` with
 * no argument, `performance.now()`, the global timers, `Math.random()` and
 * the random functions of `node:crypto`.
 */
function clockAndRandomness(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const timers = new Set(["setTimeout", "setInterval", "clearTimeout", "clearInterval"]);
  const randomness = new Set(["randomBytes", "randomInt", "randomUUID", "getRandomValues"]);
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const name = `${node.expression.text}.${node.name.text}`;
      if (["Date.now", "performance.now", "Math.random"].includes(name)) found.push(name);
    }
    // The global timers, called or passed on; `clock.setTimeout` and a member named so are not them.
    const parent = node.parent as ts.Node | undefined;
    if (
      ts.isIdentifier(node) &&
      timers.has(node.text) &&
      parent !== undefined &&
      !(ts.isPropertyAccessExpression(parent) && parent.name === node) &&
      !(
        (ts.isPropertyAssignment(parent) ||
          ts.isMethodSignature(parent) ||
          ts.isMethodDeclaration(parent)) &&
        parent.name === node
      )
    ) {
      found.push(node.text);
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date" &&
      (node.arguments?.length ?? 0) === 0
    ) {
      found.push("new Date()");
    }
    if (ts.isImportSpecifier(node) && randomness.has((node.propertyName ?? node.name).text)) {
      found.push(`import ${(node.propertyName ?? node.name).text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.map((what) => `${relative(root, file)}: ${what}`);
}

describe("server ports", () => {
  const serverSources = join(root, "apps/server/src");

  it("reads the time and draws random values through the Clock and Ids ports only", () => {
    const ports = new Set([join(serverSources, "clock.ts"), join(serverSources, "ids.ts")]);
    const files = sourceFiles(serverSources).filter((file) => !ports.has(file));
    expect(files.flatMap(clockAndRandomness)).toEqual([]);
  });

  it("finds a read of the clock or of the random source", () => {
    const kinds = (file: string) =>
      clockAndRandomness(join(serverSources, file)).map((line) => line.split(": ")[1]);
    expect(kinds("clock.ts")).toEqual(
      expect.arrayContaining(["Date.now", "performance.now", "setTimeout", "clearInterval"]),
    );
    expect(kinds("ids.ts")).toEqual(
      expect.arrayContaining(["import randomBytes", "import randomInt", "Math.random"]),
    );
  });

  it("speaks HTTP and WebSocket through the transport port only", () => {
    const network = ["node:http", "node:https", "http", "https", "ws", "bun"];
    const users = imports("apps/server")
      .filter(({ specifier }) => network.includes(specifier))
      .map(({ file, specifier }) => `${relative(root, file)} imports ${specifier}`);
    // In the syntax, so that a comment naming it does not count.
    const serves = sourceFiles(serverSources)
      .filter((file) => {
        const found: ts.Node[] = [];
        const visit = (node: ts.Node): void => {
          if (ts.isPropertyAccessExpression(node) && node.getText() === "Bun.serve")
            found.push(node);
          ts.forEachChild(node, visit);
        };
        visit(ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true));
        return found.length > 0;
      })
      .map((file) => `${relative(root, file)} calls Bun.serve`);
    expect([...users, ...serves].sort()).toEqual([
      "apps/server/src/bun-transport.ts calls Bun.serve",
      "apps/server/src/bun-transport.ts imports bun",
    ]);
  });

  it("reaches SQLite through the SqlDriver port only", () => {
    const sqlite = imports("apps/server")
      .filter(({ specifier }) => specifier === "bun:sqlite" || specifier === "node:sqlite")
      .map(({ file, specifier }) => `${relative(root, file)} imports ${specifier}`);
    expect(sqlite.sort()).toEqual([
      "apps/server/src/sql/bun-sqlite.ts imports bun:sqlite",
      "apps/server/src/sql/node-sqlite.ts imports node:sqlite",
    ]);
  });

  it("depends on the protocol, zod, nodemailer and the runtime only", () => {
    const allowed = ["@frontfall/protocol", "zod", "nodemailer", "bun"];
    const outside = imports("apps/server")
      .filter(({ file, specifier }) =>
        specifier.startsWith(".")
          ? escapes(file, specifier, "apps/server")
          : !allowed.includes(specifier) &&
            !specifier.startsWith("node:") &&
            !specifier.startsWith("bun:"),
      )
      .map(({ file, specifier }) => `${relative(root, file)} imports ${specifier}`);
    expect(outside).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(root, "apps/server/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "@frontfall/protocol",
      "nodemailer",
      "zod",
    ]);
  });
});

/** A client layer is the folder under apps/client/src, `root` for loose files, `app` for the entry point. */
type Layer =
  | "app"
  | "ui"
  | "game"
  | "net"
  | "render"
  | "input"
  | "audio"
  | "achievements"
  | "stats"
  | "i18n"
  | "root";

/** What a layer may import: any layer in `runtime`, and the layers in `types` through `import type` only. */
interface LayerRule {
  readonly runtime: readonly Layer[];
  readonly types?: readonly Layer[];
}

const ALL_LAYERS: readonly Layer[] = [
  "app",
  "ui",
  "game",
  "net",
  "render",
  "input",
  "audio",
  "achievements",
  "stats",
  "i18n",
  "root",
];

/** The client layer table (ADR 0013, ADR 0014). A layer may always import itself. */
const CLIENT_LAYERS: Record<Layer, LayerRule> = {
  app: { runtime: ALL_LAYERS },
  ui: {
    runtime: ["game", "render", "input", "audio", "achievements", "stats", "i18n", "root"],
    types: ["net"],
  },
  game: { runtime: ["i18n", "root"] },
  net: { runtime: ["i18n", "root"] },
  render: { runtime: ["i18n", "root"] },
  input: { runtime: ["i18n", "root"], types: ["render"] },
  audio: { runtime: ["i18n", "root"], types: ["game"] },
  achievements: { runtime: ["i18n", "root"], types: ["game"] },
  stats: { runtime: ["i18n", "root"], types: ["game"] },
  i18n: { runtime: ["root"] },
  root: { runtime: ["i18n", "root"] },
};

const clientSrc = join(root, "apps/client/src");

function layerOf(file: string): Layer {
  const parts = relative(clientSrc, file).split(sep);
  if (parts.length === 1) return parts[0] === "main.ts" ? "app" : "root";
  const folder = parts[0] as Layer;
  if (!(folder in CLIENT_LAYERS)) {
    throw new Error(
      `${relative(root, file)}: no layer for folder ${folder}; add it to CLIENT_LAYERS`,
    );
  }
  return folder;
}

interface ImportEdge {
  file: string;
  line: number;
  specifier: string;
  typeOnly: boolean;
}

/** Import and re-export declarations of one module, read from the syntax tree. */
function importEdges(file: string, text: string): ImportEdge[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edges: ImportEdge[] = [];
  const add = (node: ts.Node, specifier: ts.Node | undefined, typeOnly: boolean): void => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    edges.push({ file, line, specifier: specifier.text, typeOnly });
  };
  const allTypes = (bindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined) =>
    bindings !== undefined &&
    (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
          (clause.name === undefined && allTypes(clause.namedBindings)));
      add(node, node.moduleSpecifier, typeOnly);
    } else if (ts.isExportDeclaration(node)) {
      add(node, node.moduleSpecifier, node.isTypeOnly || allTypes(node.exportClause));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) add(node, argument, false);
      else throw new Error(`${relative(root, file)}: import() needs a literal argument`);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

/** Layer rule breaches in a set of edges. A bare module is not a layer. */
function layerViolations(edges: ImportEdge[], layerFor: (file: string) => Layer): string[] {
  return edges.flatMap(({ file, line, specifier, typeOnly }) => {
    if (!specifier.startsWith(".")) return [];
    const target = resolve(dirname(file), specifier.replace(/\?.*$/, ""));
    if (relative(clientSrc, target).startsWith("..")) return [];
    const from = layerFor(file);
    const to = layerFor(target);
    if (from === to) return [];
    const rule = CLIENT_LAYERS[from];
    if (rule.runtime.includes(to)) return [];
    if (typeOnly && rule.types?.includes(to)) return [];
    const where = `${relative(root, file)}:${String(line)}`;
    return [`${where}: ${from} may not import ${to}${typeOnly ? " (types)" : ""}: ${specifier}`];
  });
}

describe("client layers", () => {
  it("keeps every client import inside the layer table", () => {
    const edges = sourceFiles(clientSrc).flatMap((file) =>
      importEdges(file, readFileSync(file, "utf8")),
    );
    expect(layerViolations(edges, layerOf)).toEqual([]);
  });

  it("tells type-only imports and re-exports from runtime ones", () => {
    const text = [
      'import type { A } from "./a.ts";',
      'import { type B } from "./b.ts";',
      'import { type C, d } from "./c.ts";',
      'export type { D } from "./d.ts";',
      'export { E } from "./e.ts";',
      'const lazy = import("./f.ts");',
    ].join("\n");
    const edges = importEdges("x.ts", text);
    expect(edges.map((edge) => [edge.specifier, edge.typeOnly])).toEqual([
      ["./a.ts", true],
      ["./b.ts", true],
      ["./c.ts", false],
      ["./d.ts", true],
      ["./e.ts", false],
      ["./f.ts", false],
    ]);
  });

  it("allows a layer's listed type imports and rejects them as runtime imports", () => {
    const layerFor = (file: string): Layer => (file.includes("/net/") ? "net" : "ui");
    const file = join(clientSrc, "ui/a.ts");
    const edge = { file, line: 1, specifier: "../net/online.ts" };
    expect(layerViolations([{ ...edge, typeOnly: true }], layerFor)).toEqual([]);
    expect(layerViolations([{ ...edge, typeOnly: false }], layerFor)).toHaveLength(1);
    // render lists no layer for types, so even `import type` upward is refused.
    const fromRender = (file: string): Layer => (file.includes("/render/") ? "render" : "ui");
    const up = { file: join(clientSrc, "render/a.ts"), line: 3, specifier: "../ui/b.ts" };
    expect(layerViolations([{ ...up, typeOnly: true }], fromRender)).toEqual([
      "apps/client/src/render/a.ts:3: render may not import ui (types): ../ui/b.ts",
    ]);
  });
});
