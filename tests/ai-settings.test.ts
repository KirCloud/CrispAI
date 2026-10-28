import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  AIConfigManager,
  aiConfigSchema,
  type AIConfig,
} from "../src/services/ai-config.service";
import { createAISettingsRoutes } from "../src/api/ai-settings.controller";
import { createAIProvider } from "../src/services/openai.service";

const defaults: AIConfig = {
  baseUrl: "https://provider.example/v1",
  apiKey: "original-secret",
  model: "chat-one",
  embeddingModel: "embedding-one",
};
async function fixture() {
  let stored: AIConfig | null = null;
  let fail = false;
  const store = {
    load: async () => stored,
    save: async (value: AIConfig) => {
      if (fail) throw new Error("database unavailable");
      stored = { ...value };
    },
  };
  const manager = new AIConfigManager(store, defaults);
  await manager.initialize();
  const app = new Hono().route("/settings", createAISettingsRoutes(manager));
  return {
    manager,
    app,
    store,
    fail: () => {
      fail = true;
    },
  };
}
const calls: { path: string; model: string; authorization: string | null }[] =
  [];
let dimensions = 1536;
let providerStatus = 200;
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const body = (await request.json()) as { model: string };
    const path = new URL(request.url).pathname;
    calls.push({
      path,
      model: body.model,
      authorization: request.headers.get("authorization"),
    });
    if (providerStatus !== 200)
      return Response.json(
        {
          error: {
            message: "DO-NOT-LEAK-api-key",
            type: "invalid_request_error",
          },
        },
        { status: providerStatus },
      );
    if (path.endsWith("/embeddings"))
      return Response.json({
        data: [{ embedding: Array(dimensions).fill(0.1), index: 0 }],
      });
    return Response.json({
      choices: [{ message: { role: "assistant", content: "OK" } }],
    });
  },
});
afterAll(() => provider.stop(true));

describe("global AI configuration", () => {
  test("saved settings switch the live SDK client, credentials and model without a restart", async () => {
    const { manager } = await fixture();
    const getProvider = createAIProvider(manager);
    const original = getProvider();
    expect(getProvider().client).toBe(original.client);
    await manager.save({
      ...defaults,
      baseUrl: `http://127.0.0.1:${provider.port}/v1`,
      apiKey: "runtime-secret",
      model: "runtime-model",
    });
    const current = getProvider();
    expect(current.client).not.toBe(original.client);
    calls.length = 0;
    await current.client.chat.completions.create({
      model: current.model,
      messages: [{ role: "user", content: "test" }],
    });
    expect(calls[0]!.model).toBe("runtime-model");
    expect(calls[0]!.authorization).toBe("Bearer runtime-secret");
  });
  test("API reads never return the secret, including after a save", async () => {
    const { app } = await fixture();
    const initial = await app.request("/settings");
    expect(await initial.text()).not.toContain("original-secret");
    const saved = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...defaults, apiKey: "new-secret" }),
    });
    const text = await saved.text();
    expect(saved.status).toBe(200);
    expect(text).not.toContain("new-secret");
    expect(JSON.parse(text).data.hasApiKey).toBe(true);
  });
  test("empty key retains the secret; changes persist across manager restarts", async () => {
    const { manager, store } = await fixture();
    await manager.save({
      ...defaults,
      apiKey: "",
      model: "chat-two",
      baseUrl: defaults.baseUrl + "/",
    });
    expect(manager.current().apiKey).toBe("original-secret");
    expect(manager.current().baseUrl).toBe(defaults.baseUrl);
    expect(manager.current().model).toBe("chat-two");
    const restarted = new AIConfigManager(store, {
      ...defaults,
      apiKey: "env-key",
    });
    await restarted.initialize();
    expect(restarted.current()).toEqual(manager.current());
    expect(restarted.publicConfig().source).toBe("database");
  });
  test("failed persistence leaves effective configuration unchanged", async () => {
    const { manager, fail } = await fixture();
    fail();
    await expect(
      manager.save({ ...defaults, model: "must-not-apply" }),
    ).rejects.toThrow();
    expect(manager.current()).toEqual(defaults);
  });
  test("serialized updates retain the newest secret when later edits leave it blank", async () => {
    const { manager } = await fixture();
    await Promise.all([
      manager.save({ ...defaults, apiKey: "rotated-secret" }),
      manager.save({ ...defaults, apiKey: "", model: "last-model" }),
    ]);
    expect(manager.current().apiKey).toBe("rotated-secret");
    expect(manager.current().model).toBe("last-model");
  });
  test("credentials in URLs and malformed endpoint protocols are rejected", () => {
    for (const baseUrl of [
      "file:///etc/passwd",
      "https://user:key@provider.example/v1",
      "https://provider.example/v1?api_key=secret",
      "https://provider.example/#fragment",
    ])
      expect(aiConfigSchema.safeParse({ ...defaults, baseUrl }).success).toBe(
        false,
      );
  });
  test("connection test uses draft parameters without saving and validates embedding size", async () => {
    const { app, manager } = await fixture();
    const body = {
      ...defaults,
      baseUrl: `http://127.0.0.1:${provider.port}/v1`,
      apiKey: "draft-secret",
      model: "draft-model",
      testEmbedding: true,
    };
    calls.length = 0;
    const response = await app.request("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { embeddingDimensions: number })
        .embeddingDimensions,
    ).toBe(1536);
    expect(calls.map((call) => call.path)).toEqual([
      "/v1/chat/completions",
      "/v1/embeddings",
    ]);
    expect(calls[0]!.model).toBe("draft-model");
    expect(calls[0]!.authorization).toBe("Bearer draft-secret");
    expect(manager.current()).toEqual(defaults);
    dimensions = 768;
    const mismatch = await app.request("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(mismatch.status).toBe(422);
    dimensions = 1536;
  });
  test("provider errors cannot echo API keys to the browser", async () => {
    const { app } = await fixture();
    providerStatus = 401;
    const response = await app.request("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...defaults,
        baseUrl: `http://127.0.0.1:${provider.port}/v1`,
      }),
    });
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(text).not.toContain("DO-NOT-LEAK");
    expect(text).not.toContain("original-secret");
    providerStatus = 200;
  });
});
