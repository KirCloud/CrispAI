import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  chatwootChannel,
  chatwootProjectOf,
  chatwootSessionId,
  isChatwoot,
  parseChatwootSession,
} from "../src/utils/conversation-id";
import {
  chatwootJobs,
  verifyChatwootSignature,
} from "../src/services/chatwoot-events.service";
import {
  createChatwootBindings,
  type ChatwootBinding,
} from "../src/services/chatwoot-binding.service";
import {
  chatwootLastMessageAt,
  chatwootMetaLines,
  chatwootPageLines,
  createChatwootAPI,
  pickerOptionOf,
  pickerValue,
} from "../src/services/chatwoot-api.service";
import { createChatwootRoutes } from "../src/api/chatwoot.controller";

const project = "8b0f8c3e-5a3f-4c41-9d1c-2f6f3f3b9a10";
const session = chatwootSessionId(project, 1, 42);
const binding: ChatwootBinding = {
  enabled: true,
  baseUrl: "https://chat.example",
  inboxId: null,
  botToken: "bot-token-secret",
  webhookSecret: "hook-secret",
};

test("Chatwoot ids never collide with Crisp ids and round-trip", () => {
  expect(isChatwoot(session)).toBe(true);
  expect(isChatwoot("session_0b2f")).toBe(false);
  expect(parseChatwootSession(session)).toEqual({
    project,
    account: 1,
    conversation: 42,
  });
  expect(session.replace("session_", "")).toBe(session);
  expect(chatwootProjectOf(chatwootChannel(project))).toBe(project);
  for (const bad of [
    "chatwoot:not-a-uuid",
    `chatwoot:${project}:0:1`,
    `chatwoot:${project}:1:2:3`,
    project,
  ])
    expect(parseChatwootSession(bad)).toBeNull();
  expect(chatwootProjectOf("chatwoot:'; drop table project")).toBeNull();
});

test("webhook signatures cover the raw body and a fresh timestamp", () => {
  const body = '{"event":"message_created"}';
  const now = 1_800_000_000_000;
  const timestamp = String(now / 1000);
  const sign = (secret: string, ts = timestamp, raw = body) =>
    "sha256=" + createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  const ok = { secret: "hook-secret", timestamp, body, now };
  expect(verifyChatwootSignature({ ...ok, signature: sign("hook-secret") })).toBe(true);
  expect(verifyChatwootSignature({ ...ok, signature: sign("other") })).toBe(false);
  expect(
    verifyChatwootSignature({ ...ok, body: body + " ", signature: sign("hook-secret") }),
  ).toBe(false);
  const stale = String(now / 1000 - 301);
  expect(
    verifyChatwootSignature({ ...ok, timestamp: stale, signature: sign("hook-secret", stale) }),
  ).toBe(false);
  expect(verifyChatwootSignature({ ...ok, signature: undefined })).toBe(false);
  expect(verifyChatwootSignature({ ...ok, secret: "", signature: sign("") })).toBe(false);
});

const message = (patch: Record<string, unknown>) => ({
  event: "message_created",
  id: 900,
  account: { id: 1 },
  inbox: { id: 7 },
  conversation: { id: 42 },
  created_at: "2026-11-27T00:00:00Z",
  content_type: "text",
  private: false,
  ...patch,
});

test("visitor, agent and bot messages map to the Crisp job shapes", () => {
  const website_id = chatwootChannel(project);
  expect(
    chatwootJobs(project, message({ message_type: "incoming", content: "hi", sender: {} }), null),
  ).toEqual([
    {
      kind: "visitor",
      data: {
        website_id,
        session_id: session,
        timestamp: "2026-11-27T00:00:00Z",
        type: "text",
        content: "hi",
        fingerprint: "chatwoot:900",
      },
    },
  ]);
  const withImage = chatwootJobs(
    project,
    message({
      message_type: "incoming",
      content: null,
      attachments: [
        { id: 5, file_type: "image", content_type: "image/png", data_url: "https://chat.example/a.png" },
      ],
    }),
    null,
  );
  expect(withImage).toHaveLength(1);
  expect(withImage[0]!.data).toMatchObject({
    type: "file",
    content: { type: "image/png", url: "https://chat.example/a.png" },
    fingerprint: "chatwoot:900:5",
  });
  expect(
    chatwootJobs(project, message({ message_type: "outgoing", sender: { type: "user" } }), null),
  ).toEqual([{ kind: "operator", data: { website_id, session_id: session, user: {} } }]);
  for (const ignored of [
    message({ message_type: "outgoing", sender: { type: "agent_bot" } }),
    message({ message_type: "outgoing", sender: { type: "user" }, private: true }),
    message({ message_type: "template", content: "csat" }),
    message({ message_type: "incoming", content: "  " }),
    message({ message_type: "incoming", content: "x", account: {} }),
    { event: "conversation_status_changed", account: { id: 1 }, id: 42 },
  ])
    expect(chatwootJobs(project, ignored, null)).toEqual([]);
  expect(
    chatwootJobs(project, message({ message_type: "incoming", content: "hi" }), 8),
  ).toEqual([]);
});

