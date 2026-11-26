import {
  prepareAbuseIdentity,
  reserveIdentityWarning,
  mayDeliverWarning,
} from "../src/services/abuse-state.service";
import { abuseIdentityKey } from "../src/services/abuse-identity.service";
import { createAbusePolicyRoutes } from "../src/api/abuse-policy.controller";
import {
  readAbusePolicy,
  saveAbusePolicy,
} from "../src/services/abuse-runtime.service";
import { createSiteAPIRoutes } from "../src/api/site-api.controller";
import { siteAPISettings } from "../src/services/site-api-runtime.service";
// Run only against a disposable database whose name ends in _test.
import assert from "node:assert/strict";
import * as db from "../src/services/db.service";
import { Hono } from "hono";
import {
  migrate,
  getAppSetting,
  saveAppSetting,
} from "../src/services/db.service";
import {
  AIConfigManager,
  type AIConfig,
} from "../src/services/ai-config.service";
import { createAISettingsRoutes } from "../src/api/ai-settings.controller";
import { createAdminAuth } from "../src/services/admin-auth.service";
import {
  createConsoleRoutes,
} from "../src/services/console.service";

const database = new URL(
  Bun.env.DATABASE_URL || "postgres://localhost/missing",
);
assert(
  database.pathname.endsWith("_test"),
  "Use a disposable DATABASE_URL ending in _test",
);
await migrate(1);
const store = {
  load: () => getAppSetting("ai"),
  save: (value: AIConfig) => saveAppSetting("ai", value),
};
const defaults = {
  baseUrl: "https://provider.example/v1",
  apiKey: "",
  model: "before",
  embeddingModel: "embedding",
};
const manager = new AIConfigManager(store, defaults);
await manager.initialize();
const origin = "https://integration.example";
const auth = createAdminAuth({
  credentials: () => ({
    username: "integration",
    password: "integration-only",
  }),
  publicUrl: origin,
});
const app = new Hono();
app.route("/", createConsoleRoutes(auth));
app.use("/api/v1/*", auth.middleware);
app.route("/api/v1/settings/ai", createAISettingsRoutes(manager));
app.route(
  "/api/v1/site-api",
  createSiteAPIRoutes(siteAPISettings, db.getProjectById),
);
app.route(
  "/api/v1/settings/abuse",
  createAbusePolicyRoutes({
    exists: db.getProjectById,
    read: readAbusePolicy,
    save: saveAbusePolicy,
  }),
);
assert.equal((await app.request(origin + "/api/v1/settings/ai")).status, 401);
const login = await app.request(origin + "/api/auth/login", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({
    username: "integration",
    password: "integration-only",
  }),
});
assert.equal(login.status, 200);
const Cookie = login.headers.get("set-cookie")!.split(";")[0]!;
const headers = { Cookie, Origin: origin, "Content-Type": "application/json" };
const save = await app.request(origin + "/api/v1/settings/ai", {
  method: "PUT",
  headers,
  body: JSON.stringify({
    ...defaults,
    apiKey: "integration-secret",
    model: "after",
    knowledgeMode: "full",
    knowledgeMaxChars: 16000,
  }),
});
assert.equal(save.status, 200);
assert(!(await save.text()).includes("integration-secret"));
const restarted = new AIConfigManager(store, defaults);
await restarted.initialize();
assert.equal(restarted.current().model, "after");
assert.equal(restarted.current().apiKey, "integration-secret");
assert.equal(restarted.current().knowledgeMode, "full");
const read = await app.request(origin + "/api/v1/settings/ai", {
  headers: { Cookie },
});
assert.equal(read.status, 200);
assert(!(await read.text()).includes("integration-secret"));
for (const route of ["/dashboard", "/settings/ai"]) {
  const page = await app.request(origin + route, { headers: { Cookie } });
  assert.equal(page.status, 200);
  assert(page.headers.get("content-type")?.includes("text/html"));
}
assert.equal(
  (await app.request(origin + "/api/auth/logout", { method: "POST", headers }))
    .status,
  200,
);
assert.equal(
  (await app.request(origin + "/api/v1/settings/ai", { headers: { Cookie } }))
    .status,
  401,
);
const sql = db.default;
const project = crypto.randomUUID();
await sql`insert into project (id, name) values (${project}, 'Disposable integration test')`;
try {
  assert.equal(
    (await app.request(origin + "/api/v1/site-api?project_id=" + project))
      .status,
    401,
  );
  const siteSettings = await app.request(
    origin + "/api/v1/site-api?project_id=" + project,
    {
      method: "PUT",
      headers: {
        Authorization: "Basic " + btoa("integration:integration-only"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiBaseUrl: "https://api.example/api/v1",
        siteUrl: "https://site.example",
        authorization: "test-site-secret",
        enabled: true,
      }),
    },
  );
  assert.equal(siteSettings.status, 200);
  assert(!(await siteSettings.text()).includes("test-site-secret"));
  assert.equal(
    (await siteAPISettings.load(project))?.authorization,
    "test-site-secret",
  );
  assert.equal(await siteAPISettings.load(crypto.randomUUID()), null);
  console.log("POSTGRES_PROJECT_SITE_SETTINGS_PERSISTENCE_AND_AUTH_PASSED");
  const testSession = crypto.randomUUID();
  await db.upsertSession({
    website_id: project,
    session_id: testSession,
    group_id: -9988776655,
    topic_id: 445566,
    enable_reply: true,
    enable_time: new Date(),
    thread: [],
  });
  try {
    const firstWarning = await db.reserveAbuseWarning(
      project,
      testSession,
      "one",
    );
    assert.equal(firstWarning.warning_number, 1);
    await db.markAbuseWarningDelivered(project, testSession, "one");
    assert.equal(
      (await db.reserveAbuseWarning(project, testSession, "one"))
        .warning_number,
      1,
    );
    const parallel = await Promise.all(
      ["two", "three", "four"].map((key) =>
        db.reserveAbuseWarning(project, testSession, key),
      ),
    );
    assert.deepEqual(
      parallel
        .filter(Boolean)
        .map((r) => r.warning_number)
        .sort(),
      [2, 3],
    );
    assert.equal((await db.getSession(testSession)).abuse_warning_count, 3);
    assert((await db.getSession(testSession)).abuse_ended_at);
    assert.equal((await db.getSession(testSession)).enable_reply, false);
    assert.equal(
      await db.getAbuseWarning("another-website", testSession, "one"),
      null,
    );
    await db.enableSessions([testSession]);
    await db.setSessionReply(testSession, true);
    assert.equal((await db.getSession(testSession)).enable_reply, false);
    assert(
      !(await db.listDisabledSessions()).some(
        (s) => s.session_id === testSession,
      ),
    );
    await sql`update session set enable_time=now()-interval '60 days' where session_id=${testSession}`;
    assert(!(await db.deleteSessionsBefore(new Date())).includes(testSession));
    await db.setSessionReplyByTopic(-9988776655, 445566, true);
    assert.equal((await db.getSession(testSession)).abuse_warning_count, 0);
    assert.equal((await db.getSession(testSession)).abuse_ended_at, null);
    assert.equal((await db.getSession(testSession)).enable_reply, true);
    assert.equal(
      (await db.pendingAbuseWarnings(project, testSession)).length,
      0,
    );
    assert.equal(
      (await db.reserveAbuseWarning(project, testSession, "after-human-reset"))
        .warning_number,
      1,
    );
    await db.migrate(1);
    assert.equal((await db.getSession(testSession)).abuse_warning_count, 1);
    const abusePath = origin + "/api/v1/settings/abuse?project_id=" + project;
    assert.equal((await app.request(abusePath)).status, 401);
    const savedAbuse = await app.request(abusePath, {
      method: "PUT",
      headers: {
        Authorization: "Basic " + btoa("integration:integration-only"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(savedAbuse.status, 200);
    assert.equal((await readAbusePolicy(project)).enabled, true);
    console.log(
      "POSTGRES_ABUSE_COUNTER_CONCURRENCY_DEDUP_CUTOFF_TIMER_RESET_AND_POLICY_PERSISTENCE_PASSED",
    );
  } finally {
    await db.deleteSessions([testSession]);
    await sql`delete from abuse_identity where website_id=${project}`;
    await sql`delete from app_setting where key=${"abuse_policy:" + project}`;
  }
  const sameEmail = abuseIdentityKey(
    project,
    "first",
    "user@example.com",
    "test-secret",
  );
  const windows = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  for (const session_id of windows)
    await db.upsertSession({
      website_id: project,
      session_id,
      enable_reply: true,
      enable_time: new Date(),
      thread: [],
    });
  try {
    await prepareAbuseIdentity(project, windows[0]!, sameEmail);
    await reserveIdentityWarning(project, windows[0]!, "email-one");
    await db.markAbuseWarningDelivered(project, windows[0]!, "email-one");
    assert.equal(
      (await prepareAbuseIdentity(project, windows[1]!, sameEmail)).count,
      1,
    );
    await reserveIdentityWarning(project, windows[1]!, "email-two");
    await db.markAbuseWarningDelivered(project, windows[1]!, "email-two");
    await prepareAbuseIdentity(project, windows[2]!, sameEmail);
    await reserveIdentityWarning(project, windows[2]!, "email-three");
    assert(await mayDeliverWarning(project, windows[2]!, "email-three"));
    await db.markAbuseWarningDelivered(project, windows[2]!, "email-three");
    assert(!(await mayDeliverWarning(project, windows[2]!, "email-three")));
    const [[deadline]] = await Promise.all([
      sql`select blocked_until from abuse_identity where website_id=${project} and identity_key=${sameEmail}`,
    ]);
    const originalDeadline = new Date(deadline.blocked_until).getTime();
    assert(
      originalDeadline > Date.now() + 3590_000 &&
        originalDeadline <= Date.now() + 3600_000,
    );
    assert(
      (await prepareAbuseIdentity(project, windows[0]!, sameEmail)).blocked,
    );
    assert(
      (await prepareAbuseIdentity(project, windows[1]!, sameEmail)).blocked,
    );
    assert.equal(
      new Date(
        (
          await sql`select blocked_until from abuse_identity where website_id=${project} and identity_key=${sameEmail}`
        )[0].blocked_until,
      ).getTime(),
      originalDeadline,
      "Blocked messages must not extend the hour",
    );
    await db.updateSession(windows[1]!, { enable_reply: false });
    await sql`update abuse_identity set blocked_until=now()-interval '1 second' where website_id=${project} and identity_key=${sameEmail}`;
    const reopened = await prepareAbuseIdentity(
      project,
      windows[0]!,
      sameEmail,
    );
    assert(
      !reopened.blocked &&
        reopened.count === 0 &&
        reopened.session.enable_reply,
    );
    assert.equal(reopened.session.abuse_ended_at, null);
    assert.equal(
      (await prepareAbuseIdentity(project, windows[1]!, sameEmail)).session
        .enable_reply,
      false,
      "Preserve a human pause after cooldown expiry",
    );
    assert(!(await mayDeliverWarning(project, windows[2]!, "email-three")));
    assert.equal(
      (await db.pendingAbuseWarnings(project, windows[0]!)).length,
      0,
    );
    assert.equal(
      (await reserveIdentityWarning(project, windows[0]!, "after-hour"))
        .warning_number,
      1,
    );
    console.log(
      "POSTGRES_EMAIL_CROSS_SESSION_FIXED_ONE_HOUR_EXPIRY_RESET_AND_NO_STALE_WARNING_PASSED",
    );
  } finally {
    await db.deleteSessions(windows);
    await sql`delete from abuse_identity where website_id=${project}`;
  }
  const first = {
    key: "v2board:1:0",
    name: "Tutorial",
    raw: "First version",
    hash: "first",
  };
  await db.syncSourcePayloads(project, [first]);
  assert.equal(await db.hasPayload(project), false);
  assert.equal(
    (await db.listKnowledgeText(project, 16000)).documents[0]?.raw,
    "First version",
  );
  assert.equal(
    (await db.listKnowledgeText(crypto.randomUUID(), 16000)).total,
    0,
  );
  const entry = (await db.listPendingSourcePayloads(project))[0]!;
  const vector = Array(1536).fill(0.1);
  assert.equal(await db.updatePayloadVector(entry, vector), true);
  await db.syncSourcePayloads(project, [first]);
  assert.equal((await db.listPendingSourcePayloads(project)).length, 0);
  await sql`update payload set raw = 'Manual draft' where id = ${entry.id}`;
  await db.syncSourcePayloads(project, [first]);
  const restored = (await db.listPendingSourcePayloads(project))[0]!;
  assert.equal(restored.raw, "First version");
  assert.equal(await db.updatePayloadVector(restored, vector), true);
  assert.equal(
    (await db.matchPayloads(project, vector, 3))[0].raw,
    "First version",
  );
  await db.syncSourcePayloads(project, [
    { ...first, raw: "Updated version", hash: "second" },
  ]);
  assert.equal(await db.updatePayloadVector(entry, vector), false);
  assert.equal((await db.listPendingSourcePayloads(project)).length, 1);
  await db.syncSourcePayloads(project, []);
  assert.equal((await db.listKnowledgeStatus(project)).length, 0);
  assert.equal((await db.listPayloads(project)).length, 0);
  assert.equal((await db.listPayloadsWithVector(project)).length, 0);
  assert.equal((await db.listKnowledgeText(project, 16000)).total, 0);
  await db.insertPayload(project, "Long article", "a".repeat(20000), null);
  const bounded = await db.listKnowledgeText(project, 2000);
  assert.equal(bounded.total, 1);
  assert.equal(bounded.documents[0]!.raw.length, 2000);
  assert.equal(
    (await sql`select id from payload where project = ${project}`).length,
    2,
  );
} finally {
  await sql`delete from app_setting where key = ${"site_api:" + project}`;
  await sql`delete from project where id = ${project}`;
  await sql.close();
}
console.log("POSTGRES_SOURCE_UPDATES_ARCHIVAL_AND_VECTOR_RETRIEVAL_PASSED");
console.log("POSTGRES_CONFIG_PERSISTENCE_AND_AUTH_ROUTES_PASSED");
process.exit(0);
