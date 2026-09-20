import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: Bun.env.OPENAI_URL,
  apiKey: Bun.env.OPENAI_KEY,
});

// 对话模型，可换成任何 OpenAI 兼容接口支持的模型
export const CHAT_MODEL = Bun.env.OPENAI_MODEL || "gpt-4.1-nano";
// 向量模型。payload.vector 列固定 1536 维，换模型必须保证输出也是 1536 维
export const EMBEDDING_MODEL =
  Bun.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

export const createEmbedding = async (input: string) => {
  const embedding = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });
  return embedding.data[0]?.embedding;
};

export default openai;
