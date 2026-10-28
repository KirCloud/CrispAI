import type { Context } from "hono";
import z from "zod";
import * as db from "@/services/db.service";
import { createEmbedding, aiConfig } from "@/services/openai.service";
import logger from "@/services/logger.service";
import { validate } from "@/api/validator";

export const listSchema = validate(
  "query",
  z.object({ project_id: z.string().uuid() }),
);
export const listController = async (c: Context) => {
  return c.json({ data: await db.listPayloads(c.req.query("project_id")!) });
};

export const saveSchema = validate(
  "json",
  z.object({
    project_id: z.string().uuid(),
    payload_id: z.string().uuid().optional(),
    params: z.object({
      name: z.string().min(1),
      raw: z.string().min(1),
    }),
  }),
);
export const saveController = async (c: Context) => {
  const { project_id, params, payload_id } = await c.req.json();

  const project = await db.getProjectById(project_id);
  if (!project) return c.json({ message: "查询项目失败" }, 400);
  if (!aiConfig.current().embeddingModel)
    return c.json(
      {
        message:
          "使用知识库前请先在 AI 配置中启用并选择向量模型；普通文字回复无需配置",
      },
      400,
    );

  let embedding: number[] | undefined;
  try {
    embedding = await createEmbedding(params.raw);
  } catch {
    logger.error("生成知识库向量失败，请检查向量接口配置");
  }
  if (!embedding) {
    return c.json(
      { message: "生成向量失败，请检查向量接口配置及 1536 维输出" },
      502,
    );
  }

  if (payload_id) {
    await db.updatePayload(
      payload_id,
      project_id,
      params.name,
      params.raw,
      embedding,
    );
  } else {
    await db.insertPayload(project_id, params.name, params.raw, embedding);
  }
  return c.json({ message: "成功" });
};

export const deleteSchema = validate(
  "json",
  z.object({ payload_id: z.string().uuid() }),
);
export const deleteController = async (c: Context) => {
  const { payload_id } = await c.req.json();
  await db.deletePayload(payload_id);
  return c.json({ message: "删除成功" });
};
