import { createHmac, timingSafeEqual } from "node:crypto";
import { pickerOptionOf } from "@/services/chatwoot-api.service";
import { chatwootChannel, chatwootSessionId } from "@/utils/conversation-id";

const SIGNATURE_TOLERANCE_S = 300;

// Chatwoot signs "<timestamp>.<raw body>" and sends a fresh timestamp on each
// retry, so the raw text must be verified before it is parsed.
export function verifyChatwootSignature(input: {
  secret: string;
  timestamp?: string;
  signature?: string;
  body: string;
  now?: number;
}) {
  const { secret, timestamp, signature, body } = input;
  if (!secret || !signature || !timestamp || !/^\d{1,12}$/.test(timestamp))
    return false;
  const now = (input.now ?? Date.now()) / 1000;
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_TOLERANCE_S) return false;
  const expected = Buffer.from(
    "sha256=" +
      createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"),
  );
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type ChatwootJob =
  | { kind: "visitor"; data: Record<string, unknown> }
  | { kind: "operator"; data: Record<string, unknown> }
  | { kind: "picker"; key: string; data: Record<string, unknown> }
  | { kind: "intro"; key: string; data: Record<string, unknown> };

const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Translates one agent-bot webhook into the job shapes the Crisp webhook
 * already produces, so the existing workers handle both platforms.
 */
export function chatwootJobs(
  project: string,
  body: any,
  inboxFilter: number | null,
): ChatwootJob[] {
  const inbox = positive(body?.inbox?.id);
  if (inboxFilter && inbox !== inboxFilter) return [];
  const account = positive(body?.account?.id);
  if (!account) return [];
  const website_id = chatwootChannel(project);

  if (body?.event === "webwidget_triggered") {
    const contactInbox = positive(body.id);
    if (!contactInbox) return [];
    const key = `${project}:${contactInbox}`;
    const current = body.current_conversation;
    const open = positive(current?.id);
    if (open && current.status !== "resolved")
      return [
        {
          kind: "intro",
          key,
          data: {
            website_id,
            session_id: chatwootSessionId(project, account, open),
          },
        },
      ];
    const sourceId = typeof body.source_id === "string" ? body.source_id : "";
    if (!inbox || !sourceId) return [];
    return [
      {
        kind: "intro",
        key,
        data: { website_id, chatwoot: { account, inbox, sourceId } },
      },
    ];
  }

  const conversation = positive(body?.conversation?.id);
  if (!conversation || body?.private) return [];
  const session_id = chatwootSessionId(project, account, conversation);
  const sender = body.sender?.type;

  if (body.event === "message_updated") {
    const submitted = body.content_attributes?.submitted_values?.[0]?.value;
    const option = pickerOptionOf(submitted);
    if (
      body.content_type !== "input_select" ||
      sender !== "agent_bot" ||
      !option
    )
      return [];
    const items: any[] = body.content_attributes?.items ?? [];
    return [
      {
        kind: "picker",
        key: `${project}:${body.id}`,
        data: {
          website_id,
          session_id,
          content: {
            id: option,
            choices: items.map((item) => ({
              value: item?.value,
              label: item?.title,
              selected: item?.value === submitted,
            })),
          },
        },
      },
    ];
  }

  if (body.event !== "message_created") return [];
  if (body.message_type === "outgoing")
    return sender === "user"
      ? [{ kind: "operator", data: { website_id, session_id, user: {} } }]
      : [];
  if (body.message_type !== "incoming") return [];

  const jobs: ChatwootJob[] = [];
  const base = { website_id, session_id, timestamp: body.created_at };
  if (
    (!body.content_type || body.content_type === "text") &&
    typeof body.content === "string" &&
    body.content.trim()
  )
    jobs.push({
      kind: "visitor",
      data: {
        ...base,
        type: "text",
        content: body.content,
        fingerprint: `chatwoot:${body.id}`,
      },
    });
  for (const attachment of body.attachments ?? []) {
    if (typeof attachment?.data_url !== "string" || !attachment.data_url)
      continue;
    jobs.push({
      kind: "visitor",
      data: {
        ...base,
        type: "file",
        content: {
          type: String(attachment.content_type || attachment.file_type || ""),
          url: attachment.data_url,
        },
        fingerprint: `chatwoot:${body.id}:${attachment.id}`,
      },
    });
  }
  return jobs;
}
