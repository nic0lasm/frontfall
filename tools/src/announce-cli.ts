import { setTimeout as sleep } from "node:timers/promises";
import { Announcer, announceOnce } from "./announce.ts";

// Polls a Frontfall server and announces its open public games on a Discord
// webhook. See docs/self-hosting.md, "Announce public games on Discord".

/** A setting that must be a web address. The value is never printed: the webhook's is its secret. */
function address(name: string): URL {
  const value = process.env[name];
  if (!value || !URL.canParse(value)) {
    console.error(`${name} must be set to a web address; see docs/self-hosting.md`);
    process.exit(2);
  }
  return new URL(value);
}

const server = address("FRONTFALL_URL");
// A trailing slash, so that api/games resolves under a path prefix such as /frontfall/.
if (!server.pathname.endsWith("/")) server.pathname += "/";
const webhook = address("DISCORD_WEBHOOK_URL");
const seconds = Number(process.env.ANNOUNCE_SECONDS ?? 30);
if (!Number.isFinite(seconds) || seconds < 5) {
  console.error("ANNOUNCE_SECONDS must be a number of at least 5");
  process.exit(2);
}

const announcer = new Announcer((id) => new URL(`?game=${id}`, server).href);
console.log(`announcing the public games of ${server.href} every ${String(seconds)} s`);
for (;;) {
  const error = await announceOnce(announcer, { server, webhook });
  if (error) console.error(error);
  await sleep(seconds * 1000);
}
