import {
  fetchSourceDocuments,
  publicSource,
  sourceSchema,
  type SourceConfig,
  type SourceEntry,
} from "@/services/knowledge-source.service";

type Pending = { id: string; project: string; raw: string };
type Dependencies = {
  load: (project: string) => Promise<SourceConfig | null>;
  save: (project: string, config: SourceConfig) => Promise<void>;
  list: () => Promise<{ project: string; config: SourceConfig }[]>;
  apply: (project: string, entries: SourceEntry[]) => Promise<void>;
  pending: (project: string) => Promise<Pending[]>;
  embed: (raw: string) => Promise<number[]>;
  update: (entry: Pending, vector: number[]) => Promise<boolean>;
  canEmbed: () => boolean;
  mode?: () => "off" | "full" | "vector";
  fetch?: typeof fetchSourceDocuments;
};
export function createKnowledgeSync(deps: Dependencies) {
  const busy = new Set<string>();
  async function save(project: string, input: unknown) {
    if (busy.has(project)) throw new Error("正在同步，请稍后保存来源配置");
    const parsed = sourceSchema.parse(input);
    const before = await deps.load(project);
    const config = {
      ...parsed,
      authorization: parsed.authorization || before?.authorization || "",
      lastSuccess: before?.lastSuccess,
    };
    await deps.save(project, config);
    return publicSource(config);
  }
  async function run(project: string) {
    if (busy.has(project)) throw new Error("该项目正在同步，请稍后刷新状态");
    busy.add(project);
    let config: SourceConfig | null = null;
    try {
      config = await deps.load(project);
      if (!config) throw new Error("请先保存文档来源");
      config.lastAttempt = new Date().toISOString();
      await deps.save(project, config);
      // Fetch all details before changing local rows; incomplete downloads never
      // archive live documents or invalidate existing vectors.
      const entries = await (deps.fetch || fetchSourceDocuments)(config);
      await deps.apply(project, entries);
      const pending = await deps.pending(project);
      let indexed = 0;
      const mode = deps.mode?.() ?? "vector";
      if (mode === "vector" && deps.canEmbed()) {
        for (const entry of pending) {
          try {
            const vector = await deps.embed(entry.raw);
            if (vector.length !== 1536 || !vector.every(Number.isFinite)) break;
            if (await deps.update(entry, vector)) indexed++;
          } catch {
            break;
          }
        }
      }
      const remaining = (await deps.pending(project)).length;
      config.lastSuccess = new Date().toISOString();
      config.lastMessage =
        mode === "full"
          ? `同步 ${entries.length} 条，全文模式可直接使用，无需生成向量。`
          : mode === "off"
            ? `同步 ${entries.length} 条，知识库使用已关闭。`
            : `同步 ${entries.length} 条；本次生成 ${indexed} 条向量，待生成 ${remaining} 条。`;
      await deps.save(project, config);
      return publicSource(config);
    } catch {
      if (config) {
        config.lastMessage =
          "同步失败，请检查文档接口地址、令牌有效性及服务器网络；现有文档已保留。";
        await deps.save(project, config);
      }
      throw new Error(config?.lastMessage || "请先保存文档来源");
    } finally {
      busy.delete(project);
    }
  }
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      for (const { project, config } of await deps.list()) {
        const last = Date.parse(config.lastAttempt || "") || 0;
        if (
          config.enabled &&
          Date.now() - last >= config.intervalMinutes * 60_000 &&
          !busy.has(project)
        )
          await run(project).catch(() => {});
      }
    } finally {
      ticking = false;
    }
  }
  return {
    save,
    run,
    tick,
    read: async (project: string) => {
      const config = publicSource(await deps.load(project));
      return config ? { ...config, syncing: busy.has(project) } : null;
    },
  };
}
