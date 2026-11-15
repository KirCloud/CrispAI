import { createHmac } from "node:crypto";
export const ABUSE_COOLDOWN_MS = 60 * 60 * 1000;
export function normalizeVisitorEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
    ? email
    : null;
}
export function abuseIdentityKey(
  website: string,
  session: string,
  email: unknown,
  secret: string,
) {
  const normalized = normalizeVisitorEmail(email);
  return (
    (normalized ? "email:" : "session:") +
    createHmac("sha256", secret)
      .update(
        JSON.stringify([
          website,
          normalized || session.replace(/^session_/, ""),
        ]),
      )
      .digest("hex")
  );
}
export const cooldownActive = (until: unknown, now = Date.now()) =>
  Boolean(until && new Date(until as string).getTime() > now);

// Every automated sender calls this after generation, directly at delivery.
// No fallback/refusal is substituted when the decision is to suppress output.
export function createAutomatedDeliveryGate(deps: {
  identity: (website: string, session: string) => Promise<string>;
  lock: <T>(
    website: string,
    identity: string,
    work: () => Promise<T>,
  ) => Promise<T>;
  blocked: (website: string, identity: string) => Promise<boolean>;
  warningAllowed: (
    website: string,
    session: string,
    key: string,
  ) => Promise<boolean>;
}) {
  return async (
    website: string,
    session: string,
    send: () => Promise<unknown>,
    options: { human?: boolean; warningKey?: string } = {},
  ) => {
    if (options.human) {
      await send();
      return true;
    }
    const identity = await deps.identity(website, session);
    return deps.lock(website, identity, async () => {
      if (await deps.blocked(website, identity)) {
        // Only the just-created third warning may announce the start of the
        // cooldown. Subsequent messages, including refusals, are silent.
        if (
          !options.warningKey ||
          !(await deps.warningAllowed(website, session, options.warningKey))
        )
          return false;
      } else if (
        options.warningKey &&
        !(await deps.warningAllowed(website, session, options.warningKey))
      )
        return false;
      await send();
      return true;
    });
  };
}
