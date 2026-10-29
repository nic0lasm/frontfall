import {
  absorbAchievements,
  deviceAchievements,
  type SavedAchievements,
} from "../achievements/account-sync.ts";
import { getLanguage, onLanguageChange, type Language } from "../i18n/index.ts";
import { h } from "./dom.ts";
import "./account.css";

type Provider = "discord" | "google";
type Method = Provider | "email";

/** What the server says at `/api/me`: which services to offer, and who is signed in. */
interface Me {
  providers: Provider[];
  /** Whether the server can send a sign-in link by email; older servers leave it out. */
  email?: boolean;
  account: {
    name: string;
    provider: Method;
    /** Every way to sign in to the account; older servers leave it out. */
    methods?: Method[];
    /** Another account of the player's, to merge once they say yes. */
    merge?: { name: string; methods: Method[] };
  } | null;
}

/**
 * The box's own words: the module and its styles load after the menu shows,
 * so they stay out of the first visit's code.
 */
const TEXT = {
  en: {
    offer: "Optional: sign in to keep your name and achievements.",
    signInWith: "Sign in with {service}",
    signedIn:
      "Signed in as {name} with {services}. This name and your achievements are yours alone.",
    line: "Signed in with {services}.",
    manage: "Account",
    methods: "Ways to sign in:",
    removeMethod: "Remove {service}",
    add: "Add a way to sign in to this account:",
    addWith: "Add {service}",
    addEmail: "Add an email address",
    linkSentAdd:
      "If this address is right, a link is on its way. Open it on this device, signed in to this account, within 15 minutes.",
    elsewhere: "Open this link on the device where you are signed in to the account.",
    mergeAsk:
      "You already have another account, {other} ({services}). Merge it into this one? You keep the name {name} and the achievements of both; the account {other} goes away and its name becomes free.",
    mergeYes: "Merge the two accounts",
    mergeNo: "Keep them apart",
    last: "This is your last way to sign in: it stays.",
    emailOpen: "Sign in with email",
    emailLabel: "Email address",
    emailSend: "Send me a link",
    linkSent:
      "If this address is right, a link is on its way. Open it on this device or another within 15 minutes.",
    finishPrompt: "You opened a sign-in link.",
    finish: "Finish signing in",
    expired: "This link no longer works. You can ask for a new one.",
    rate: "Too many links asked for from here. Try again in a few minutes.",
    busy: "No more links can be sent today. Try again tomorrow, or play as a guest.",
    badEmail: "This does not look like an email address.",
    signOut: "Sign out",
    delete: "Delete my account",
    deleteConfirm: "Delete your account? Your name will be free for anyone to take.",
    failed: "Signing in did not work. You can try again, or play as a guest.",
    taken: "Another player already holds this name.",
    invalid: "This name is not allowed.",
    privacy: "Privacy",
    terms: "Terms",
  },
  fr: {
    offer: "Facultatif : connectez-vous pour garder votre nom et vos succès.",
    signInWith: "Se connecter avec {service}",
    signedIn:
      "Connecté en tant que {name} avec {services}. Ce nom et vos succès ne sont qu'à vous.",
    line: "Connecté avec {services}.",
    manage: "Compte",
    methods: "Vos façons de vous connecter :",
    removeMethod: "Retirer {service}",
    add: "Ajouter une façon de vous connecter à ce compte :",
    addWith: "Ajouter {service}",
    addEmail: "Ajouter une adresse e-mail",
    linkSentAdd:
      "Si cette adresse est la bonne, un lien est en route. Ouvrez-le sur cet appareil, connecté à ce compte, dans les 15 minutes.",
    elsewhere: "Ouvrez ce lien sur l'appareil où vous êtes connecté à ce compte.",
    mergeAsk:
      "Vous avez déjà un autre compte, {other} ({services}). Le réunir avec celui-ci ? Vous gardez le nom {name} et les succès des deux ; le compte {other} disparaît et son nom redevient libre.",
    mergeYes: "Réunir les deux comptes",
    mergeNo: "Les garder séparés",
    last: "C'est votre dernière façon de vous connecter : elle reste.",
    emailOpen: "Se connecter par e-mail",
    emailLabel: "Adresse e-mail",
    emailSend: "M'envoyer un lien",
    linkSent:
      "Si cette adresse est la bonne, un lien est en route. Ouvrez-le sur cet appareil ou un autre dans les 15 minutes.",
    finishPrompt: "Vous avez ouvert un lien de connexion.",
    finish: "Terminer la connexion",
    expired: "Ce lien ne marche plus. Vous pouvez en demander un autre.",
    rate: "Trop de liens demandés d'ici. Réessayez dans quelques minutes.",
    busy: "Plus aucun lien ne peut partir aujourd'hui. Réessayez demain, ou jouez en invité.",
    badEmail: "Cette adresse e-mail ne semble pas valide.",
    signOut: "Se déconnecter",
    delete: "Supprimer mon compte",
    deleteConfirm: "Supprimer votre compte ? Votre nom redeviendra libre pour tout le monde.",
    failed: "La connexion n'a pas abouti. Vous pouvez réessayer, ou jouer en invité.",
    taken: "Un autre joueur a déjà ce nom.",
    invalid: "Ce nom n'est pas autorisé.",
    privacy: "Confidentialité",
    terms: "Conditions",
  },
} satisfies Record<Language, Record<string, string>>;

