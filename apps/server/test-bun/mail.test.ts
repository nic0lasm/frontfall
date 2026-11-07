import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureContext, TLSSocket, type SecureContext } from "node:tls";
import { smtpMailer, type SmtpSettings } from "../src/mail.ts";

/** A certificate for localhost, made for this run: nothing secret is kept in the repository. */
let dir: string;
let cert: string;
let context: SecureContext;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "frontfall-smtp-"));
  execFileSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"],
      ...["-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1"],
      ...["-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"],
    ],
    { stdio: "ignore" },
  );
  cert = readFileSync(join(dir, "cert.pem"), "utf8");
  context = createSecureContext({ key: readFileSync(join(dir, "key.pem"), "utf8"), cert });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** What the SMTP server read, a line each; lines read over TLS start with "TLS ". */
interface Session {
  lines: string[];
  /** The protocol TLS settled on, once STARTTLS is done. */
  protocol: string | undefined;
}

/** A small SMTP server that offers STARTTLS, or not, and accepts any login and mail. */
async function smtpServer(
  offersTls: boolean,
): Promise<{ port: number; session: Session; server: Server }> {
  const session: Session = { lines: [], protocol: undefined };
  const server = createServer((raw) => {
    let socket: Socket | TLSSocket = raw;
    let secure = false;
    let data = false;
    let buffer = "";
    const say = (line: string): void => {
      socket.write(`${line}\r\n`);
    };
    const read = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      for (let at = buffer.indexOf("\r\n"); at >= 0; at = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        session.lines.push(`${secure ? "TLS " : ""}${line}`);
        if (data) {
          if (line === ".") {
            data = false;
            say("250 queued");
          }
          continue;
        }
        const verb = (line.split(" ")[0] ?? "").toUpperCase();
        if (verb === "EHLO") {
          const offer = secure
            ? "250 AUTH PLAIN LOGIN"
            : offersTls
              ? "250 STARTTLS"
              : "250 AUTH PLAIN";
          socket.write(`250-localhost\r\n${offer}\r\n`);
        } else if (verb === "STARTTLS" && offersTls) {
          say("220 ready");
          raw.off("data", read);
          const upgraded = new TLSSocket(raw, { isServer: true, secureContext: context });
          upgraded.on("secure", () => {
            session.protocol = upgraded.getProtocol() ?? undefined;
          });
          upgraded.on("error", () => undefined);
          upgraded.on("data", read);
          socket = upgraded;
          secure = true;
        } else if (verb === "AUTH") say("235 accepted");
        else if (verb === "MAIL" || verb === "RCPT") say("250 ok");
        else if (verb === "DATA") {
          data = true;
          say("354 go on");
        } else if (verb === "QUIT") {
          say("221 bye");
          socket.end();
        } else say("502 not here");
      }
    };
    raw.on("data", read);
    raw.on("error", () => undefined);
    say("220 localhost ESMTP");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as { port: number }).port, session, server };
}

const SETTINGS: SmtpSettings = {
  host: "localhost",
  port: 587,
  user: "game",
  password: "secret",
  from: "game@example.org",
};

/** Whether the send was refused. */
function fails(sending: Promise<void>): Promise<boolean> {
  return sending.then(
    () => false,
    () => true,
  );
}

const MESSAGE = { to: "nelly@example.org", subject: "Your link", text: "https://example.org/x" };

describe("nodemailer on Bun", () => {
  it("sends over STARTTLS, logging in and sending only once the connection is encrypted", async () => {
    const { port, session, server } = await smtpServer(true);
    try {
      await smtpMailer(SETTINGS, { port, ca: cert }).send(MESSAGE);
      expect(session.protocol).toMatch(/^TLSv1\.[23]$/);
      const plain = session.lines.filter((line) => !line.startsWith("TLS "));
      expect(plain.map((line) => line.split(" ")[0])).toEqual(["EHLO", "STARTTLS"]);
      const verbs = session.lines
        .filter((line) => line.startsWith("TLS "))
        .map((line) => line.split(" ")[1]);
      expect(verbs.slice(0, 5)).toEqual(["EHLO", "AUTH", "MAIL", "RCPT", "DATA"]);
      expect(session.lines).toContain("TLS Subject: Your link");
      expect(session.lines).toContain("TLS Auto-Submitted: auto-generated");
    } finally {
      server.close();
    }
  });

  it("refuses a certificate it cannot check", async () => {
    const { port, session, server } = await smtpServer(true);
    try {
      expect(await fails(smtpMailer(SETTINGS, { port, ca: "" }).send(MESSAGE))).toBe(true);
      await Bun.sleep(200);
      expect(session.lines.some((line) => line.startsWith("TLS "))).toBe(false);
    } finally {
      server.close();
    }
  });

  it("sends nothing to a server that does not offer STARTTLS", async () => {
    const { port, session, server } = await smtpServer(false);
    try {
      expect(await fails(smtpMailer(SETTINGS, { port, ca: cert }).send(MESSAGE))).toBe(true);
      await Bun.sleep(200);
      expect(session.lines.some((line) => /^(AUTH|MAIL)/.test(line))).toBe(false);
    } finally {
      server.close();
    }
  });
});
