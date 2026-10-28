import { z } from "zod";

export const aiConfigSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, "请输入不含账号、查询参数或片段的 HTTP(S) API 地址"),
  apiKey: z
    .string()
    .trim()
    .max(8192)
    .refine((value) => !/[\r\n]/.test(value), "密钥不能包含换行")
    .optional(),
  model: z.string().trim().min(1).max(200),
  embeddingModel: z.string().trim().min(1).max(200),
});
export type AIConfig = Required<z.infer<typeof aiConfigSchema>>;
export type AIConfigInput = z.infer<typeof aiConfigSchema>;
export type AIConfigStore = {
  load: () => Promise<AIConfig | null>;
  save: (value: AIConfig) => Promise<void>;
};

export const hasAIKey = (value: string) =>
  Boolean(value && value !== "not-configured");

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
      this.config = aiConfigSchema.required().parse(saved);
      this.source = "database";
    }
    this.ready = true;
  }
  current() {
    if (!this.ready) throw new Error("AI 配置尚未加载");
    return { ...this.config };
  }
  publicConfig() {
    const { apiKey, ...config } = this.current();
    return {
      ...config,
      hasApiKey: hasAIKey(apiKey),
      configured: hasAIKey(apiKey),
      source: this.source,
    };
  }
  resolve(input: AIConfigInput) {
    const parsed = aiConfigSchema.parse(input);
    return {
      ...parsed,
      baseUrl: parsed.baseUrl.replace(/\/+$/, ""),
      apiKey: parsed.apiKey || this.current().apiKey,
    };
  }
  async save(input: AIConfigInput) {
    const save = this.saving
      .catch(() => {})
      .then(async () => {
        const config = this.resolve(input);
        await this.store.save(config);
        this.config = config;
        this.source = "database";
        return this.publicConfig();
      });
    this.saving = save;
    return save;
  }
}