type TextKey = keyof (typeof TEXT)["en"];

/** Messages that are news, not errors. */
const NOTES: ReadonlySet<TextKey> = new Set(["linkSent", "linkSentAdd"]);

function text(key: TextKey, values: Record<string, string> = {}): string {
  return TEXT[getLanguage()][key].replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}

const PROVIDER_NAMES: Record<Provider, string> = { discord: "Discord", google: "Google" };

function methodName(method: Method): string {
  if (method !== "email") return PROVIDER_NAMES[method];
  return getLanguage() === "fr" ? "e-mail" : "email";
}

/** "Discord and Google", in the page's language. */
function methodList(methods: readonly Method[]): string {
  return new Intl.ListFormat(getLanguage(), { type: "conjunction" }).format(
    methods.map(methodName),
  );
}

/** The ways to sign in to an account, as older servers tell them too. */
function methodsOf(account: NonNullable<Me["account"]>): Method[] {
  return account.methods ?? [account.provider];
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The services' own marks, drawn as published and never altered: Google's
 * four-colour G and Discord's white Clyde on its blurple.
 */
const LOGOS: Record<Provider, { viewBox: string; paths: { d: string; fill: string }[] }> = {
  google: {
    viewBox: "0 0 48 48",
    paths: [
      {
        fill: "#EA4335",
        d: "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z",
      },
      {
        fill: "#4285F4",
        d: "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z",
      },
      {
        fill: "#FBBC05",
        d: "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z",
      },
      {
        fill: "#34A853",
        d: "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z",
      },
    ],
  },
  discord: {
    viewBox: "0 0 24 24",
    paths: [
      {
        fill: "#FFFFFF",
        d: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
      },
    ],
  },
};

function logo(provider: Provider): SVGSVGElement {
  const { viewBox, paths } = LOGOS[provider];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("class", "account-logo");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const { d, fill } of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", fill);
    svg.append(path);
  }
  return svg;
}

function isMe(value: unknown): value is Me {
  if (typeof value !== "object" || value === null) return false;
  const me = value as Partial<Me>;
  return Array.isArray(me.providers) && (me.account === null || typeof me.account === "object");
}

/**
 * Optional sign-in, in the profile card of the menu: a player who signs in
 * with Discord, Google or a link sent by email keeps their name and
 * achievements for themselves, and may add the other ways to the same
 * account. Shows nothing when the server offers no way to sign in, or
 * cannot be reached: the game is played as a guest.
 */
