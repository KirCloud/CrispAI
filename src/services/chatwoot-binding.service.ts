import { z } from "zod";

export type ChatwootBinding = {
  enabled: boolean;
  baseUrl: string;
  inboxId: number | null;
  botToken: string;
  webhookSecret: string;
};

// The bot token travels to this address on every call, so plain HTTP is only
// accepted for a Chatwoot running on the same machine.
const acceptableBaseUrl = (value: string) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  } catch {
    return false;
  }
};

export const chatwootBindingSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().trim().max(300).refine(acceptableBaseUrl),
  inboxId: z.number().int().positive().nullable().optional(),
  botToken: z.string().trim().max(256).optional(),
  webhookSecret: z.string().trim().max(256).optional(),
});
export type ChatwootBindingInput = z.infer<typeof chatwootBindingSchema>;

export const publicChatwootBinding = (binding: ChatwootBinding | null) => ({
  enabled: Boolean(binding?.enabled),
  baseUrl: binding?.baseUrl ?? "",
  inboxId: binding?.inboxId ?? null,
  hasBotToken: Boolean(binding?.botToken),
  hasWebhookSecret: Boolean(binding?.webhookSecret),
});

const CACHE_MS = 10_000;

export function createChatwootBindings(store: {
  load: (project: string) => Promise<ChatwootBinding | null>;
  save: (project: string, binding: ChatwootBinding) => Promise<void>;
}) {
  const cache = new Map<
    string,
    { value: ChatwootBinding | null; until: number }
  >();
  const load = async (project: string) => {
    const hit = cache.get(project);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = (await store.load(project)) ?? null;
    cache.set(project, { value, until: Date.now() + CACHE_MS });
    return value;
  };
  return {
    load,
    read: async (project: string) => publicChatwootBinding(await load(project)),
    async save(project: string, input: ChatwootBindingInput) {
      const parsed = chatwootBindingSchema.parse(input);
      const previous = await store.load(project);
      const baseUrl = parsed.baseUrl.replace(/\/+$/, "");
      const keep = previous?.baseUrl === baseUrl;
      const binding: ChatwootBinding = {
        enabled: parsed.enabled,
        baseUrl,
        inboxId: parsed.inboxId ?? null,
        botToken: parsed.botToken || (keep ? previous?.botToken : "") || "",
        webhookSecret:
          parsed.webhookSecret || (keep ? previous?.webhookSecret : "") || "",
      };
      if (
        binding.enabled &&
        (!binding.baseUrl || !binding.botToken || !binding.webhookSecret)
      )
        throw new Error(
          "启用前请填写 Chatwoot 地址、机器人令牌和 Webhook 密钥；更换地址时需重新填写",
        );
      await store.save(project, binding);
      cache.delete(project);
      return publicChatwootBinding(binding);
    },
  };
}