test("a clicked input_select becomes the Crisp picker payload", () => {
  const items = [
    { title: "A", value: pickerValue("opt-1", 0) },
    { title: "B", value: pickerValue("opt-1", 1) },
  ];
  const [job] = chatwootJobs(
    project,
    message({
      event: "message_updated",
      message_type: "outgoing",
      content_type: "input_select",
      sender: { type: "agent_bot" },
      content_attributes: { items, submitted_values: [items[1]] },
    }),
    null,
  );
  expect(job).toEqual({
    kind: "picker",
    key: `${project}:900`,
    data: {
      website_id: chatwootChannel(project),
      session_id: session,
      content: {
        id: "opt-1",
        choices: [
          { value: items[0]!.value, label: "A", selected: false },
          { value: items[1]!.value, label: "B", selected: true },
        ],
      },
    },
  });
  expect(pickerOptionOf("no-separator")).toBe("");
  expect(
    chatwootJobs(
      project,
      message({
        event: "message_updated",
        content_type: "input_select",
        sender: { type: "agent_bot" },
        content_attributes: { items },
      }),
      null,
    ),
  ).toEqual([]);
});

test("widget opens greet in the open conversation or start a new one", () => {
  const opened = {
    event: "webwidget_triggered",
    id: 31,
    account: { id: 1 },
    inbox: { id: 7 },
    source_id: "src-1",
  };
  expect(
    chatwootJobs(project, { ...opened, current_conversation: { id: 42, status: "pending" } }, null),
  ).toEqual([
    {
      kind: "intro",
      key: `${project}:31`,
      data: { website_id: chatwootChannel(project), session_id: session },
    },
  ]);
  expect(
    chatwootJobs(project, { ...opened, current_conversation: { id: 42, status: "resolved" } }, null),
  ).toEqual([
    {
      kind: "intro",
      key: `${project}:31`,
      data: {
        website_id: chatwootChannel(project),
        chatwoot: { account: 1, inbox: 7, sourceId: "src-1" },
      },
    },
  ]);
  expect(chatwootJobs(project, { ...opened, source_id: undefined }, null)).toEqual([]);
});

function bindings(initial?: ChatwootBinding) {
  const rows = new Map<string, ChatwootBinding>();
  if (initial) rows.set(project, initial);
  return {
    rows,
    service: createChatwootBindings({
      load: async (id) => rows.get(id) ?? null,
      save: async (id, value) => {
        rows.set(id, value);
      },
    }),
  };
}

test("binding secrets are masked, kept on blank input and dropped with a new address", async () => {
  const { rows, service } = bindings();
  await expect(service.save(project, { enabled: true, baseUrl: binding.baseUrl })).rejects.toThrow();
  const saved = await service.save(project, { ...binding, baseUrl: "https://chat.example/" });
  expect(saved).toEqual({
    enabled: true,
    baseUrl: "https://chat.example",
    inboxId: null,
    hasBotToken: true,
    hasWebhookSecret: true,
  });
  expect(JSON.stringify(await service.read(project))).not.toContain(binding.botToken);
  await service.save(project, { enabled: true, baseUrl: binding.baseUrl, inboxId: 7 });
  expect(rows.get(project)).toEqual({ ...binding, inboxId: 7 });
  await expect(
    service.save(project, { enabled: true, baseUrl: "https://other.example" }),
  ).rejects.toThrow();
  await service.save(project, { enabled: false, baseUrl: "https://other.example" });
  expect(rows.get(project)?.botToken).toBe("");
});

test("binding addresses must be HTTPS without credentials", async () => {
  const { service } = bindings();
  for (const baseUrl of [
    "http://chat.example",
    "https://user:pw@chat.example",
    "https://chat.example/?x=1",
    "not a url",
  ])
    await expect(
      service.save(project, { ...binding, baseUrl }),
    ).rejects.toThrow();
  await service.save(project, { ...binding, baseUrl: "http://127.0.0.1:3000" });
});

function api(current: ChatwootBinding | null = binding) {
  const calls: { method: string; url: string; body?: any; headers?: any }[] = [];
  const client = createChatwootAPI({
    binding: async () => current,
    http: {
      get: async (url, config) => {
        calls.push({ method: "GET", url, headers: config?.headers });
        return { data: { id: 42 } };
      },
      post: async (url, body, config) => {
        calls.push({ method: "POST", url, body, headers: config?.headers });
        return { data: { id: 77 } };
      },
    },
  });
  return { calls, client };
}

