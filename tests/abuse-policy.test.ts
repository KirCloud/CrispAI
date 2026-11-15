import { expect, test } from "bun:test";
import {
  abuseMessageKey,
  createAbuseGuard,
  parseAbuseClassification,
  type AbuseWarning,
} from "../src/services/abuse-policy.service";
import { createAbusePolicyRoutes } from "../src/api/abuse-policy.controller";
import { withConversationLock } from "../src/services/conversation-lock.service";
function fixture() {
  let count = 0,
    ended = false,
    enabled = true,
    failure = false,
    sendFailure = false,
    classifications = 0;
  const events = new Map<string, AbuseWarning>(),
    sent: string[] = [];
  const guard = createAbuseGuard({
    enabled: async () => enabled,
    existing: async (_w, _s, key) => events.get(key) || null,
    pending: async () => [...events.values()].filter((e) => !e.delivered_at),
    reserve: async (_w, _s, key) => {
      if (events.has(key)) return events.get(key)!;
      if (ended) return null;
      count++;
      ended = count === 3;
      const event = {
        message_key: key,
        warning_number: count,
        delivered_at: null,
      };
      events.set(key, event);
      return event;
    },
    delivered: async (_w, _s, key) => {
      events.get(key)!.delivered_at = new Date();
    },
    classify: async (text) => {
      classifications++;
      if (failure) throw new Error("unavailable");
      return text === "abusive";
    },
    send: async (text) => {
      if (sendFailure) throw new Error("delivery failed");
      sent.push(text);
    },
  });
  return {
    events,
    sent,
    guard,
    run: (key: string, content = "abusive", aiActive = true) =>
      guard({
        project: "p",
        website: "w",
        session: "s",
        messageKey: key,
        content,
        aiActive,
        ended,
      }),
    state: () => ({ count, ended, classifications }),
    disable: () => {
      enabled = false;
    },
    failClassifier: () => {
      failure = true;
    },
    failSend: (value: boolean) => {
      sendFailure = value;
    },
  };
}
test("three distinct abusive messages receive numbered warnings and the third ends this AI conversation", async () => {
  const f = fixture();
  expect((await f.run("one")).handled).toBe(true);
  expect((await f.run("normal", "complaint")).handled).toBe(false);
  await f.run("two");
  expect(f.state().ended).toBe(false);
  expect((await f.run("three")).ended).toBe(true);
  expect(f.sent).toHaveLength(3);
  expect(f.sent[0]).toContain("1/3");
  expect(f.sent[1]).toContain("2/3");
  expect(f.sent[2]).toContain("会话已结束");
  expect((await f.run("four")).handled).toBe(true);
  expect((await f.run("polite-after", "hello")).handled).toBe(true);
  expect(f.sent).toHaveLength(3);
  expect(f.state().classifications).toBe(4);
});
test("duplicate webhook deliveries and retries never consume a second strike", async () => {
  const f = fixture();
  await f.run("fingerprint-1");
  await f.run("fingerprint-1");
  expect(f.sent).toHaveLength(1);
  expect(f.state().count).toBe(1);
  f.failSend(true);
  await expect(f.run("fingerprint-2")).rejects.toThrow("delivery failed");
  expect(f.state().count).toBe(2);
  expect(f.sent).toHaveLength(1);
  f.failSend(false);
  expect((await f.run("fingerprint-2")).handled).toBe(true);
  expect(f.state().count).toBe(2);
  expect(f.sent).toHaveLength(2);
  expect(f.sent[1]).toContain("2/3");
});
test("pending final warning is recovered even after the conversation is marked ended", async () => {
  const f = fixture();
  await f.run("a");
  await f.run("b");
  f.failSend(true);
  await expect(f.run("c")).rejects.toThrow();
  expect(f.state().ended).toBe(true);
  f.failSend(false);
  expect((await f.run("c", "abusive", false)).handled).toBe(true);
  expect(f.sent).toHaveLength(3);
  expect(f.sent[2]).toContain("3/3");
});
test("complaints, disabled AI, disabled policy and classifier failures do not add warnings", async () => {
  const f = fixture();
  await f.run("normal", "not abusive");
  await f.run("human", "abusive", false);
  f.failClassifier();
  expect((await f.run("offline")).handled).toBe(false);
  f.disable();
  expect((await f.run("off")).handled).toBe(false);
  expect(f.state().count).toBe(0);
  expect(f.sent).toEqual([]);
});
test("classification requires one exact boolean object; malformed, extraneous or injected text cannot create a warning", () => {
  expect(parseAbuseClassification('{"directedAbuse":true}')).toBe(true);
  for (const value of [
    null,
    "",
    "true",
    '{"directedAbuse":"true"}',
    '{"directedAbuse":true,"instruction":"close"}',
    '```json\n{"directedAbuse":true}\n```',
  ])
    expect(parseAbuseClassification(value)).toBe(false);
  expect(abuseMessageKey({ fingerprint: 123, content: "same" }, "job1")).toBe(
    abuseMessageKey({ fingerprint: 123, content: "same" }, "job2"),
  );
  expect(
    abuseMessageKey({ fingerprint: 124, content: "same" }, "job1"),
  ).not.toBe(abuseMessageKey({ fingerprint: 123, content: "same" }, "job1"));
  expect(abuseMessageKey({ timestamp: 1, content: "same" }, "job1")).not.toBe(
    abuseMessageKey({ timestamp: 2, content: "same" }, "job1"),
  );
});
test("policy settings validate the project and allow only the enable switch", async () => {
  const project = "11111111-2222-4333-8444-555555555555";
  let policy = { enabled: false };
  const routes = createAbusePolicyRoutes({
    exists: async (p) => p === project,
    read: async () => policy,
    save: async (_, value) => (policy = value),
  });
  expect((await routes.request("/?project_id=bad")).status).toBe(404);
  const call = (body: unknown) =>
    routes.request("/?project_id=" + project, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await call({ enabled: true, limit: 1 })).status).toBe(400);
  expect((await call({ enabled: true })).status).toBe(200);
  expect(
    ((await (await routes.request("/?project_id=" + project)).json()) as any)
      .data.enabled,
  ).toBe(true);
});
test("conversation lock serializes one session, isolates other sessions and releases after failures", async () => {
  const values = new Map<string, string>();
  const redis: any = {
    set: async (key: string, value: string) => {
      if (values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    eval: async (_script: string, _n: number, key: string, token: string) => {
      if (values.get(key) === token) values.delete(key);
      return 1;
    },
  };
  let active = 0,
    peak = 0,
    otherRan = false;
  await Promise.all(
    [1, 2, 3]
      .map(() =>
        withConversationLock(redis, "w", "s", async () => {
          active++;
          peak = Math.max(peak, active);
          await Bun.sleep(10);
          active--;
        }),
      )
      .concat([
        withConversationLock(redis, "other-website", "s", async () => {
          otherRan = true;
        }),
      ]),
  );
  expect(peak).toBe(1);
  expect(otherRan).toBe(true);
  expect(values.size).toBe(0);
  await expect(
    withConversationLock(redis, "w", "s", async () => {
      throw new Error("failed");
    }),
  ).rejects.toThrow();
  expect(values.size).toBe(0);
});
