import { test, expect } from "bun:test";
import {
  abuseIdentityKey,
  normalizeVisitorEmail,
  cooldownActive,
  ABUSE_COOLDOWN_MS,
  createAutomatedDeliveryGate,
} from "../src/services/abuse-identity.service";
test("email identity survives new windows, normalizes case and isolates sites without retaining raw email", () => {
  const a = abuseIdentityKey(
    "site-a",
    "session_1",
    "  User@Example.COM  ",
    "secret",
  );
  expect(a).toBe(
    abuseIdentityKey(
      "site-a",
      "different-window",
      "user@example.com",
      "secret",
    ),
  );
  expect(a).not.toContain("user@example.com");
  expect(a).not.toBe(
    abuseIdentityKey("site-b", "session_1", "user@example.com", "secret"),
  );
  expect(a).not.toBe(
    abuseIdentityKey("site-a", "session_1", "other@example.com", "secret"),
  );
  expect(abuseIdentityKey("site-a", "one", null, "secret")).not.toBe(
    abuseIdentityKey("site-a", "two", null, "secret"),
  );
  for (const value of [
    "not-email",
    "hello user@example.com",
    "a@b\nother",
    null,
  ])
    expect(normalizeVisitorEmail(value)).toBeNull();
});
test("cooldown expires exactly at its fixed deadline", () => {
  const start = 1_000_000,
    until = new Date(start + ABUSE_COOLDOWN_MS);
  expect(cooldownActive(until, start)).toBe(true);
  expect(cooldownActive(until, start + ABUSE_COOLDOWN_MS - 1)).toBe(true);
  expect(cooldownActive(until, start + ABUSE_COOLDOWN_MS)).toBe(false);
});
test("final delivery drops already generated refusals and all other output during cooldown with no fallback", async () => {
  let blocked = false;
  const delivered: string[] = [];
  const gate = createAutomatedDeliveryGate({
    identity: async () => "email:hash",
    lock: async (_w, _i, work) => work(),
    blocked: async () => blocked,
    warningAllowed: async (_w, _s, key) => key === "fresh-third",
  });
  let finish!: (value: string) => void;
  const generated = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const pending = (async () => {
    const text = await generated;
    return gate("site", "old-window", async () => {
      delivered.push(text);
    });
  })();
  blocked = true;
  finish("我不会回答你的问题");
  expect(await pending).toBe(false);
  expect(delivered).toEqual([]);
  expect(
    await gate("site", "new-window", async () => {
      delivered.push("new window reply");
    }),
  ).toBe(false);
  expect(
    await gate("site", "new-window", async () => {
      delivered.push("typing");
    }),
  ).toBe(false);
  expect(delivered).toEqual([]);
  expect(
    await gate(
      "site",
      "origin",
      async () => {
        delivered.push("third warning");
      },
      { warningKey: "fresh-third" },
    ),
  ).toBe(true);
  expect(
    await gate(
      "site",
      "origin",
      async () => {
        delivered.push("stale warning");
      },
      { warningKey: "stale" },
    ),
  ).toBe(false);
  expect(delivered).toEqual(["third warning"]);
  blocked = false;
  expect(
    await gate("site", "new-window", async () => {
      delivered.push("restored");
    }),
  ).toBe(true);
  expect(delivered).toEqual(["third warning", "restored"]);
});
test("an explicit human reply remains possible while automated output is suppressed", async () => {
  const gate = createAutomatedDeliveryGate({
    identity: async () => {
      throw new Error("must not resolve for human");
    },
    lock: async (_w, _i, work) => work(),
    blocked: async () => true,
    warningAllowed: async () => false,
  });
  let sent = false;
  expect(
    await gate(
      "site",
      "s",
      async () => {
        sent = true;
      },
      { human: true },
    ),
  ).toBe(true);
  expect(sent).toBe(true);
});
