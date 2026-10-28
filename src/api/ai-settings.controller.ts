import { Hono } from "hono";
import OpenAI from "openai";
import { z } from "zod";
import {
  AIConfigManager,
  aiConfigSchema,
  hasAIKey,
  type AIConfig,
} from "@/services/ai-config.service";

export function createAISettingsRoutes(manager: AIConfigManager) {
  const routes = new Hono();
  routes.get("/", (c) => c.json({ data: manager.publicConfig() }));
  routes.put("/", async (c) => {
    const result = aiConfigSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!result.success)
      return c.json({ message: "请检查 API 地址、密钥和模型名称" }, 400);
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
      const status =
        error instanceof OpenAI.APIError ? error.status : undefined;
      const message =
        status === 401 || status === 403
          ? "API 认证失败，请检查密钥和权限"
          : status === 404
            ? "接口路径或模型不存在，请检查 API 地址和模型名称"
            : status === 429
              ? "服务商限流或额度不足，请稍后重试"
              : "连接测试失败，请检查地址、模型以及服务器到服务商的网络连接";
      return c.json({ message }, 502);
    }
  });
  return routes;
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
  const result = await client.embeddings.create({
    model: config.embeddingModel,
    input: "Connection test",
    encoding_format: "float",
  });
  const vector = result.data[0]?.embedding;
  if (vector?.length !== 1536 || !vector.every(Number.isFinite))
    throw new EmbeddingDimensionError();
  return vector.length;
}
