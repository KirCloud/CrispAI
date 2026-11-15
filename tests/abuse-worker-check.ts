// Only run with a disposable *_test database and a dedicated Redis instance.
import assert from "node:assert/strict";
import { mock } from "bun:test";
assert(new URL(Bun.env.DATABASE_URL!).pathname.endsWith("_test"));
assert(Bun.env.REDIS_URL?.includes("crispai-abuse-redis-test"));
const sent: string[] = [],
  classifications: string[] = [];
let businessReplies = 0;
mock.module("@/services/crisp.service", () => ({
  composeMessage: async () => true,
  sendMessage: async (_w: string, _s: string, text: string) => {
    sent.push(text);
    return true;
  },
  sendOption: async () => {
    throw new Error("Option must not bypass ended state");
  },
  getMetas: async () => [],
  listPages: async () => [],
  getMessages: async () => [],
}));
mock.module("@/services/telegram.service", () => ({
  default: { api: {} },
  changeAI: () => ({}),
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
              const text = JSON.parse(
                input.messages.at(-1).content,
              ).visitorMessage;
              classifications.push(text);
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        directedAbuse: text === "ABUSE",
                      }),
                    },
                  },
                ],
              };
            }
            businessReplies++;
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
const { connection } = await import("../src/services/redis.service");
const task = (await import("../src/jobs/messageSend.task")).default;
const intro = (await import("../src/jobs/intro.task")).default;
const option = (await import("../src/jobs/messageUpdated.task")).default;
await db.migrate(1);
const project = crypto.randomUUID(),
  session = crypto.randomUUID(),
  other = crypto.randomUUID();
await db.default`insert into project(id,name,"websiteId",enabled,"enableAI","enableAIPic",options,payload) values (${project},'Abuse worker isolated test',${project},true,true,true,'{"type":"text","text":"welcome"}'::jsonb,'support')`;
await db.saveAppSetting("abuse_policy:" + project, { enabled: true });
await db.upsertSession({
  website_id: project,
  session_id: session,
  enable_reply: true,
  enable_time: new Date(),
  thread: [],
  group_id: -99331122,
  topic_id: 1234,
});
const run = (fingerprint: number, content: string, s = session) =>
  task.processor({
    id: String(fingerprint),
    data: {
      website_id: project,
      session_id: "session_" + s,
      type: "text",
      content,
      fingerprint,
    },
  });
try {
  await run(1, "ordinary complaint");
  assert.equal(businessReplies, 1);
  assert.equal(sent.length, 1);
  await run(2, "ABUSE");
  await run(2, "ABUSE");
  await run(3, "ABUSE");
  await run(4, "ABUSE");
  assert.deepEqual(
    sent.slice(1).map((t) => t.match(/第 ([123])\/3/)?.[1]),
    ["1", "2", "3"],
  );
  assert.equal((await db.getSession(session)).abuse_warning_count, 3);
  assert((await db.getSession(session)).abuse_ended_at);
  const afterThird = {
    sent: sent.length,
    classification: classifications.length,
    businessReplies,
  };
  await Promise.all([run(5, "ABUSE"), run(6, "hello")]);
  await task.processor({
    id: "image",
    data: {
      website_id: project,
      session_id: "session_" + session,
      type: "file",
      content: { type: "image/png", url: "https://example.test/image.png" },
    },
  });
  await intro.processor({
    data: { website_id: project, session_id: "session_" + session },
  });
  await option.processor({
    data: {
      website_id: project,
      session_id: "session_" + session,
      content: { id: "option" },
    },
  });
  assert.deepEqual(
    {
      sent: sent.length,
      classification: classifications.length,
      businessReplies,
    },
    afterThird,
  );
  await db.enableSessions([session]);
  assert.equal((await db.getSession(session)).enable_reply, false);
  await db.setSessionReplyByTopic(-99331122, 1234, true);
  assert.equal((await db.getSession(session)).abuse_warning_count, 0);
  await run(7, "hello");
  assert.equal(businessReplies, 2);
  await run(8, "hello", other);
  assert.equal(businessReplies, 3);
  console.log(
    "ABUSE_WORKER_1_2_3_WARNINGS_DEDUP_STOP_TEXT_IMAGE_OPTION_INTRO_NO_TIMER_RESET_AND_HUMAN_RESET_PASSED",
  );
  console.log(
    JSON.stringify({
      customerMessagesSent: false,
      externalCrispAndTelegramAPIsMocked: true,
      realPostgresAndRedis: true,
      classificationProviderMocked: true,
      warningTexts: sent.filter((t) => t.startsWith("第 ")),
    }),
  );
} finally {
  await db.deleteSessions([session, other]);
  await db.default`delete from project where id=${project}`;
  await db.default`delete from app_setting where key=${"abuse_policy:" + project}`;
  await Promise.all([
    task.queue.close(),
    intro.queue.close(),
    option.queue.close(),
  ]);
  await connection.quit();
  await db.default`delete from abuse_identity where website_id=${project}`;
  await db.default.close();
}
process.exit(0);
