// Crisp ids ("session_…", website UUIDs) can never start with this prefix, so
// the platform of a stored session is decided by its id alone.
const PREFIX = "chatwoot:";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChatwootConversationRef = {
  project: string;
  account: number;
  conversation: number;
};

const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export const isChatwoot = (id: string) => id.startsWith(PREFIX);

export const chatwootChannel = (project: string) => PREFIX + project;

export const chatwootProjectOf = (channel: string) => {
  const project = channel.slice(PREFIX.length);
  return isChatwoot(channel) && UUID.test(project) ? project : null;
};

export const chatwootSessionId = (
  project: string,
  account: number,
  conversation: number,
) => `${PREFIX}${project}:${account}:${conversation}`;

export const parseChatwootSession = (
  session: string,
): ChatwootConversationRef | null => {
  if (!isChatwoot(session)) return null;
  const [project, account, conversation, ...rest] = session
    .slice(PREFIX.length)
    .split(":");
  const a = positive(account),
    c = positive(conversation);
  if (!project || !UUID.test(project) || !a || !c || rest.length) return null;
  return { project, account: a, conversation: c };
};

export const isProjectId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
