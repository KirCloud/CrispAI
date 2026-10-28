import { expect, test } from "bun:test";
import { createKnowledgeRoutes } from "../src/api/knowledge.controller";
const project = "11111111-2222-4333-8444-555555555555";
const id = "22222222-2222-4333-8444-555555555555";
function fixture() {
  let ready = true,
    changed = false,
    embeds = 0,
    updates = 0;
  const app = createKnowledgeRoutes({
    list: async () => [{ id, name: "Tutorial", indexed: false }],
    get: async () => ({
      id,
      project,
      name: "Tutorial",
      raw: "private teaching content",
    }),
    embed: async () => {
      embeds++;
      return Array(1536).fill(0.1);
    },
    ready: () => ready,
    update: async () => {
      updates++;
      return !changed;
    },
  });
  const index = (project_id = project) =>
    app.request("/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id, payload_id: id }),
    });
  return {
    app,
    index,
    notReady: () => {
      ready = false;
    },
    change: () => {
      changed = true;
    },
    counts: () => [embeds, updates],
  };
}
test("knowledge status excludes document content and indexing checks project ownership", async () => {
  const f = fixture();
  const response = await f.app.request(`/?project_id=${project}`);
  expect(await response.text()).not.toContain("private teaching content");
  expect((await f.index("33333333-2222-4333-8444-555555555555")).status).toBe(
    404,
  );
  expect(f.counts()).toEqual([0, 0]);
});
test("pending documents can be indexed without changing their text or project settings", async () => {
  const f = fixture();
  expect((await f.index()).status).toBe(200);
  expect(f.counts()).toEqual([1, 1]);
});
test("unconfigured providers and concurrent document changes fail without stale indexing", async () => {
  const f = fixture();
  f.notReady();
  expect((await f.index()).status).toBe(400);
  expect(f.counts()).toEqual([0, 0]);
  const changed = fixture();
  changed.change();
  expect((await changed.index()).status).toBe(409);
});
