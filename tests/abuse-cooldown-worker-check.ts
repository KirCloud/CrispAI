// Disposable *_test database and dedicated Redis only. No customer API calls.
import assert from "node:assert/strict";
import { mock } from "bun:test";
assert(new URL(Bun.env.DATABASE_URL!).pathname.endsWith("_test"));
assert(Bun.env.REDIS_URL?.includes("crispai-abuse-redis-test"));
const posts: { session: string; content: any }[] = [],
  typing: any[] = [],
  emails = new Map<string, string>();
const forwarded: { type: string; content: string; topic: number }[] = [];
const topicControls: any[] = [];
let telegramSequence = 2000;
let modelCalls = 0,
  classifierCalls = 0;
let releaseSlow!: (value: any) => void, startSlow!: () => void;
const slowStarted = new Promise<void>((resolve) => (startSlow = resolve));
mock.module("axios", () => ({
  default: {
    create: () => ({
      interceptors: { response: { use: () => {} } },
      get: async (path: string) => ({
        data: {
          data: path.endsWith("/meta")
            ? { email: emails.get(path.split("/")[4]!) }
            : [],
        },
      }),
      post: async (path: string, body: any) => {
        posts.push({ session: path.split("/")[4]!, content: body.content });
        return { data: {} };
      },
      patch: async (path: string, body: any) => {
        typing.push({ path, body });
        return { data: {} };
      },
      head: async () => ({ status: 200 }),
    }),
    get: async () => ({ data: {} }),
  },
}));
mock.module("@/services/telegram.service", () => ({
  default: {
    api: {
      createForumTopic: async () => ({ message_thread_id: ++telegramSequence }),
      sendMessage: async (_group: number, text: string, options: any) => {
        forwarded.push({
          type: "text",
          content: text,
          topic: options.message_thread_id,
        });
        return { message_id: ++telegramSequence };
      },
      sendPhoto: async (_group: number, url: string, options: any) => {
        forwarded.push({
          type: "photo",
          content: url,
          topic: options.message_thread_id,
        });
        return { message_id: ++telegramSequence };
      },
      editMessageText: async () => {},
      editMessageReplyMarkup: async () => {},
    },
  },
  changeAI: (
    _group: number,
    topic: number,
    enabled: boolean,
    ended: boolean,
  ) => {
    topicControls.push({ topic, enabled, ended });
    return {};
  },
}));
mock.module("@/services/knowledge-runtime.service", () => ({
  getKnowledgeContext: async () => null,
}));
mock.module("@/services/openai.service", () => ({
  getAIProvider: () => ({
    model: "test",
    baseUrl: "http://test",
    knowledgeMode: "off",
    client: {
      chat: {
        completions: {
          create: async (input: any) => {
            if (input.response_format) {
              classifierCalls++;
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        directedAbuse:
                          JSON.parse(input.messages.at(-1).content)
                            .visitorMessage === "ABUSE",
                      }),
                    },
                  },
                ],
              };
            }
            modelCalls++;
            if (input.messages.at(-1).content === "SLOW") {
              startSlow();
              return new Promise((resolve) => (releaseSlow = resolve));
            }
            return {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "正常业务帮助",
                    refusal: null,
                  },
                },
              ],
            };
          },
        },
      },
    },
  }),
}));
const db = await import("../src/services/db.service");
const { abuseIdentityKey } =
  await import("../src/services/abuse-identity.service");
const crisp = await import("../src/services/crisp.service");
const { connection } = await import("../src/services/redis.service");
const task = (await import("../src/jobs/messageSend.task")).default;
const intro = (await import("../src/jobs/intro.task")).default;
const option = (await import("../src/jobs/messageUpdated.task")).default;
const received = (await import("../src/jobs/messageReceived.task")).default;
await db.migrate(1);
const project = crypto.randomUUID(),
  windows = Array.from({ length: 5 }, () => crypto.randomUUID());
const [a, b, c, d, e] = windows as [string, string, string, string, string];
for (const id of [a, b, c, d])
  emails.set(
    "session_" + id,
    id === a ? " User@Example.COM " : "user@example.com",
  );
emails.set("session_" + e, "another@example.com");
await db.default`insert into project(id,name,"websiteId","telegramId",enabled,"enableAI","enableAIPic",options,payload) values(${project},'Cooldown isolated worker check',${project},-99331123,true,true,true,'{"type":"text","text":"welcome"}'::jsonb,'support')`;
await db.saveAppSetting("abuse_policy:" + project, { enabled: true });
await db.upsertSession({
  website_id: project,
  session_id: a,
  enable_reply: true,
  enable_time: new Date(),
  thread: [],
  group_id: -99331123,
  topic_id: 1235,
  message_id: 1236,
});
const run = (fingerprint: number, content: string, session: string) =>
  task.processor({
    id: String(fingerprint),
    data: {
      website_id: project,
      session_id: "session_" + session,
      type: "text",
      content,
      fingerprint,
    },
  });
