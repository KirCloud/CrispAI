import {
  abuseIdentityKey,
  cooldownActive,
} from "@/services/abuse-identity.service";
import {
  prepareAbuseIdentity,
  reserveIdentityWarning,
  identityBlocked,
  mayDeliverWarning,
} from "@/services/abuse-state.service";
import { withConversationLock } from "@/services/conversation-lock.service";
import { connection } from "@/services/redis.service";
import * as db from "@/services/db.service";
import { getAIProvider } from "@/services/openai.service";
import {
  ABUSE_CLASSIFIER_PROMPT,
  parseAbuseClassification,
} from "@/services/abuse-policy.service";
export const readAbusePolicy = async (project: string) => ({
  enabled:
    (await db.getAppSetting("abuse_policy:" + project))?.enabled === true,
});
export const saveAbusePolicy = async (
  project: string,
  value: { enabled: boolean },
) => {
  await db.saveAppSetting("abuse_policy:" + project, value);
  return value;
};
export async function classifyDirectedAbuse(content: string) {
  const { client, model } = getAIProvider();
  const response = await client.chat.completions.create(
    {
      model,
      temperature: 0,
      max_tokens: 80,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ABUSE_CLASSIFIER_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ visitorMessage: content.slice(0, 8000) }),
        },
      ],
    },
    { timeout: 12_000, maxRetries: 0 },
  );
  return parseAbuseClassification(response.choices[0]?.message.content);
}

export async function resolveAbuseState(
  website: string,
  sessionId: string,
  emailReader: () => Promise<unknown>,
) {
  const session = sessionId.replace(/^session_/, "");
  let current = await db.getSession(session);
  if (!current) {
    const project = await db.getProject(website);
    current = await db.upsertSession({
      website_id: website,
      session_id: session,
      enable_reply: Boolean(project?.enableAI),
      enable_time: new Date(),
      thread: [],
    });
  }
  let email: unknown;
  try {
    email = await emailReader();
  } catch {
    /* Retain an already bound identity on metadata failure. */
  }
  const secret =
    Bun.env.ABUSE_IDENTITY_KEY ||
    Bun.env.ADMIN_PASSWORD ||
    (Bun.env.NODE_ENV === "test" ? "isolated-test-identity-key" : "");
  if (!secret) throw new Error("Identity key is not configured");
  const proposed = abuseIdentityKey(website, session, email, secret);
  const identity =
    current.abuse_identity_key &&
    (Number(current.abuse_warning_count) > 0 ||
      cooldownActive(current.abuse_blocked_until) ||
      proposed.startsWith("session:"))
      ? current.abuse_identity_key
      : proposed;
  return withAbuseIdentityLock(website, identity, () =>
    prepareAbuseIdentity(website, session, identity),
  );
}
export const withAbuseIdentityLock = <T>(
  website: string,
  identity: string,
  work: () => Promise<T>,
) =>
  withConversationLock(connection, website, "abuse-identity:" + identity, work);
export async function reserveRuntimeWarning(
  website: string,
  session: string,
  key: string,
) {
  const current = await db.getSession(session);
  return withAbuseIdentityLock(website, current.abuse_identity_key, () =>
    reserveIdentityWarning(website, session, key),
  );
}
export { identityBlocked, mayDeliverWarning };
