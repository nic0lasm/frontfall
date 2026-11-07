import { parseArgs } from "node:util";
import { backup } from "./database.ts";
import { Moderation, REPORT_DAYS, validTarget } from "./moderation.ts";
import type { SqlDriver } from "./sql/driver.ts";

export const ADMIN_USAGE = `Usage: frontfall-admin <command> [options]

  bans list                                   the bans in force
  bans add <target> [--days N] [--note TEXT]  bans an address or a reference, for N days or for good
  bans remove <target>                        lifts a ban
  reports list [--days N]                     the reports of the last N days (30 at most), newest first
  backup <file>                               writes a consistent copy of data.db to a new file

Options: --data <dir>, the data directory (FRONTFALL_DATA by default).
A running server reads a changed ban list at once; one that is stopped, at its start.`;

/** What a command needs around it: data.db, the time, where to print, and how to tell the server. */
export interface AdminContext {
  db: SqlDriver;
  now: number;
  print(text: string): void;
  /** Asks the running server to read the ban list again; resolves with what to tell the operator. */
  reload(): Promise<string>;
}

/** Runs one command; resolves with the exit status: 0 done, 1 refused, 2 not understood. */
export async function runAdmin(args: readonly string[], ctx: AdminContext): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    ctx.print(`${(error as Error).message}\n\n${ADMIN_USAGE}`);
    return 2;
  }
  const { positionals, values } = parsed;
  const [group, action, target, ...rest] = positionals;
  const json = (value: unknown): void => {
    ctx.print(JSON.stringify(value, null, 2));
  };
  const usage = (): number => {
    ctx.print(ADMIN_USAGE);
    return 2;
  };
  if (rest.length > 0) return usage();
  const days = values.days === undefined ? undefined : Number(values.days);
  if (days !== undefined && !(Number.isFinite(days) && days > 0)) {
    ctx.print("--days takes a number of days above 0");
    return 2;
  }

  if (group === "backup" && action !== undefined && target === undefined) {
    try {
      backup(ctx.db, action);
    } catch (error) {
      ctx.print(`backup not written: ${(error as Error).message}`);
      return 1;
    }
    ctx.print(`wrote ${action}`);
    return 0;
  }
  if (group === "reports" && action === "list" && target === undefined) {
    json(new Moderation(ctx.db, ctx.now).read(ctx.now, Math.min(days ?? REPORT_DAYS, REPORT_DAYS)));
    return 0;
  }
  if (group !== "bans") return usage();
  const moderation = new Moderation(ctx.db, ctx.now);
  moderation.reload(ctx.now);
  if (action === "list" && target === undefined) {
    json({ bans: moderation.list(ctx.now) });
    return 0;
  }
  if ((action !== "add" && action !== "remove") || target === undefined) return usage();
  if (!validTarget(target)) {
    ctx.print(`${target} is neither an IP address, an IPv6 /64, nor a 16-character reference`);
    return 1;
  }
  if (action === "add") {
    json(moderation.ban(target, days, values.note?.slice(0, 200), ctx.now));
  } else if (!moderation.unban(target, ctx.now)) {
    ctx.print(`no ban of ${target}`);
    return 1;
  }
  ctx.print(await ctx.reload());
  return 0;
}

function parse(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      days: { type: "string" },
      note: { type: "string" },
      data: { type: "string" },
    },
  });
}