test("API calls target the account conversation with the bot token", async () => {
  const { calls, client } = api();
  const root = "https://chat.example/api/v1/accounts/1/conversations/42";
  await client.sendText(session, "hello");
  await client.sendOption(session, {
    id: "opt-1",
    text: "Pick one",
    options: [{ label: "A" }, { label: "B" }],
  });
  await client.sendOption(session, { id: "opt-2", text: "Nothing", options: [] });
  await client.typing(session, true);
  await client.handoff(session);
  expect(calls.map(({ url, body }) => ({ url, body }))).toEqual([
    { url: `${root}/messages`, body: { content: "hello", message_type: "outgoing" } },
    {
      url: `${root}/messages`,
      body: {
        content: "Pick one",
        message_type: "outgoing",
        content_type: "input_select",
        content_attributes: {
          items: [
            { title: "A", value: "opt-1:0" },
            { title: "B", value: "opt-1:1" },
          ],
        },
      },
    },
    { url: `${root}/messages`, body: { content: "Nothing", message_type: "outgoing" } },
    { url: `${root}/toggle_typing_status`, body: { typing_status: "on" } },
    { url: `${root}/toggle_status`, body: { status: "open" } },
  ]);
  expect(calls.every((call) => call.headers?.api_access_token === binding.botToken)).toBe(true);

  await client.sendFile(session, { name: "a.png", data: new Uint8Array([1, 2]), type: "image/png" });
  const form = calls.at(-1)!.body as FormData;
  expect(form.get("message_type")).toBe("outgoing");
  expect((form.get("attachments[]") as File).name).toBe("a.png");

  expect(
    await client.startConversation(project, { account: 1, inbox: 7, sourceId: "src-1" }),
  ).toBe(chatwootSessionId(project, 1, 77));
  expect(calls.at(-1)).toMatchObject({
    url: "https://chat.example/api/v1/accounts/1/conversations",
    body: { inbox_id: 7, source_id: "src-1" },
  });
});

test("API calls refuse disabled bindings and foreign session ids", async () => {
  const { calls, client } = api({ ...binding, enabled: false });
  await expect(client.sendText(session, "x")).rejects.toThrow();
  await expect(api().client.sendText("session_abc", "x")).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("Telegram card lines escape visitor data and link the conversation", () => {
  const conversation = {
    meta: {
      sender: {
        name: "<b>Eve</b>",
        email: "eve@example.com",
        additional_attributes: { country: "Japan", city: "Tokyo" },
        custom_attributes: { plan: "Pro" },
      },
    },
    additional_attributes: {
      browser: { platform_name: "macOS", browser_name: "Chrome" },
      referer: 'https://site.example/a?b="c"',
    },
    messages: [{ created_at: 1_800_000_000 }],
  };
  const lines = chatwootMetaLines(conversation, "https://chat.example/app/accounts/1/conversations/42");
  expect(lines[0]).toBe("👤<b>用户</b>：<code>&lt;b&gt;Eve&lt;/b&gt;</code>");
  expect(lines).toContain("📍<b>地理位置</b>：Japan Tokyo");
  expect(lines).toContain('<pre>{&quot;plan&quot;:&quot;Pro&quot;}</pre>');
  expect(lines.at(-1)).toContain('href="https://chat.example/app/accounts/1/conversations/42"');
  expect(chatwootPageLines(conversation).at(-1)).toContain("&quot;c&quot;");
  expect(chatwootPageLines({ additional_attributes: { referer: "javascript:x" } })).toEqual([]);
  expect(chatwootMetaLines({})).toEqual([]);
  expect(chatwootLastMessageAt(conversation)).toBe(1_800_000_000_000);
  expect(chatwootLastMessageAt({ messages: [] })).toBeNull();
});

test("binding routes show the webhook address but never the secrets", async () => {
  const { service } = bindings(binding);
  const routes = createChatwootRoutes(
    service,
    async (id) => id === project,
    () => "https://crispai.example/",
  );
  const read = await routes.request(`/?project_id=${project}`);
  const body: any = await read.json();
  expect(body.data.webhookUrl).toBe(`https://crispai.example/chatwoot/${project}`);
  expect(JSON.stringify(body)).not.toContain(binding.botToken);
  expect(JSON.stringify(body)).not.toContain(binding.webhookSecret);
  expect((await routes.request("/?project_id=8b0f8c3e-5a3f-4c41-9d1c-000000000000")).status).toBe(404);
  const invalid = await routes.request(`/?project_id=${project}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, baseUrl: "https://chat.example", inboxId: -1 }),
  });
  expect(invalid.status).toBe(400);
});
