import { Hono } from "hono";
import OpenAI from "openai";
import { z } from "zod";
import {
  AIConfigManager,
  aiConfigSchema,
  hasAIKey,
  resolveEmbeddingConnection,
  type AIConfig,
} from "@/services/ai-config.service";

export function createAISettingsRoutes(manager: AIConfigManager) {
  const routes = new Hono();
  routes.get("/", (c) => c.json({ data: manager.publicConfig() }));
  routes.post("/models", async (c) => {
    const result = aiConfigSchema
      .pick({
        baseUrl: true,
        apiKey: true,
        embeddingBaseUrl: true,
        embeddingApiKey: true,
      })
      .extend({ target: z.enum(["chat", "embedding"]).default("chat") })
      .safeParse(await c.req.json().catch(() => null));
    if (!result.success)
      return c.json({ message: "请检查 API 地址和密钥" }, 400);
    const config = manager.resolve({ ...manager.current(), ...result.data });
    if (result.data.target === "chat" && !hasAIKey(config.apiKey))
      return c.json({ message: "请先填写 API 密钥" }, 400);
    let connection;
    try {
      connection =
        result.data.target === "embedding"
          ? resolveEmbeddingConnection(config)
          : config;
    } catch {
      return c.json({ message: "请填写向量接口的独立 API 密钥" }, 400);
    }
    try {
      const client = new OpenAI({
        baseURL: connection.baseUrl,
        apiKey: connection.apiKey,
        timeout: 20_000,
        maxRetries: 0,
      });
      const response = await client.models.list();
      if (!Array.isArray(response.data))
        return c.json({ message: "服务商返回的模型列表格式不正确" }, 502);
      const seen = new Set<string>();
      const models: { id: string; name: string }[] = [];
      for (const item of response.data.slice(0, 2000)) {
        if (
          !item ||
          typeof item.id !== "string" ||
          !item.id ||
          item.id.length > 200 ||
          seen.has(item.id) ||
          [config.apiKey, config.embeddingApiKey].some(
            (key) => key && item.id.includes(key),
          )
        )
          continue;
        seen.add(item.id);
        const name = (item as { name?: unknown }).name;
        models.push({
          id: item.id,
          name:
            typeof name === "string" &&
            name.length <= 200 &&
            ![config.apiKey, config.embeddingApiKey].some(
              (key) => key && name.includes(key),
            )
              ? name
              : item.id,
        });
      }
      models.sort((a, b) => a.id.localeCompare(b.id));
      return c.json({ data: models });
    } catch (error) {
      return c.json(
        {
          message: providerErrorMessage(
            error,
            "读取模型列表失败，请检查接口地址和服务商是否支持 /models",
          ),
        },
        502,
      );
    }
  });
  routes.put("/", async (c) => {
    const result = aiConfigSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!result.success)
      return c.json({ message: "请检查 API 地址、密钥和模型名称" }, 400);
    try {
      if (result.data.embeddingModel)
        resolveEmbeddingConnection(manager.resolve(result.data));
    } catch {
      return c.json({ message: "请填写向量接口的独立 API 密钥" }, 400);
    }
    try {
      return c.json({
        data: await manager.save(result.data),
        message: "AI 配置已保存并即时生效",
      });
    } catch {
      return c.json({ message: "保存失败，当前配置未变更，请稍后重试" }, 503);
    }
  });
  routes.post("/test", async (c) => {
    const schema = aiConfigSchema.extend({
      testEmbedding: z.boolean().optional(),
    });
    const result = schema.safeParse(await c.req.json().catch(() => null));
    if (!result.success)
      return c.json({ message: "请检查 API 地址、密钥和模型名称" }, 400);
    const config = manager.resolve(result.data);
    if (!hasAIKey(config.apiKey))
      return c.json({ message: "请先填写 API 密钥" }, 400);
    if (result.data.testEmbedding && !config.embeddingModel)
      return c.json({ message: "请先启用并选择知识库向量模型" }, 400);
    if (result.data.testEmbedding) {
      try {
        resolveEmbeddingConnection(config);
      } catch {
        return c.json({ message: "请填写向量接口的独立 API 密钥" }, 400);
      }
    }
    const start = Date.now();
    try {
      const dimensions = await testAIConnection(
        config,
        Boolean(result.data.testEmbedding),
      );
      return c.json({
        message: dimensions
          ? "对话与知识库向量模型测试通过"
          : "对话模型测试通过",
        latencyMs: Date.now() - start,
        embeddingDimensions: dimensions,
      });
    } catch (error) {
      if (error instanceof EmbeddingDimensionError)
        return c.json(
          { message: "对话连接成功，但向量维度不是 1536，请更换向量模型" },
          422,
        );
      // Provider errors can echo credentials or request content; return only a
      // status-based message, never the upstream response or exception text.
      return c.json(
        {
          message: providerErrorMessage(
            error,
            "连接测试失败，请检查地址、模型以及服务器到服务商的网络连接",
          ),
        },
        502,
      );
    }
  });
  return routes;
}

function providerErrorMessage(error: unknown, fallback: string) {
  const status = error instanceof OpenAI.APIError ? error.status : undefined;
  return status === 401 || status === 403
    ? "API 认证失败，请检查密钥和权限"
    : status === 404
      ? "接口路径或模型不存在，请检查 API 地址和模型名称"
      : status === 429
        ? "服务商限流或额度不足，请稍后重试"
        : fallback;
}

class EmbeddingDimensionError extends Error {}
export async function testAIConnection(config: AIConfig, embedding: boolean) {
  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    timeout: 20_000,
    maxRetries: 0,
  });
  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: "Reply with exactly OK." }],
  });
  if (!completion.choices[0]?.message?.content)
    throw new Error("Empty response");
  if (!embedding) return null;
  const connection = resolveEmbeddingConnection(config);
  const embeddingClient = new OpenAI({
    baseURL: connection.baseUrl,
    apiKey: connection.apiKey,
    timeout: 20_000,
    maxRetries: 0,
  });
  const result = await embeddingClient.embeddings.create({
    model: config.embeddingModel,
    input: "Connection test",
    encoding_format: "float",
  });
  const vector = result.data[0]?.embedding;
  if (vector?.length !== 1536 || !vector.every(Number.isFinite))
    throw new EmbeddingDimensionError();
  return vector.length;
}
