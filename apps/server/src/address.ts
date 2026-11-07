import { isIP } from "node:net";
import type { HttpRequest } from "./transport.ts";

/** What the checks of an address read of a request: who sent it, and what it says. */
type Sender = Pick<HttpRequest, "peer" | "header">;

/**
 * Loopback and private ranges: the host itself, or a reverse proxy on the same
 * machine or container network. Only such peers may tell the server who the
 * player is.
 */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return false;
}

/**
 * The network one subscriber holds, for an IPv6 address on the Internet: its
 * /64, written `2001:db8:0:1::/64`. A home or a server is handed a whole /64,
 * so counting each of its addresses apart would let one player dodge every
 * per-address limit and ban by switching address. Anything else is returned
 * unchanged.
 */
export function network(address: string): string {
  if (isIP(address) !== 6 || isPrivateAddress(address) || address.includes(".")) return address;
  const [head = "", tail] = address.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}

/**
 * Address of the player. A reverse proxy in front of the server sets
 * X-Client-IP and overwrites any value the browser sent; the header is only
 * believed when the request comes from such a proxy, so a server exposed
 * directly cannot be fooled into per-address limits on a forged address.
 * `trustProxy` false never believes it, for a server reached without a proxy
 * from its own network, such as a LAN party. IPv6 players count by /64.
 */
export function clientAddress(request: Sender, trustProxy = true): string {
  const peer = request.peer;
  const forwarded = request.header("x-client-ip")?.trim();
  // Anything but an address would let one client invent new names for itself.
  const valid = forwarded && isIP(forwarded) !== 0 ? forwarded : undefined;
  return network((trustProxy && isPrivateAddress(peer) && valid) || (peer ?? "unknown"));
}

/** Headers a reverse proxy adds to the requests it forwards. */
const PROXY_HEADERS = [
  "x-client-ip",
  "x-forwarded-for",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
];

/** A request from the host or its private network, not forwarded by a proxy. */
export function isLocalRequest(request: Sender): boolean {
  return (
    isPrivateAddress(request.peer) &&
    !PROXY_HEADERS.some((name) => request.header(name) !== undefined)
  );
}

/** Host names a request typed on the machine itself goes to. */
const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i;

/**
 * A request from inside the container itself, as `docker exec` sends: for admin
 * routes. A browser on the same machine is refused too: it names the page that
 * sent it (Origin, Sec-Fetch-Site), and a host name that was rebound to
 * 127.0.0.1 still shows in Host, so no web page can reach these routes.
 */
export function isLoopbackRequest(request: Sender): boolean {
  const address = request.peer ?? "";
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  return (
    (ip === "::1" || ip.startsWith("127.")) &&
    !PROXY_HEADERS.some((name) => request.header(name) !== undefined) &&
    request.header("origin") === undefined &&
    request.header("sec-fetch-site") === undefined &&
    LOOPBACK_HOST.test(request.header("host") ?? "")
  );
}
