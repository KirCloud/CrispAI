export type TriggerType = "none" | "text" | "option" | "closeAI";

export type Trigger = { type: TriggerType; text?: string; optionId?: string };

export type Keyword = Trigger & { keyword: string };

export type Welcome = {
  type: "none" | "text" | "option";
  text?: string;
  optionId?: string;
};

export type Project = {
  id: string;
  name: string;
  enabled: boolean;
  websiteId: string | null;
  telegramId: string | number | null;
  botName: string | null;
  botIcon: string | null;
  enableKeyword: boolean;
  keyword: Keyword[];
  enableAI: boolean;
  enableAIPic: boolean;
  payload: string | null;
  options: Welcome;
  timer: number;
  created_at: string;
};

export type OptionCard = {
  id?: string;
  name: string;
  text: string;
  options: { id?: string; label: string; trigger: Trigger }[];
  created_at?: string;
};

export type KnowledgeEntry = {
  id: string;
  name: string;
  raw: string;
  created_at: string;
  indexed: boolean;
  synced: boolean;
};

export type KnowledgeMode = "off" | "full" | "vector";

export type AIConfig = {
  baseUrl: string;
  model: string;
  embeddingModel: string;
  embeddingBaseUrl?: string;
  knowledgeMode: KnowledgeMode;
  knowledgeMaxChars: number;
  hasApiKey: boolean;
  hasEmbeddingApiKey: boolean;
  configured: boolean;
  source: "environment" | "database";
};

export type KnowledgeSource = {
  apiUrl: string;
  docsUrl: string;
  enabled: boolean;
  intervalMinutes: number;
  hasAuthorization: boolean;
  syncing: boolean;
  lastAttempt?: string;
  lastSuccess?: string;
  lastMessage?: string;
};

export type SiteAPI = {
  apiBaseUrl: string;
  siteUrl: string;
  enabled: boolean;
  hasAuthorization: boolean;
};

export type Model = { id: string; name: string };
