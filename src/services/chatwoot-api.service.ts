import type { ChatwootBinding } from "@/services/chatwoot-binding.service";
import {
  chatwootSessionId,
  parseChatwootSession,
} from "@/utils/conversation-id";

type RequestConfig = { headers?: Record<string, string> };
export type ChatwootHTTP = {
  get: (url: string, config?: RequestConfig) => Promise<{ data: any }>;
  post: (
    url: string,
    body?: unknown,
    config?: RequestConfig,
  ) => Promise<{ data: any }>;
};

export type PickerOption = {
  id: string;
  text: string;
  options: { label: string }[];
};
export type OutgoingFile = { name: string; data: Uint8Array; type: string };

// Chatwoot echoes the clicked item's value back in submitted_values; it is the
// only place to carry which option card the click belongs to.
export const pickerValue = (option: string, index: number) =>
  `${option}:${index}`;
export const pickerOptionOf = (value: unknown) => {
  const split = typeof value === "string" ? value.lastIndexOf(":") : -1;
  return split > 0 ? (value as string).slice(0, split) : "";
};

export function createChatwootAPI(deps: {
  http: ChatwootHTTP;
  binding: (project: string) => Promise<ChatwootBinding | null>;
}) {
  const account = async (project: string) => {
    const binding = await deps.binding(project);
    if (!binding?.enabled || !binding.botToken || !binding.baseUrl)
      throw new Error("Chatwoot binding is not enabled");
    // nginx drops header names with underscores by default, which silently
    // discards Chatwoot's documented api_access_token header.
    return {
      root: `${binding.baseUrl}/api/v1/accounts`,
      headers: { Authorization: `Bearer ${binding.botToken}` },
    };
  };
  const conversation = async (session: string) => {
    const ref = parseChatwootSession(session);
    if (!ref) throw new Error("Not a Chatwoot conversation");
    const { root, headers } = await account(ref.project);
    return {
      url: `${root}/${ref.account}/conversations/${ref.conversation}`,
      headers,
    };
  };
  const post = async (session: string, path: string, body: unknown) => {
    const { url, headers } = await conversation(session);
    return deps.http.post(url + path, body, { headers });
  };

  const sendText = async (session: string, content: string) => {
    await post(session, "/messages", { content, message_type: "outgoing" });
  };

  return {
    sendText,
    async sendOption(session: string, option: PickerOption) {
      const items = option.options.map((choice, index) => ({
        title: choice.label,
        value: pickerValue(option.id, index),
      }));
      // Chatwoot rejects an input_select without items.
      if (!items.length) return sendText(session, option.text);
      await post(session, "/messages", {
        content: option.text,
        message_type: "outgoing",
        content_type: "input_select",
        content_attributes: { items },
      });
    },
    async sendFile(session: string, file: OutgoingFile) {
      const form = new FormData();
      form.append("message_type", "outgoing");
      form.append(
        "attachments[]",
        new Blob([file.data], { type: file.type }),
        file.name,
      );
      await post(session, "/messages", form);
    },
    async typing(session: string, on: boolean) {
      await post(session, "/toggle_typing_status", {
        typing_status: on ? "on" : "off",
      });
    },
    async handoff(session: string) {
      await post(session, "/toggle_status", { status: "open" });
    },
    async conversation(session: string) {
      const { url, headers } = await conversation(session);
      return (await deps.http.get(url, { headers })).data;
    },
    async startConversation(
      project: string,
      target: { account: number; inbox: number; sourceId: string },
    ) {
      const { root, headers } = await account(project);
      const { data } = await deps.http.post(
        `${root}/${target.account}/conversations`,
        { inbox_id: target.inbox, source_id: target.sourceId },
        { headers },
      );
      const id = Number(data?.id);
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error("Chatwoot did not return a conversation id");
      return chatwootSessionId(project, target.account, id);
    },
  };
}

const escapeHTML = (value: unknown) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

// Same line format as the Crisp card, so generateTelegramName can still find
// the nickname or email in a <code> span.
export function chatwootMetaLines(conversation: any, dashboardUrl?: string) {
  const sender = conversation?.meta?.sender ?? {};
  const flow: string[] = [];
  if (text(sender.name))
    flow.push(`👤<b>用户</b>：<code>${escapeHTML(text(sender.name))}</code>`);
  if (text(sender.email))
    flow.push(`📧<b>邮箱</b>：<code>${escapeHTML(text(sender.email))}</code>`);
  const place = [
    text(sender.additional_attributes?.country),
    text(sender.additional_attributes?.city),
  ]
    .filter(Boolean)
    .join(" ");
  if (place) flow.push("", `📍<b>地理位置</b>：${escapeHTML(place)}`);
  const browser = conversation?.additional_attributes?.browser ?? {};
  if (text(browser.platform_name))
    flow.push("", `🖥<b>操作系统</b>：${escapeHTML(text(browser.platform_name))}`);
  if (text(browser.browser_name))
    flow.push("", `🌐<b>浏览器</b>：${escapeHTML(text(browser.browser_name))}`);
  const custom = sender.custom_attributes;
  if (custom && typeof custom === "object" && Object.keys(custom).length)
    flow.push(
      "",
      "📄<b>附加信息</b>：",
      `<pre>${escapeHTML(JSON.stringify(custom))}</pre>`,
    );
  if (dashboardUrl)
    flow.push("", `🔗<a href="${escapeHTML(dashboardUrl)}">在 Chatwoot 中打开</a>`);
  return flow;
}

export function chatwootPageLines(conversation: any) {
  const referer = text(conversation?.additional_attributes?.referer);
  if (!/^https?:\/\//i.test(referer)) return [];
  const url = escapeHTML(referer);
  return [
    "",
    "📄<b>发起页面</b>：",
    `<blockquote expandable><a href="${url}">${url}</a></blockquote>`,
  ];
}

export const chatwootDashboardUrl = (
  baseUrl: string,
  account: number,
  conversation: number,
) => `${baseUrl}/app/accounts/${account}/conversations/${conversation}`;

// The conversation payload carries only its latest message; its created_at is
// in Unix seconds.
export const chatwootLastMessageAt = (conversation: any) => {
  const seconds = Number(conversation?.messages?.[0]?.created_at);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
};