try {
  const pending = run(1, "SLOW", a);
  await slowStarted;
  await run(2, "ABUSE", b);
  await run(3, "ABUSE", c);
  await run(4, "ABUSE", b);
  assert.deepEqual(
    posts.map((p) => p.content.match(/第 ([123])\/3/)?.[1]),
    ["1", "2", "3"],
  );
  releaseSlow({
    choices: [
      {
        message: {
          role: "assistant",
          content: "我不会回答你的问题",
          refusal: null,
        },
      },
    ],
  });
  await pending;
  assert(
    !posts.some((p) => p.content.includes("我不会回答")),
    "Already generated refusal must be discarded",
  );
  assert(
    !(await db.getSession(a)).thread.some((m: any) =>
      String(m.content).includes("我不会回答"),
    ),
  );
  const subject = abuseIdentityKey(
    project,
    a,
    "user@example.com",
    "isolated-test-identity-key",
  );
  const deadline = (
    await db.default`select blocked_until from abuse_identity where website_id=${project} and identity_key=${subject}`
  )[0].blocked_until;
  const before = {
    posts: posts.length,
    modelCalls,
    classifierCalls,
    typing: typing.filter((p) => p.body.type === "start").length,
  };
  await run(5, "hello", d);
  await run(4, "ABUSE", b);
  await task.processor({
    id: "image",
    data: {
      website_id: project,
      session_id: "session_" + d,
      type: "file",
      content: { type: "image/png", url: "https://example.test/image.png" },
    },
  });
  const blockedWindow = await db.getSession(d);
  assert(
    blockedWindow.topic_id && blockedWindow.message_id,
    "Same-email window must create a Telegram support topic during cooldown",
  );
  assert(
    forwarded.some(
      (m) =>
        m.type === "text" &&
        m.topic === blockedWindow.topic_id &&
        m.content.includes("hello"),
    ),
    "Blocked visitor text must still reach Telegram",
  );
  assert(
    forwarded.some(
      (m) =>
        m.type === "photo" &&
        m.topic === blockedWindow.topic_id &&
        m.content === "https://example.test/image.png",
    ),
    "Blocked visitor image must still reach Telegram",
  );
  const initialControls = topicControls.find(
    (c) => c.topic === blockedWindow.topic_id,
  );
  assert(
    initialControls && !initialControls.enabled && initialControls.ended,
    "New blocked topic must display paused AI controls",
  );
  await intro.processor({
    data: { website_id: project, session_id: "session_" + d },
  });
  await option.processor({
    data: {
      website_id: project,
      session_id: "session_" + d,
      content: { id: "option" },
    },
  });
  assert.equal(
    await crisp.sendMessage(
      project,
      "session_" + d,
      "我不能回答你的问题",
      "bot",
      "",
    ),
    false,
  );
  assert.equal(
    await crisp.sendOption(
      project,
      "session_" + d,
      { id: "x", text: "picker", options: [] },
      "bot",
      "",
    ),
    false,
  );
  assert.equal(
    await crisp.composeMessage(project, "session_" + d, true),
    false,
  );
  assert.deepEqual(
    {
      posts: posts.length,
      modelCalls,
      classifierCalls,
      typing: typing.filter((p) => p.body.type === "start").length,
    },
    before,
  );
  assert.equal(
    new Date(
      (
        await db.default`select blocked_until from abuse_identity where website_id=${project} and identity_key=${subject}`
      )[0].blocked_until,
    ).getTime(),
    new Date(deadline).getTime(),
  );
  await run(6, "hello", e);
  assert.equal(
    posts.at(-1)!.session,
    "session_" + e,
    "Another email must not be blocked",
  );
  await db.updateSession(e, { enable_reply: false });
  const manualBefore = { posts: posts.length, modelCalls, classifierCalls };
  await run(61, "manually paused visitor text", e);
  assert(
    forwarded.some(
      (m) =>
        m.type === "text" && m.content.includes("manually paused visitor text"),
    ),
  );
  assert.deepEqual(
    { posts: posts.length, modelCalls, classifierCalls },
    manualBefore,
    "Manual AI pause must preserve forwarding without generating replies",
  );
  await db.default`update abuse_identity set blocked_until=now()-interval '1 second' where website_id=${project} and identity_key=${subject}`;
  await run(7, "hello", d);
  assert.equal(posts.at(-1)!.session, "session_" + d);
  assert.equal((await db.getSession(d)).abuse_warning_count, 0);
  await run(8, "ABUSE", d);
  assert(posts.at(-1)!.content.includes("1/3"));
  await db.setSessionReplyByTopic(-99331123, 1235, true);
  assert.equal(
    (
      await db.default`select warning_count from abuse_identity where website_id=${project} and identity_key=${subject}`
    )[0].warning_count,
    0,
  );
  console.log(
    "CROSS_WINDOW_EMAIL_COOLDOWN_SILENCE_INFLIGHT_REFUSAL_SUPPRESSION_TYPING_GATE_EXPIRY_AND_RESET_PASSED",
  );
  console.log(
    JSON.stringify({
      customerMessagesSent: false,
      realPostgresAndRedis: true,
      realCrispServiceAndDeliveryGate: true,
      httpTransportMocked: true,
      modelProviderMocked: true,
      suppressedGeneratedRefusal: true,
      blockedWindowNoModelCalls: true,
      fixedOneHourDeadline: true,
      expiryRestoresReplies: true,
      blockedTextAndImagesForwarded: true,
      blockedNewWindowTopicCreated: true,
      manualPauseStillForwards: true,
    }),
  );
} finally {
  await db.deleteSessions(windows);
  await db.default`delete from project where id=${project}`;
  await db.default`delete from app_setting where key=${"abuse_policy:" + project}`;
  await db.default`delete from abuse_identity where website_id=${project}`;
  await Promise.all([
    task.queue.close(),
    intro.queue.close(),
    option.queue.close(),
    received.queue.close(),
  ]);
  await connection.quit();
  await db.default.close();
}
process.exit(0);
