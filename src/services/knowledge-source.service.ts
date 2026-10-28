import { createHash } from "node:crypto";
import { z } from "zod";

export const sourceSchema = z.object({
  apiUrl: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.hash &&
          !url.search
        );
      } catch {
        return false;
      }
    }),
  authorization: z
    .string()
    .trim()
    .max(8192)
    .refine((value) => !/[\r\n]/.test(value))
    .optional(),
  docsUrl: z.string().trim().max(2048).url(),
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(15).max(10080),
});
export type SourceConfig = z.infer<typeof sourceSchema> & {
  lastAttempt?: string;
  lastSuccess?: string;
  lastMessage?: string;
};
export type SourceEntry = {
  key: string;
  hash: string;
  name: string;
  raw: string;
};
const plain = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
export function convertDocument(
  doc: { id: number | string; title: string; body: string },
  docsUrl: string,
): SourceEntry[] {
  const title = plain(doc.title);
  const body = plain(
    doc.body
      .replace(
        /<!--access start-->[\s\S]*?<!--access end-->/gi,
        "共享账号信息请有权限的用户在官网教程中实时查看，不提供或猜测账号密码。",
      )
      .replace(/<(style|script|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(
        /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_, href, text) =>
          /^https:\/\//.test(href) && !href.includes("{{")
            ? `${plain(text)}（${href}）`
            : "请在官网教程中使用本人账号的一键导入按钮。",
      )
      .replace(/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi, "")
      .replace(/\{\{[^}]+\}\}/g, "（请在官网查看本人订阅）"),
  ).replace(/\n{3,}/g, "\n\n");
  if (!title || !body) throw new Error("文档内容格式不正确");
  const chunks: string[] = [];
  let chunk = "";
  for (const section of body.split(/(?=^#{1,4} )/m)) {
    // Bound long paragraphs as well as normal Markdown sections.
    for (let offset = 0; offset < section.length; offset += 1500) {
      const part = section.slice(offset, offset + 1500);
      if (chunk && chunk.length + part.length > 1800) {
        chunks.push(chunk.trim());
        chunk = "";
      }
      chunk += part;
    }
  }
  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks.map((text, index) => {
    const name = title + (chunks.length > 1 ? ` · ${index + 1}` : "");
    const raw = `文档：${title}\n来源：${docsUrl}（文档 ID ${doc.id}）\n\n${text}\n\n以资料为参考；无法解决时联系人工客服。不要索取账号密码或订阅密钥。`;
    return {
      key: `v2board:${doc.id}:${index}`,
      hash: createHash("sha256")
        .update(name + "\n" + raw)
        .digest("hex"),
      name,
      raw,
    };
  });
}
export async function fetchSourceDocuments(
  config: SourceConfig,
): Promise<SourceEntry[]> {
  async function read(id?: string) {
    const url = new URL(config.apiUrl);
    if (id) url.searchParams.set("id", id);
    const response = await fetch(url, {
      headers: config.authorization
        ? { authorization: config.authorization }
        : {},
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new Error("读取文档接口失败，请检查来源地址和授权令牌");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("文档接口返回空响应");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 5 * 1024 * 1024) throw new Error("文档接口响应过大");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const list = await read();
  if (!Array.isArray(list.data) || list.data.length > 500)
    throw new Error("文档目录格式不正确");
  const entries: SourceEntry[] = [];
  for (const item of list.data) {
    if (item.show === 0) continue;
    if (!item || !["number", "string"].includes(typeof item.id))
      throw new Error("文档目录格式不正确");
    const detail = (await read(String(item.id))).data;
    if (
      !detail ||
      String(detail.id) !== String(item.id) ||
      typeof detail.title !== "string" ||
      typeof detail.body !== "string"
    )
      throw new Error("文档正文格式不正确");
    entries.push(...convertDocument(detail, config.docsUrl));
    if (entries.length > 2000) throw new Error("文档条目过多，请拆分来源");
  }
  return entries;
}
export function publicSource(config: SourceConfig | null) {
  if (!config) return null;
  const { authorization, ...safe } = config;
  return { ...safe, hasAuthorization: Boolean(authorization) };
}