export class AccountBox {
  readonly element = h("div", { class: "account", hidden: true, "aria-live": "polite" });
  /** Under the name field of the menu, while signed in: who, and the way out. */
  readonly line = h("p", { class: "account-line", hidden: true });
  private me: Me | undefined;
  private message: TextKey | undefined;
  /** The token of a sign-in link the player opened, until they finish or it fails. */
  private linkToken: string | undefined;
  private emailOpen = false;
  /** Kept across redraws, so that a language change does not erase what was typed. */
  private readonly emailInput = h("input", {
    type: "email",
    class: "account-email",
    autocomplete: "email",
    required: true,
    maxlength: 254,
    spellcheck: false,
  });
  /** Stops following the language once the menu is gone. */
  readonly dispose: () => void;

  /**
   * @param name the name field of the menu: signed in, it shows and renames the account.
   * @param setName tells the menu the name changed.
   * @param openCard opens the profile card the box is in.
   */
  constructor(
    private readonly name: HTMLInputElement,
    private readonly setName: (name: string) => void,
    private readonly openCard: () => void = () => {
      const card = this.element.closest("details");
      if (card) card.open = true;
    },
  ) {
    const query = new URLSearchParams(location.search);
    // The link of the email: its token stays out of the address bar and the history.
    const linked = /^#signin=([\w-]{20,64})$/.exec(location.hash);
    if (linked) {
      this.linkToken = linked[1];
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    }
    if (query.get("signin") === "failed") {
      this.message = "failed";
      query.delete("signin");
      const search = query.toString();
      history.replaceState(history.state, "", `${location.pathname}${search && `?${search}`}`);
    }
    name.addEventListener("change", () => {
      if (this.me?.account) void this.rename(name.value);
    });
    this.dispose = onLanguageChange(() => {
      this.show(this.me);
    });
    void this.load();
  }

  private async load(): Promise<void> {
    const me = await this.request("GET");
    if (me) this.show(me);
    if (me?.account) void syncAchievements();
  }

