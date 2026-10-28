import OpenAI from "openai";
import {
  AIConfigManager,
  hasAIKey,
  type AIConfig,
} from "@/services/ai-config.service";
import { getAppSetting, saveAppSetting } from "@/services/db.service";

export const aiConfig = new AIConfigManager(
  {
    load: () => getAppSetting("ai"),
    save: (config) => saveAppSetting("ai", config),
  },
  {
    baseUrl: Bun.env.OPENAI_URL || "https://api.openai.com/v1",
    apiKey: Bun.env.OPENAI_KEY || "",
    model: Bun.env.OPENAI_MODEL || "gpt-4.1-nano",
    embeddingModel: Bun.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  },
);

export const createAIClient = (config: AIConfig) => {
  if (!hasAIKey(config.apiKey))
    throw new Error("请先在 AI 配置页填写 API 密钥");
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    timeout: 30_000,
    maxRetries: 1,
  });
};
export const createAIProvider = (manager: AIConfigManager) => {
  let cached: { config: AIConfig; client: OpenAI } | undefined;
  return () => {
    const config = manager.current();
    if (!cached || JSON.stringify(cached.config) !== JSON.stringify(config)) {
      cached = { config, client: createAIClient(config) };
    }
    return { ...config, client: cached.client };
  };
};
export const getAIProvider = createAIProvider(aiConfig);

export const createEmbedding = async (input: string) => {
  const { client, embeddingModel } = getAIProvider();
  const embedding = await client.embeddings.create({
    model: embeddingModel,
    input,
    encoding_format: "float",
  });
  const vector = embedding.data[0]?.embedding;
  if (vector?.length !== 1536 || !vector.every(Number.isFinite))
    throw new Error("知识库向量模型必须输出 1536 维向量");
  return vector;
};
