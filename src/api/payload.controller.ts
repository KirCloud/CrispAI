import type { Context } from "hono";
import z from "zod";
import * as db from "@/services/db.service";
import { createEmbeddingFor, aiConfig } from "@/services/openai.service";
import { getKnowledgeMode } from "@/services/ai-config.service";
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
export const createPayloadSaveController =
  (
    deps = {
      project: db.getProjectById,
      config: () => aiConfig.current(),
      embed: createEmbeddingFor,
      update: db.updatePayload,
      insert: db.insertPayload,
    },
  ) =>
  async (c: Context) => {
    const { project_id, params, payload_id } = await c.req.json();

    const project = await deps.project(project_id);
    if (!project) return c.json({ message: "查询项目失败" }, 400);
    const config = deps.config();
    let embedding: number[] | null = null;
    if (getKnowledgeMode(config) === "vector") {
      if (!config.embeddingModel)
        return c.json({ message: "向量模式需要先配置向量模型" }, 400);
      try {
        embedding = await deps.embed(config, params.raw);
      } catch {
        logger.error("生成知识库向量失败，请检查向量接口配置");
        return c.json(
          { message: "生成向量失败，请检查向量接口配置及 1536 维输出" },
          502,
        );
      }
    }

    if (payload_id) {
      await deps.update(
        payload_id,
        project_id,
        params.name,
        params.raw,
        embedding,
      );
    } else {
      await deps.insert(project_id, params.name, params.raw, embedding);
    }
    return c.json({ message: "成功" });
  };

export const saveController = createPayloadSaveController();

export const deleteSchema = validate(
  "json",
  z.object({ payload_id: z.string().uuid() }),
);
export const deleteController = async (c: Context) => {
  const { payload_id } = await c.req.json();
  await db.deletePayload(payload_id);
  return c.json({ message: "删除成功" });
};
