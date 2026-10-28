import { z } from "zod";

const apiUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "请输入不含账号、查询参数或片段的 HTTP(S) API 地址");
const apiKey = z
  .string()
  .trim()
  .max(8192)
  .refine((value) => !/[\r\n]/.test(value), "密钥不能包含换行")
  .optional();
export const aiConfigSchema = z.object({
  baseUrl: apiUrl,
  apiKey,
  model: z.string().trim().min(1).max(200),
  embeddingModel: z.string().trim().max(200).default(""),
  embeddingBaseUrl: z.union([z.literal(""), apiUrl]).optional(),
  embeddingApiKey: apiKey,
  knowledgeMode: z.enum(["off", "full", "vector"]).optional(),
  knowledgeMaxChars: z.number().int().min(2000).max(64000).optional(),
});
export type AIConfig = Omit<z.infer<typeof aiConfigSchema>, "apiKey"> & {
  apiKey: string;
};
export type AIConfigInput = z.infer<typeof aiConfigSchema>;
export type AIConfigStore = {
  load: () => Promise<AIConfig | null>;
  save: (value: AIConfig) => Promise<void>;
};
export const hasAIKey = (value: string | undefined) =>
  Boolean(value && value !== "not-configured");
const normalizeUrl = (value: string) => value.replace(/\/+$/, "");
export function resolveEmbeddingConnection(config: AIConfig) {
  const baseUrl = normalizeUrl(config.embeddingBaseUrl || config.baseUrl);
  // A different provider must never receive the chat provider's credential.
  const sameProvider = baseUrl === normalizeUrl(config.baseUrl);
  const apiKey = config.embeddingApiKey || (sameProvider ? config.apiKey : "");
  if (!hasAIKey(apiKey)) throw new Error("请填写向量接口的独立 API 密钥");
  return { baseUrl, apiKey };
}
export const DEFAULT_KNOWLEDGE_MAX_CHARS = 16000;
export type KnowledgeMode = "off" | "full" | "vector";
// Existing embedding installations keep vector search; chat-only deployments
// can use synchronized documents immediately, without another provider.
export const getKnowledgeMode = (config: AIConfig): KnowledgeMode =>
  config.knowledgeMode ?? (config.embeddingModel ? "vector" : "full");
export const getKnowledgeMaxChars = (config: AIConfig) =>
  config.knowledgeMaxChars ?? DEFAULT_KNOWLEDGE_MAX_CHARS;
export function validateKnowledgeConfig(config: AIConfig) {
  if (getKnowledgeMode(config) !== "vector") return;
  if (!config.embeddingModel) throw new Error("向量模式需要选择向量模型");
  resolveEmbeddingConnection(config);
}
export class AIConfigManager {
  private config: AIConfig;
  private ready = false;
  private source: "environment" | "database" = "environment";
  private saving: Promise<unknown> = Promise.resolve();
  constructor(
    private store: AIConfigStore,
    defaults: AIConfig,
  ) {
    this.config = { ...defaults };
  }
  async initialize() {
    const saved = await this.store.load();
    if (saved) {
      const parsed = aiConfigSchema.parse(saved);
      this.config = { ...parsed, apiKey: parsed.apiKey || "" };
      this.source = "database";
    }
    this.ready = true;
  }
  current() {
    if (!this.ready) throw new Error("AI 配置尚未加载");
    return { ...this.config };
  }
  publicConfig() {
    const { apiKey, embeddingApiKey, ...config } = this.current();
    return {
      ...config,
      knowledgeMode: getKnowledgeMode({ ...config, apiKey, embeddingApiKey }),
      knowledgeMaxChars: getKnowledgeMaxChars({
        ...config,
        apiKey,
        embeddingApiKey,
      }),
      hasApiKey: hasAIKey(apiKey),
      hasEmbeddingApiKey: hasAIKey(embeddingApiKey),
      configured: hasAIKey(apiKey),
      source: this.source,
    };
  }
  resolve(input: AIConfigInput): AIConfig {
    const parsed = aiConfigSchema.parse(input);
    const current = this.current();
    return {
      ...parsed,
      ...(parsed.knowledgeMode !== undefined ||
      current.knowledgeMode !== undefined
        ? { knowledgeMode: parsed.knowledgeMode ?? current.knowledgeMode }
        : {}),
      ...(parsed.knowledgeMaxChars !== undefined ||
      current.knowledgeMaxChars !== undefined
        ? {
            knowledgeMaxChars:
              parsed.knowledgeMaxChars ?? current.knowledgeMaxChars,
          }
        : {}),
      baseUrl: normalizeUrl(parsed.baseUrl),
      apiKey: parsed.apiKey || current.apiKey,
      ...(parsed.embeddingBaseUrl !== undefined ||
      current.embeddingBaseUrl !== undefined
        ? {
            embeddingBaseUrl: normalizeUrl(
              parsed.embeddingBaseUrl ?? current.embeddingBaseUrl ?? "",
            ),
          }
        : {}),
      ...(parsed.embeddingApiKey !== undefined ||
      current.embeddingApiKey !== undefined
        ? {
            embeddingApiKey:
              parsed.embeddingApiKey || current.embeddingApiKey || "",
          }
        : {}),
    };
  }
  async save(input: AIConfigInput) {
    const save = this.saving
      .catch(() => {})
      .then(async () => {
        const config = this.resolve(input);
        validateKnowledgeConfig(config);
        await this.store.save(config);
        this.config = config;
        this.source = "database";
        return this.publicConfig();
      });
    this.saving = save;
    return save;
  }
}
