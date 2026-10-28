import { expect, test } from "bun:test";
import {
  convertDocument,
  publicSource,
  type SourceConfig,
  type SourceEntry,
} from "../src/services/knowledge-source.service";
import { createKnowledgeSync } from "../src/services/knowledge-sync.service";
const config: SourceConfig = {
  apiUrl: "https://docs.example/knowledge/fetch",
  docsUrl: "https://docs.example/#/docs",
  authorization: "private-read-token",
  enabled: true,
  intervalMinutes: 60,
};
test("document normalization removes restricted credentials and dynamic subscriptions while preserving useful links", () => {
  const entries = convertDocument(
    {
      id: 1,
      title: "<i>Client</i>",
      body: '<!--access start-->private-account-password<!--access end-->\n<a href="https://docs.example/download">Download</a>\n<a href="client://{{subscribeUrl}}">Import</a><iframe src="https://private.example"></iframe>',
    },
    config.docsUrl,
  );
  expect(entries[0]!.raw).toContain("https://docs.example/download");
  for (const secret of [
    "private-account-password",
    "{{subscribeUrl}}",
    "private.example",
  ])
    expect(entries[0]!.raw).not.toContain(secret);
  expect(JSON.stringify(publicSource(config))).not.toContain(
    "private-read-token",
  );
  expect(
    convertDocument(
      { id: 2, title: "Long", body: "a".repeat(10_000) },
      config.docsUrl,
    ).every((entry) => entry.raw.length < 2200),
  ).toBe(true);
});
function fixture() {
  let saved = structuredClone(config),
    fail = false,
    fetches = 0,
    applies = 0;
  let entries: SourceEntry[] = convertDocument(
    { id: 1, title: "Tutorial", body: "First version" },
    config.docsUrl,
  );
  const rows = new Map<
    string,
    {
      id: string;
      project: string;
      raw: string;
      hash: string;
      vector?: number[];
    }
  >();
  const sync = createKnowledgeSync({
    load: async () => structuredClone(saved),
    save: async (_, value) => {
      saved = structuredClone(value);
    },
    list: async () => [{ project: "project", config: structuredClone(saved) }],
    fetch: async () => {
      fetches++;
      if (fail) throw new Error("private-read-token");
      return entries;
    },
    apply: async (_, values) => {
      applies++;
      for (const entry of values) {
        const row = rows.get(entry.key);
        if (row?.hash !== entry.hash)
          rows.set(entry.key, {
            id: entry.key,
            project: "project",
            raw: entry.raw,
            hash: entry.hash,
          });
      }
    },
    pending: async () => [...rows.values()].filter((row) => !row.vector),
    canEmbed: () => true,
    embed: async () => Array(1536).fill(0.1),
    update: async (entry, vector) => {
      rows.get(entry.id)!.vector = vector;
      return true;
    },
  });
  return {
    sync,
    state: () => ({ saved, fetches, applies }),
    fail: () => {
      fail = true;
    },
    change: () => {
      entries = convertDocument(
        { id: 1, title: "Tutorial", body: "Updated version" },
        config.docsUrl,
      );
    },
  };
}
test("source sync indexes only pending changes and interval scheduling persists across runs", async () => {
  const f = fixture();
  expect((await f.sync.run("project"))!.lastMessage).toContain("本次生成 1 条");
  expect((await f.sync.run("project"))!.lastMessage).toContain("本次生成 0 条");
  f.change();
  expect((await f.sync.run("project"))!.lastMessage).toContain("本次生成 1 条");
  await f.sync.tick();
  expect(f.state().fetches).toBe(3);
  expect(JSON.stringify(await f.sync.read("project"))).not.toContain(
    "private-read-token",
  );
});
test("failed downloads retain existing entries, sanitize errors and retain saved authorization", async () => {
  const f = fixture();
  await f.sync.run("project");
  f.fail();
  await expect(f.sync.run("project")).rejects.toThrow("同步失败");
  expect(f.state().applies).toBe(1);
  expect(JSON.stringify(await f.sync.read("project"))).not.toContain(
    "private-read-token",
  );
  await f.sync.save("project", { ...config, authorization: "" });
  expect(f.state().saved.authorization).toBe("private-read-token");
});

test("source fetch reads the directory and each article using Authorization without exposing response errors", async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      expect(request.headers.get("authorization")).toBe("source-test-token");
      const url = new URL(request.url);
      requests.push(url.search);
      return Response.json({
        data: url.searchParams.has("id")
          ? { id: 1, title: "Tutorial", body: "Updated instructions" }
          : [{ id: 1, show: 1 }],
      });
    },
  });
  try {
    const { fetchSourceDocuments } = await import(
      "../src/services/knowledge-source.service"
    );
    const entries = await fetchSourceDocuments({
      ...config,
      apiUrl: `http://127.0.0.1:${server.port}/knowledge/fetch`,
      authorization: "source-test-token",
    });
    expect(entries[0]!.raw).toContain("Updated instructions");
    expect(requests).toEqual(["", "?id=1"]);
  } finally {
    server.stop(true);
  }
});
