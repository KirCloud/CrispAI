import * as db from "@/services/db.service";
import { aiConfig, createEmbedding } from "@/services/openai.service";
import { resolveEmbeddingConnection } from "@/services/ai-config.service";
import { createKnowledgeSync } from "@/services/knowledge-sync.service";
export const knowledgeSync = createKnowledgeSync({
  load: (project) => db.getAppSetting("knowledge_source:" + project),
  save: (project, config) =>
    db.saveAppSetting("knowledge_source:" + project, config),
  list: db.listKnowledgeSources,
  apply: db.syncSourcePayloads,
  pending: db.listPendingSourcePayloads,
  embed: createEmbedding,
  update: db.updatePayloadVector,
  canEmbed: () => {
    try {
      const config = aiConfig.current();
      resolveEmbeddingConnection(config);
      return Boolean(config.embeddingModel);
    } catch {
      return false;
    }
  },
});
export function startKnowledgeSync() {
  const timer = setInterval(() => {
    void knowledgeSync.tick().catch(() => {});
  }, 60_000);
  timer.unref();
}
