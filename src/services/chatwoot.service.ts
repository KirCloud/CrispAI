import axios from "axios";
import { createAutomatedDeliveryGate } from "@/services/abuse-identity.service";
import {
  identityBlocked,
  mayDeliverWarning,
  resolveAbuseState,
  withAbuseIdentityLock,
} from "@/services/abuse-runtime.service";
import {
  chatwootDashboardUrl,
  chatwootLastMessageAt,
  chatwootMetaLines,
  chatwootPageLines,
  createChatwootAPI,
  type OutgoingFile,
  type PickerOption,
} from "@/services/chatwoot-api.service";
import {
  createChatwootBindings,
  type ChatwootBinding,
} from "@/services/chatwoot-binding.service";
import { getAppSetting, saveAppSetting } from "@/services/db.service";
import logger from "@/services/logger.service";
import { parseChatwootSession } from "@/utils/conversation-id";

const http = axios.create({ timeout: 15000 });
http.interceptors.response.use(
  (response) => response,
  (error) => {
    const res = error.response;
    // The request config carries the bot token; log only the outcome.
    logger.error("chatwoot api failed", {
      method: error.config?.method?.toUpperCase(),
      url: error.config?.url,
      status: res?.status,
      data: res?.data,
      code: error.code,
      message: error.message,
    });
    return Promise.reject(error);
  },
);

export const chatwootBindings = createChatwootBindings({
  load: (project) =>
    getAppSetting("chatwoot:" + project) as Promise<ChatwootBinding | null>,
  save: (project, binding) => saveAppSetting("chatwoot:" + project, binding),
});

const api = createChatwootAPI({ http, binding: chatwootBindings.load });

// One visitor message reads the conversation several times (abuse identity,
// Telegram card, AI context); a short cache keeps that to one request.
const CONVERSATION_CACHE_MS = 10_000;
const conversations = new Map<string, { until: number; value: Promise<any> }>();
const getConversation = (session: string) => {
  const now = Date.now();
  const hit = conversations.get(session);
  if (hit && hit.until > now) return hit.value;
  if (conversations.size > 500)
    for (const [key, entry] of conversations)
      if (entry.until <= now) conversations.delete(key);
  const value = api.conversation(session);
  conversations.set(session, { until: now + CONVERSATION_CACHE_MS, value });
  value.catch(() => conversations.delete(session));
  return value;
};

export const getVisitorEmail = async (session: string) =>
  (await getConversation(session))?.meta?.sender?.email;

export const getMetas = async (session: string) => {
  const ref = parseChatwootSession(session);
  const binding = ref ? await chatwootBindings.load(ref.project) : null;
  return chatwootMetaLines(
    await getConversation(session),
    ref && binding?.baseUrl
      ? chatwootDashboardUrl(binding.baseUrl, ref.account, ref.conversation)
      : undefined,
  );
};

export const listPages = async (session: string) => {
  try {
    return chatwootPageLines(await getConversation(session));
  } catch {
    return [];
  }
};

export const lastMessageAt = async (session: string) =>
  chatwootLastMessageAt(await api.conversation(session));

const deliverAutomated = createAutomatedDeliveryGate({
  identity: async (website, session) =>
    (
      await resolveAbuseState(website, session, () =>
        getVisitorEmail(session),
      )
    ).identity,
  lock: withAbuseIdentityLock,
  blocked: identityBlocked,
  warningAllowed: mayDeliverWarning,
});

export const sendMessage = (
  website: string,
  session: string,
  message: string,
  options: { human?: boolean; warningKey?: string } = {},
) =>
  deliverAutomated(website, session, () => api.sendText(session, message), options);

export const sendOption = (
  website: string,
  session: string,
  option: PickerOption,
) => deliverAutomated(website, session, () => api.sendOption(session, option));

export const sendFile = async (session: string, file: OutgoingFile) => {
  await api.sendFile(session, file);
  return true;
};

export const composeMessage = async (
  website: string,
  session: string,
  action: boolean,
) => {
  const send = () => api.typing(session, action);
  try {
    if (action) return await deliverAutomated(website, session, send);
    await send();
    return true;
  } catch {
    return false;
  }
};

// Moves a bot-held (pending) conversation into the agents' open queue.
export const handoff = async (session: string) => {
  try {
    await api.handoff(session);
  } catch {}
};

export const startConversation = api.startConversation;
