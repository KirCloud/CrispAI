import { Hono } from "hono";
import { cors } from "hono/cors";
import z from "zod";

import { authMiddleware } from "@/middlewares/auth.middleware";
import introTask from "@/jobs/intro.task";
import { enqueue } from "@/utils/queue";
import { validate } from "@/api/validator";
import * as project from "@/api/project.controller";
import * as option from "@/api/option.controller";
import * as payload from "@/api/payload.controller";
import * as transfer from "@/api/transfer.controller";
import { createAISettingsRoutes } from "@/api/ai-settings.controller";
import { createKnowledgeSourceRoutes } from "@/api/knowledge-source.controller";
import { getKnowledgeMode } from "@/services/ai-config.service";
import { knowledgeSync } from "@/services/knowledge-runtime.service";
import { createKnowledgeRoutes } from "@/api/knowledge.controller";
import * as db from "@/services/db.service";
import { aiConfig, createEmbedding } from "@/services/openai.service";

/**
 * 管理后台接口（/api/v1）
 *
 * 除 intro 外全部需要 Basic 认证。写接口沿用原来的路由名，前端改动最小；
 * 读接口是新增的，替代原来浏览器直连数据库的查询。
 */
const api = new Hono();

// intro 由访客网站上的 intro.js 跨域调用，公开且不需要认证
const introCors = cors({
  origin: "*",
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
});
api.use("/intro", introCors);
api.post(
  "/intro",
  validate(
    "json",
    z.object({ website_id: z.string().min(1), session_id: z.string().min(1) }),
  ),
  async (c) => {
    enqueue(introTask.queue, "intro", await c.req.json());
    return c.json({ message: "成功" });
  },
);

api.use("*", authMiddleware);
api.route("/settings/ai", createAISettingsRoutes(aiConfig));
api.route(
  "/knowledge/source",
  createKnowledgeSourceRoutes(knowledgeSync, db.getProjectById),
);
api.route(
  "/knowledge",
  createKnowledgeRoutes({
    list: db.listKnowledgeStatus,
    get: db.getPayloadById,
    embed: createEmbedding,
    ready: () =>
      getKnowledgeMode(aiConfig.current()) === "vector" &&
      Boolean(aiConfig.current().embeddingModel),
    update: db.updatePayloadVector,
  }),
);

// project
api.get("/projects", project.listController);
api.get("/project", project.getSchema, project.getController);
api.post("/createProject", project.createSchema, project.createController);
api.post("/deleteProject", project.deleteSchema, project.deleteController);
api.post(
  "/saveProjectGeneral",
  project.saveGeneralSchema,
  project.saveGeneralController,
);
api.post("/saveProjectAI", project.saveAISchema, project.saveAIController);
api.post(
  "/saveProjectKeyword",
  project.saveKeywordSchema,
  project.saveKeywordController,
);
// option
api.get("/options", option.listSchema, option.listController);
api.post("/saveProjectOption", option.saveSchema, option.saveController);
api.post("/deleteProjectOption", option.deleteSchema, option.deleteController);
// payload
api.get("/payloads", payload.listSchema, payload.listController);
api.post("/saveProjectPayload", payload.saveSchema, payload.saveController);
api.post(
  "/deleteProjectPayload",
  payload.deleteSchema,
  payload.deleteController,
);
// 导入导出
api.get("/exportProject", transfer.exportSchema, transfer.exportController);
api.post("/importProject", transfer.importSchema, transfer.importController);

api.all("*", (c) => c.json({ message: "接口不存在" }, 404));

export default api;
