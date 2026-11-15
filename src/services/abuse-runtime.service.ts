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
