import type { Context } from "hono";
import z from "zod";
import * as db from "@/services/db.service";
import { createEmbedding, aiConfig } from "@/services/openai.service";
import logger from "@/services/logger.service";
import { validate } from "@/api/validator";

/**
 * 项目导入导出
 *
 * 导出文件是一个 JSON，SaaS 版和自部署版通用：
 * {
 *   format: "crispai-project", version: 1, exported_at, embedding_model,
 *   project:  { name, websiteId, telegramId, botName, ... },
 *   options:  [{ id, name, text, options }],
 *   payloads: [{ name, raw, vector }]      // vector 是 "[0.1,0.2,...]" 文本，可为 null
 * }
 */
const FORMAT = "crispai-project";
const VERSION = 1;
const VECTOR_DIMENSIONS = 1536;

// 只导出配置字段。id / 多用户 / 计费 / 时间字段不带走
const PROJECT_FIELDS = [
  "name",
  "websiteId",
  "telegramId",
  "botName",
  "botIcon",
  "enableKeyword",
  "keyword",
  "enableAI",
  "enableAIPic",
  "payload",
  "options",
  "timer",
] as const;

export const exportSchema = validate(
  "query",
  z.object({ id: z.string().uuid() }),
);
export const exportController = async (c: Context) => {
  const project = await db.getProjectById(c.req.query("id")!);
  if (!project) return c.json({ message: "项目不存在" }, 404);

  const options = await db.getOption(project.id);
  const payloads = await db.listPayloadsWithVector(project.id);

  const data = {
    format: FORMAT,
    version: VERSION,
    exported_at: new Date().toISOString(),
    embedding_model: aiConfig.current().embeddingModel,
    project: Object.fromEntries(PROJECT_FIELDS.map((k) => [k, project[k]])),
    options: options.map((o: any) => ({
      id: o.id,
      name: o.name,
      text: o.text,
      options: o.options,
    })),
    payloads: payloads.map((p: any) => ({
      name: p.name,
      raw: p.raw,
      vector: p.vector,
    })),
  };

  const fileName = encodeURIComponent(`${project.name || "project"}.crispai.json`);
  c.header("Content-Disposition", `attachment; filename*=UTF-8''${fileName}`);
  return c.json(data);
};

const trigger = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    optionId: z.string().optional(),
  })
  .passthrough();

const importBody = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  embedding_model: z.string().optional(),
  project: z.object({
    name: z.string().optional(),
    websiteId: z.string().nullish(),
    telegramId: z.number().int().nullish(),
    botName: z.string().nullish(),
    botIcon: z.string().nullish(),
    enableKeyword: z.boolean().optional(),
    keyword: z
      .array(z.object({ keyword: z.string() }).merge(trigger))
      .optional(),
    enableAI: z.boolean().optional(),
    enableAIPic: z.boolean().optional(),
    payload: z.string().nullish(),
    options: trigger.partial().optional(),
    timer: z.number().int().positive().optional(),
  }),
  options: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        text: z.string(),
        options: z.array(
          z.object({ label: z.string(), trigger }).passthrough(),
        ),
      }),
    )
    .default([]),
  payloads: z
    .array(
      z.object({
        name: z.string(),
        raw: z.string(),
        vector: z.union([z.string(), z.array(z.number())]).nullish(),
      }),
    )
    .default([]),
});

export const importSchema = validate("json", importBody, "导入文件格式不正确");

// 把导出的 vector（文本或数组）规整成 "[...]" 文本；维度不对或解析失败返回 null
const normalizeVector = (vector: string | number[] | null | undefined) => {
  if (!vector) return null;
  try {
    const list = typeof vector === "string" ? JSON.parse(vector) : vector;
    if (
      !Array.isArray(list) ||
      list.length !== VECTOR_DIMENSIONS ||
      !list.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      return null;
    }
    return JSON.stringify(list);
  } catch {
    return null;
  }
};

export const importController = async (c: Context) => {
  const body = importBody.parse(await c.req.json());
  const warnings: string[] = [];

  // 选项 id 一律换新：同一份文件可以重复导入，也不会和已有选项撞 id。
  // 引用选项 id 的三个位置要跟着改：keyword[].optionId、options.optionId、选项里每个 trigger.optionId
  const idMap = new Map(body.options.map((o) => [o.id, crypto.randomUUID()]));
  const remap = <T extends { optionId?: string }>(target: T): T => {
    if (!target.optionId) return target;
    const optionId = idMap.get(target.optionId);
    if (!optionId) {
      warnings.push(`引用了不存在的选项 ${target.optionId}，已忽略`);
    }
    return { ...target, optionId };
  };

  const project: Record<string, unknown> = {
    ...body.project,
    name: body.project.name || "Untitled",
    keyword: (body.project.keyword ?? []).map(remap),
    options: remap(body.project.options ?? {}),
    // 导入后默认停用：迁移过来通常还要换 Crisp 插件，确认配置后再手动启用
    enabled: false,
  };

  if (body.project.websiteId) {
    const projects = await db.listProjects();
    if (projects.some((p) => p.websiteId === body.project.websiteId)) {
      project["websiteId"] = null;
      warnings.push("Website ID 已被其他项目使用，导入的项目未设置 Website ID");
    }
  }

  const options = body.options.map((o) => ({
    id: idMap.get(o.id)!,
    name: o.name,
    text: o.text,
    options: o.options.map((choice) => ({
      ...choice,
      trigger: remap(choice.trigger),
    })),
  }));

  // 向量模型一致就直接用导出的向量，否则重新生成（网络请求放在事务外面）
  const sameModel = body.embedding_model === aiConfig.current().embeddingModel;
  const payloads: { name: string; raw: string; vector: string | null }[] = [];
  let failed = 0;
  for (const payload of body.payloads) {
    let vector = sameModel ? normalizeVector(payload.vector) : null;
    if (!vector) {
      try {
        vector = normalizeVector(await createEmbedding(payload.raw));
      } catch (error) {
        logger.warn("导入时生成向量失败", {
          name: payload.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!vector) failed++;
    payloads.push({ name: payload.name, raw: payload.raw, vector });
  }
  if (failed > 0) {
    warnings.push(
      `${failed} 条知识库没有向量，AI 检索不到它们；配置好 OpenAI 后在知识库里重新保存即可`,
    );
  }

  const created = await db.importProject({ project, options, payloads });
  return c.json({ data: { id: created.id }, warnings });
};
