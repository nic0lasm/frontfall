import { readFileSync } from "node:fs";
import { createTransport } from "nodemailer";

/** One email to one player. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends emails; the sign-in link is the only one the game sends. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * The mailbox the game sends from, in the same JSON file as other services
 * of a server may already read: `{ "hote", "port", "utilisateur",
 * "motDePasse", "expediteur" }`. Other fields are ignored.
 */
export interface SmtpSettings {
  host: string;
  port: 465 | 587;
  user: string;
  password: string;
  from: string;
}

const ADDRESS = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const HOST = /^[a-z0-9.-]{1,253}$/i;
const SMTP_TIMEOUT_MS = 15_000;

/**
 * Reads the SMTP file. Errors name the field that is wrong, never its value:
 * they end up in the logs.
 */
export function readSmtpSettings(file: string): SmtpSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("SMTP file cannot be read");
  }
  if (typeof raw !== "object" || raw === null) throw new Error("SMTP file is not an object");
  const fields = raw as Record<string, unknown>;
  const check = (name: string, valid: boolean): void => {
    if (!valid) throw new Error(`SMTP file: field "${name}" is missing or wrong`);
  };
  const { hote, port, utilisateur, motDePasse, expediteur } = fields;
  check("hote", typeof hote === "string" && HOST.test(hote));
  check("port", port === 465 || port === 587);
  check("utilisateur", typeof utilisateur === "string" && utilisateur.length > 0);
  check("motDePasse", typeof motDePasse === "string" && motDePasse.length > 0);
  check("expediteur", typeof expediteur === "string" && ADDRESS.test(expediteur));
  return {
    host: hote as string,
    port: port as 465 | 587,
    user: utilisateur as string,
    password: motDePasse as string,
    from: expediteur as string,
  };
}

/** Whether a player typed something that can be an email address. */
export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && ADDRESS.test(value);
}

/**
 * The mailbox an address reaches, for counting links per mailbox: `ana+1@x`
 * and `ana+2@x` arrive in the same one, and so do `a.na@gmail.com` and
 * `ana@googlemail.com`. The account still follows the address as typed.
 */
export function mailbox(email: string): string {
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at).split("+")[0] ?? "";
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}

/**
 * Where a test reaches its own SMTP server instead: the port it listens on,
 * and the certificate it signs with, trusted on top of the system's.
 */
export interface SmtpTestServer {
  port: number;
  ca: string;
}

/** Sends over SMTP, encrypted with a checked certificate, as plain text only. */
export function smtpMailer(settings: SmtpSettings, testServer?: SmtpTestServer): Mailer {
  const transport = createTransport({
    host: settings.host,
    port: testServer?.port ?? settings.port,
    secure: settings.port === 465,
    requireTLS: true,
    auth: { user: settings.user, pass: settings.password },
    tls: {
      minVersion: "TLSv1.2",
      servername: settings.host,
      ...(testServer && { ca: testServer.ca }),
    },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS * 2,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({
        from: { name: "Frontfall", address: settings.from },
        to,
        subject,
        text,
        headers: { "auto-submitted": "auto-generated" },
      });
    },
  };
}

/**
 * What a failed send may say in the logs: the SMTP code, never the server's
 * words, which often repeat the address.
 */
export function mailFailure(error: unknown): string {
  const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  if (typeof responseCode === "number") return `smtp ${String(responseCode)}`;
  return typeof code === "string" && /^[A-Z_]{1,32}$/.test(code) ? code : "send failed";
}
