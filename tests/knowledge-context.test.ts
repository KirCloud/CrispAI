import { expect, test } from "bun:test";
import {
  createKnowledgeContext,
  formatKnowledgeContext,
  withKnowledgeContext,
} from "../src/services/knowledge-context.service";
import {
  AIConfigManager,
  getKnowledgeMode,
  type AIConfig,
} from "../src/services/ai-config.service";
import { createAIProvider } from "../src/services/openai.service";
import type { ChatCompletionMessageParam } from "openai/resources";
const defaults: AIConfig = {
  baseUrl: "https://provider.example/v1",
  apiKey: "test",
  model: "chat",
  embeddingModel: "",
  knowledgeMode: "full",
  knowledgeMaxChars: 4000,
};
function fixture() {
  let raw = "Current setup instructions";
  const calls: string[] = [];
  const context = createKnowledgeContext({
    full: async (project, max) => {
      calls.push(`full:${project}:${max}`);
      return {
        documents: [
          { name: "Setup", raw },
          { name: "Troubleshooting", raw: "Restart the client" },
        ],
        total: 2,
      };
    },
    hasIndexed: async (project) => {
      calls.push(`indexed:${project}`);
      return true;
    },
    embed: async () => {
      calls.push("embed");
      return Array(1536).fill(0.1);
    },
    match: async (project, _vector, count) => {
      calls.push(`match:${project}:${count}`);
      return [{ name: "Match", raw: "Matched section" }];
    },
  });
  return {
    context,
    calls,
    change: () => {
      raw = "Updated instructions";
    },
  };
}
test("full mode reads all current project documents without an embedding model or provider call", async () => {
  const f = fixture();
  const context = await f.context("project-a", "How do I connect?", defaults);
  expect(context!.content).toContain("Current setup instructions");
  expect(context!.content).toContain("Restart the client");
  expect(context!.included).toBe(2);
  expect(context!.truncated).toBe(false);
  expect(f.calls).toEqual(["full:project-a:4000"]);
  f.change();
  expect(
    (await f.context("project-a", "Question", defaults))!.content,
  ).toContain("Updated instructions");
});
test("knowledge is added for this request only, before the user's question, without changing session history", () => {
  const history: ChatCompletionMessageParam[] = [
    { role: "system", content: "Support prompt" },
    { role: "user", content: "Question" },
  ];
  const context = formatKnowledgeContext(
    [{ name: "Tutorial", raw: "New content" }],
    1,
    2000,
  )!;
  const messages = withKnowledgeContext(history, context);
  expect(messages).toHaveLength(3);
  expect(messages[1]!.content).toContain("New content");
  expect(messages[2]).toEqual(history[1]);
  expect(history).toHaveLength(2);
  expect(JSON.stringify(history)).not.toContain("New content");
});
test("document titles, separators and truncation notice all stay inside the character budget", () => {
  const context = formatKnowledgeContext(
    [
      { name: "Large", raw: "😀".repeat(4000) },
      { name: "Omitted", raw: "Do not invent this" },
    ],
    2,
    2000,
  )!;
  expect(context.content.length).toBeLessThanOrEqual(2000);
  expect(context.content).toContain("部分内容已省略");
  expect(context.truncated).toBe(true);
  expect(context.content).not.toContain("Do not invent this");
  expect(context.content).not.toMatch(/[\uD800-\uDBFF]\n/);
  expect(formatKnowledgeContext([], 0, 2000)).toBe(null);
});
test("off mode does not read documents; vector mode uses matching with the existing model", async () => {
  const f = fixture();
  expect(
    await f.context("project", "Question", {
      ...defaults,
      knowledgeMode: "off",
    }),
  ).toBe(null);
  expect(f.calls).toHaveLength(0);
  const context = await f.context("project-b", "Question", {
    ...defaults,
    knowledgeMode: "vector",
    embeddingModel: "embedding",
  });
  expect(context!.content).toContain("Matched section");
  expect(f.calls).toEqual(["indexed:project-b", "embed", "match:project-b:3"]);
  expect(
    getKnowledgeMode({
      ...defaults,
      knowledgeMode: undefined,
      embeddingModel: "embedding",
    }),
  ).toBe("vector");
  expect(getKnowledgeMode({ ...defaults, knowledgeMode: undefined })).toBe(
    "full",
  );
});
test("the chat SDK receives document context and the final question through the chat endpoint only", async () => {
  const paths: string[] = [];
  let seen: any;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      paths.push(new URL(request.url).pathname);
      seen = await request.json();
      return Response.json({
        choices: [
          { message: { role: "assistant", content: "Restart the client" } },
        ],
      });
    },
  });
  try {
    const manager = new AIConfigManager(
      { load: async () => null, save: async () => {} },
      { ...defaults, baseUrl: `http://127.0.0.1:${server.port}/v1` },
    );
    await manager.initialize();
    const provider = createAIProvider(manager)();
    const f = fixture();
    const context = await f.context("project", "What should I do?", provider);
    await provider.client.chat.completions.create({
      model: provider.model,
      messages: withKnowledgeContext(
        [{ role: "user", content: "What should I do?" }],
        context,
      ),
    });
    expect(paths).toEqual(["/v1/chat/completions"]);
    expect(seen.messages[0].content).toContain("Restart the client");
    expect(seen.messages.at(-1).content).toBe("What should I do?");
  } finally {
    server.stop(true);
  }
});