  /** Posts to a route of the sign-in by email; the answer's status, 0 when it failed. */
  private async post(path: string, body: unknown): Promise<Response | undefined> {
    try {
      return await fetch(new URL(path, location.href), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return undefined;
    }
  }

  private async sendLink(): Promise<void> {
    const adding = this.me?.account != null;
    const response = await this.post("auth/email", {
      email: this.emailInput.value,
      name: this.name.value,
      language: getLanguage(),
      ...(adding && { link: true }),
    });
    this.message =
      response?.status === 202
        ? adding
          ? "linkSentAdd"
          : "linkSent"
        : response?.status === 400
          ? "badEmail"
          : response?.status === 429
            ? "rate"
            : response?.status === 503
              ? "busy"
              : "failed";
    if (NOTES.has(this.message)) this.emailOpen = false;
    this.show(this.me);
  }

  private async finish(): Promise<void> {
    const response = await this.post("auth/email/confirm", { token: this.linkToken });
    this.linkToken = undefined;
    let me: unknown;
    try {
      me = response?.ok ? await response.json() : undefined;
    } catch {
      me = undefined;
    }
    if (isMe(me)) {
      this.message = undefined;
      this.show(me);
      void syncAchievements();
    } else {
      this.message =
        response?.status === 400 ? "expired" : response?.status === 403 ? "elsewhere" : "failed";
      this.show(this.me);
    }
  }

  /**
   * Sends a request to `/api/me`, under it or to `/auth/logout`; undefined
   * when it fails. A refusal leaves a word for the player: `refused` by
   * the answer's status.
   */
  private async request(
    method: "GET" | "POST" | "DELETE",
    path = "api/me",
    body?: unknown,
    refused: Partial<Record<number, TextKey>> = { 409: "taken", 400: "invalid" },
  ): Promise<Me | undefined> {
    try {
      const response = await fetch(new URL(path, location.href), {
        method,
        credentials: "same-origin",
        cache: "no-store",
        ...(body !== undefined && {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      });
      const word = refused[response.status];
      if (word) this.message = word;
      if (!response.ok) return undefined;
      const value: unknown = await response.json();
      return isMe(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private async rename(raw: string): Promise<void> {
    const me = await this.request("POST", "api/me", { name: raw });
    if (me) this.message = undefined;
    // A refused name goes back to the account's.
    this.show(me ?? this.me);
  }

  private async signOut(): Promise<void> {
    const me = await this.request("POST", "auth/logout");
    if (!me) return;
    // The account's name is no longer the player's to use as a guest.
    this.name.value = "";
    this.setName("");
    this.message = undefined;
    this.emailOpen = false;
    this.show(me);
  }

  private async remove(): Promise<void> {
    if (!confirm(text("deleteConfirm"))) return;
    const me = await this.request("DELETE");
    if (!me) return;
    this.name.value = "";
    this.setName("");
    this.show(me);
  }

  /** Goes to the service to add it to the account; it sends the player back to the menu. */
  private async addService(provider: Provider): Promise<void> {
    try {
      const response = await fetch(new URL(`auth/${provider}/link`, location.href), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = response.ok ? ((await response.json()) as { location?: unknown }) : {};
      if (typeof body.location === "string") {
        location.assign(body.location);
        return;
      }
    } catch {
      // Told below.
    }
    this.message = "failed";
    this.show(this.me);
  }

  private async removeMethod(method: Method): Promise<void> {
    const me = await this.request("POST", "api/me/unlink", { method }, { 409: "last" });
    if (me) this.message = undefined;
    this.show(me ?? this.me);
  }

  private async answerMerge(merge: boolean): Promise<void> {
    const me = await this.request("POST", "api/me/merge", { merge });
    this.show(me ?? this.me);
    if (me && merge) void syncAchievements();
  }

  private button(label: string, className: string, act: () => void): HTMLButtonElement {
    const button = h("button", { type: "button", class: className }, label);
    button.addEventListener("click", act);
    return button;
  }

  private show(me: Me | undefined): void {
    if (!me) return;
    this.me = me;
    const { account } = me;
    const email = me.email === true;
    this.element.hidden = me.providers.length === 0 && !account && !email;
    if (account) {
      this.name.value = account.name;
      this.setName(account.name);
    }
    this.showLine(account);
    const fr = getLanguage() === "fr";
    const legal = h(
      "p",
      { class: "account-legal" },
      h(
        "a",
        { href: fr ? "privacy.fr.html" : "privacy.html", target: "_blank", rel: "noopener" },
        text("privacy"),
      ),
      " · ",
      h(
        "a",
        { href: fr ? "terms.fr.html" : "terms.html", target: "_blank", rel: "noopener" },
        text("terms"),
      ),
    );
    this.element.replaceChildren(
      ...(account ? this.signedIn(me, account) : this.signedOut(me)),
      ...(email && this.emailOpen ? [this.emailForm()] : []),
      ...(this.linkToken ? [this.finishPrompt()] : []),
      ...(this.message
        ? [
            h(
              "p",
              { class: NOTES.has(this.message) ? "account-note" : "account-error" },
              text(this.message),
            ),
          ]
        : []),
      legal,
    );
  }

  /** The line under the name field: a signed-in player sees how, and can sign out at once. */
  private showLine(account: Me["account"]): void {
    this.line.hidden = !account;
    if (!account) {
      this.line.replaceChildren();
      return;
    }
    this.line.replaceChildren(
      text("line", { services: methodList(methodsOf(account)) }),
      " ",
      this.button(text("signOut"), "secondary account-sign-out", () => void this.signOut()),
      " ",
      this.button(text("manage"), "link", () => {
        this.openCard();
      }),
    );
  }

  private signedOut(me: Me): HTMLElement[] {
    return [
      h(
        "p",
        { class: "account-status" },
        text("offer"),
        " ",
        ...me.providers.map((provider) =>
          h(
            "a",
            { class: `account-sign-in ${provider}`, href: `./auth/${provider}` },
            logo(provider),
            h("span", {}, text("signInWith", { service: PROVIDER_NAMES[provider] })),
          ),
        ),
        ...(me.email === true && !this.emailOpen && !this.linkToken
          ? [this.emailButton(text("emailOpen"))]
          : []),
      ),
    ];
  }

  private signedIn(me: Me, account: NonNullable<Me["account"]>): HTMLElement[] {
    const methods = methodsOf(account);
    const parts: HTMLElement[] = [
      h(
        "p",
        { class: "account-status" },
        text("signedIn", { name: account.name, services: methodList(methods) }),
      ),
    ];
    if (account.merge) {
      // The profile card opens to show the question.
      this.openCard();
      parts.push(
        h(
          "div",
          { class: "account-merge", role: "group", "aria-label": text("mergeYes") },
          h(
            "p",
            {},
            text("mergeAsk", {
              other: account.merge.name,
              services: methodList(account.merge.methods),
              name: account.name,
            }),
          ),
          h(
            "p",
            { class: "account-actions" },
            this.button(text("mergeYes"), "primary", () => void this.answerMerge(true)),
            this.button(text("mergeNo"), "secondary", () => void this.answerMerge(false)),
          ),
        ),
      );
    }
    parts.push(
      h(
        "p",
        { class: "account-actions" },
        this.button(text("signOut"), "secondary", () => void this.signOut()),
        this.button(text("delete"), "link", () => void this.remove()),
      ),
    );
    if (methods.length > 1)
      parts.push(
        h(
          "p",
          { class: "account-methods" },
          text("methods"),
          ...methods.flatMap((method) => [
            " ",
            this.button(
              text("removeMethod", { service: methodName(method) }),
              "link",
              () => void this.removeMethod(method),
            ),
          ]),
        ),
      );
    const missing = me.providers.filter((provider) => !methods.includes(provider));
    const addEmail = me.email === true && !methods.includes("email");
    // Older servers cannot add a way to an account: they tell no methods.
    if (account.methods && (missing.length > 0 || addEmail))
      parts.push(
        h(
          "p",
          { class: "account-add" },
          text("add"),
          " ",
          ...missing.map((provider) => {
            const add = h(
              "button",
              { type: "button", class: `account-sign-in ${provider}` },
              logo(provider),
              h("span", {}, text("addWith", { service: PROVIDER_NAMES[provider] })),
            );
            add.addEventListener("click", () => void this.addService(provider));
            return add;
          }),
          ...(addEmail && !this.emailOpen ? [this.emailButton(text("addEmail"))] : []),
        ),
      );
    return parts;
  }

  private emailButton(label: string): HTMLButtonElement {
    const open = h("button", { type: "button", class: "account-sign-in email" }, label);
    open.addEventListener("click", () => {
      this.emailOpen = true;
      this.message = undefined;
      this.show(this.me);
      this.emailInput.focus();
    });
    return open;
  }

  private emailForm(): HTMLFormElement {
    this.emailInput.setAttribute("aria-label", text("emailLabel"));
    this.emailInput.placeholder = text("emailLabel");
    const form = h(
      "form",
      { class: "account-email-form" },
      this.emailInput,
      h("button", { type: "submit", class: "secondary" }, text("emailSend")),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.sendLink();
    });
    return form;
  }

  /** Finishing takes a press: a mail filter that opens links must not sign anyone in. */
  private finishPrompt(): HTMLParagraphElement {
    // In the profile card of the menu, which opens to show it.
    this.openCard();
    const finish = h("button", { type: "button", class: "primary" }, text("finish"));
    finish.addEventListener("click", () => void this.finish());
    return h("p", { class: "account-finish" }, text("finishPrompt"), " ", finish);
  }
}

/**
 * Sends the achievements of this device to the account and keeps what comes
 * back: those earned elsewhere join them. Nothing is lost either way, and a
 * failure leaves them as they were.
 */
async function syncAchievements(): Promise<void> {
  try {
    const response = await fetch(new URL("api/me/achievements", location.href), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(deviceAchievements()),
    });
    if (!response.ok) return;
    const kept = (await response.json()) as Partial<SavedAchievements> | null;
    if (typeof kept?.earned === "object" && typeof kept.counts === "object")
      absorbAchievements({ earned: kept.earned, counts: kept.counts });
  } catch {
    // Kept on this device; the next menu tries again.
  }
}
