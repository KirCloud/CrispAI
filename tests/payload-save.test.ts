import { Hono } from "hono";
import { expect, test } from "bun:test";
import { createPayloadSaveController } from "../src/api/payload.controller";
import type { AIConfig } from "../src/services/ai-config.service";
const project = "11111111-2222-4333-8444-555555555555";
function fixture(mode: "full" | "vector") {
  const config: AIConfig = {
    baseUrl: "https://chat.example/v1",
    apiKey: "",
    model: "chat",
    embeddingModel: mode === "vector" ? "embed" : "",
    knowledgeMode: mode,
  };
  let embeds = 0;
  let stored: unknown[] = [];
  const handler = createPayloadSaveController({
    project: async () => ({ id: project }),
    config: () => config,
    embed: async () => {
      embeds++;
      return Array(1536).fill(0.1);
    },
    update: async (...args) => {
      stored = args;
    },
    insert: async (...args) => {
      stored = args;
    },
  });
  const app = new Hono().post("/save", handler);
  const save = (editing = false) =>
    app.request("/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: project,
        payload_id: editing ? project : undefined,
        params: { name: "Tutorial", raw: "New content" },
      }),
    });
  return { save, state: () => ({ embeds, stored }) };
}
test("full mode can create and edit knowledge without credentials or embedding calls, invalidating any previous vector", async () => {
  const f = fixture("full");
  expect((await f.save()).status).toBe(200);
  expect(f.state()).toEqual({
    embeds: 0,
    stored: [project, "Tutorial", "New content", null],
  });
  expect((await f.save(true)).status).toBe(200);
  expect(f.state()).toEqual({
    embeds: 0,
    stored: [project, project, "Tutorial", "New content", null],
  });
});
test("vector mode still creates an embedding before saving knowledge", async () => {
  const f = fixture("vector");
  expect((await f.save()).status).toBe(200);
  expect(f.state().embeds).toBe(1);
  expect(f.state().stored[3]).toHaveLength(1536);
});
