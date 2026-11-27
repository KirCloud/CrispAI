import * as crisp from "@/services/crisp.service";
import * as chatwoot from "@/services/chatwoot.service";
import * as storage from "@/services/storage.service";
import type { OutgoingFile, PickerOption } from "@/services/chatwoot-api.service";
import { isChatwoot } from "@/utils/conversation-id";

// Workers keep the Crisp calling convention (website, session); the session id
// decides which platform receives the call.
const crispSession = (session: string) =>
  session.startsWith("session_") ? session : "session_" + session;

type SendOptions = { human?: boolean; warningKey?: string };

export const getVisitorEmail = (website: string, session: string) =>
  isChatwoot(session)
    ? chatwoot.getVisitorEmail(session)
    : crisp.getVisitorEmail(website, crispSession(session));

export const getMetas = (website: string, session: string) =>
  isChatwoot(session)
    ? chatwoot.getMetas(session)
    : crisp.getMetas(website, crispSession(session));

export const listPages = (website: string, session: string) =>
  isChatwoot(session)
    ? chatwoot.listPages(session)
    : crisp.listPages(website, crispSession(session));

export const composeMessage = (
  website: string,
  session: string,
  action: boolean,
) =>
  isChatwoot(session)
    ? chatwoot.composeMessage(website, session, action)
    : crisp.composeMessage(website, crispSession(session), action);

export const sendMessage = (
  website: string,
  session: string,
  message: string,
  botName: string,
  botURL: string,
  options: SendOptions = {},
) =>
  isChatwoot(session)
    ? chatwoot.sendMessage(website, session, message, options)
    : crisp.sendMessage(
        website,
        crispSession(session),
        message,
        botName,
        botURL,
        options,
      );

export const sendOption = (
  website: string,
  session: string,
  option: PickerOption,
  botName: string,
  botURL: string,
) =>
  isChatwoot(session)
    ? chatwoot.sendOption(website, session, option)
    : crisp.sendOption(website, crispSession(session), option, botName, botURL);

// Human replies only: Crisp pulls the image from our public /upload route,
// Chatwoot takes the file itself.
export const sendImage = async (
  website: string,
  session: string,
  file: OutgoingFile,
  botName: string,
  botURL: string,
) => {
  if (isChatwoot(session)) return chatwoot.sendFile(session, file);
  const url = await storage.saveFile(file.name, file.data);
  return crisp.sendMessage(
    website,
    crispSession(session),
    `![image](${url})`,
    botName,
    botURL,
    { human: true },
  );
};

export const handoff = async (_website: string, session: string) => {
  if (isChatwoot(session)) await chatwoot.handoff(session);
};

export const lastMessageAt = async (
  website: string,
  session: string,
): Promise<number | null> => {
  if (isChatwoot(session)) return chatwoot.lastMessageAt(session);
  const messages = await crisp.getMessages(website, crispSession(session));
  return messages.at(-1)?.timestamp ?? null;
};
