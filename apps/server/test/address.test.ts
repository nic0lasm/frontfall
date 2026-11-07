import { describe, expect, it } from "vitest";
import {
  clientAddress,
  isLocalRequest,
  isLoopbackRequest,
  isPrivateAddress,
  network,
} from "../src/address.ts";
import type { HttpRequest } from "../src/transport.ts";

function request(
  peer: string,
  headers: Record<string, string> = {},
): Pick<HttpRequest, "peer" | "header"> {
  return { peer, header: (name) => headers[name] };
}

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.18.0.5",
    "192.168.1.20",
    "::1",
    "fd00::1",
    "::ffff:172.20.0.2",
  ])("trusts %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "203.0.113.9",
    "172.32.0.1",
    "8.8.8.8",
    "2001:db8::1",
    "::ffff:8.8.8.8",
    "",
    "nonsense",
  ])("does not trust %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("does not trust a missing address", () => {
    expect(isPrivateAddress(undefined)).toBe(false);
  });
});

describe("clientAddress", () => {
  it("believes X-Client-IP from a proxy on the private network", () => {
    expect(clientAddress(request("172.18.0.3", { "x-client-ip": " 203.0.113.9 " }))).toBe(
      "203.0.113.9",
    );
  });

  it("ignores X-Client-IP from anyone else", () => {
    expect(clientAddress(request("198.51.100.4", { "x-client-ip": "203.0.113.9" }))).toBe(
      "198.51.100.4",
    );
  });

  it("falls back to the peer address", () => {
    expect(clientAddress(request("127.0.0.1"))).toBe("127.0.0.1");
  });

  it("ignores an X-Client-IP that is not an address", () => {
    expect(clientAddress(request("10.0.0.2", { "x-client-ip": "not-an-ip" }))).toBe("10.0.0.2");
    expect(clientAddress(request("10.0.0.2", { "x-client-ip": "1.2.3.4, 5.6.7.8" }))).toBe(
      "10.0.0.2",
    );
  });

  it("ignores X-Client-IP when no proxy is trusted", () => {
    expect(clientAddress(request("192.168.1.20", { "x-client-ip": "203.0.113.9" }), false)).toBe(
      "192.168.1.20",
    );
  });
});

describe("network", () => {
  it("counts an IPv6 player by the /64 a subscriber holds", () => {
    expect(network("2001:db8:a:b:1:2:3:4")).toBe("2001:db8:a:b::/64");
    expect(network("2001:DB8:0:00b::9")).toBe("2001:db8:0:b::/64");
    expect(network("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("leaves IPv4, private and loopback addresses alone", () => {
    expect(network("203.0.113.9")).toBe("203.0.113.9");
    expect(network("::1")).toBe("::1");
    expect(network("fd00::1")).toBe("fd00::1");
    expect(network("::ffff:203.0.113.9")).toBe("::ffff:203.0.113.9");
  });

  it("is what clientAddress gives for an IPv6 player", () => {
    expect(clientAddress(request("172.18.0.3", { "x-client-ip": "2001:db8:1:2::77" }))).toBe(
      "2001:db8:1:2::/64",
    );
  });
});

describe("isLoopbackRequest", () => {
  const local = { host: "127.0.0.1:8080" };

  it("accepts a request typed inside the container", () => {
    expect(isLoopbackRequest(request("127.0.0.1", local))).toBe(true);
    expect(isLoopbackRequest(request("::1", { host: "[::1]:8080" }))).toBe(true);
    expect(isLoopbackRequest(request("::ffff:127.0.0.1", { host: "localhost:8080" }))).toBe(true);
  });

  it("refuses a browser on the same machine", () => {
    expect(
      isLoopbackRequest(request("127.0.0.1", { ...local, origin: "https://evil.example" })),
    ).toBe(false);
    expect(
      isLoopbackRequest(request("127.0.0.1", { ...local, "sec-fetch-site": "cross-site" })),
    ).toBe(false);
  });

  it("refuses a host name rebound to the loopback address", () => {
    expect(isLoopbackRequest(request("127.0.0.1", { host: "evil.example:8080" }))).toBe(false);
    expect(isLoopbackRequest(request("127.0.0.1"))).toBe(false);
  });

  it("refuses forwarded or remote requests", () => {
    expect(isLoopbackRequest(request("127.0.0.1", { ...local, "x-client-ip": "1.2.3.4" }))).toBe(
      false,
    );
    expect(isLoopbackRequest(request("172.18.0.1", local))).toBe(false);
  });
});

describe("isLocalRequest", () => {
  it("accepts requests from the host that no proxy forwarded", () => {
    expect(isLocalRequest(request("127.0.0.1"))).toBe(true);
    expect(isLocalRequest(request("172.18.0.1"))).toBe(true);
  });

  it("refuses forwarded or remote requests", () => {
    expect(isLocalRequest(request("172.18.0.3", { "x-forwarded-for": "1.2.3.4" }))).toBe(false);
    expect(isLocalRequest(request("203.0.113.9"))).toBe(false);
  });
});
