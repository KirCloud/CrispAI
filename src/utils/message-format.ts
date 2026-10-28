export const AI_REPLY_FORMAT_GUIDE = "回复排版：用简短段落和编号步骤，不输出 HTML、表格或装饰图片。链接使用 [简短名称](完整的 https:// 地址)，链接名称只包含与该地址相关的短语；不要把整段建议作为链接，也不要把长网址放进代码块。使用 **强调** 时在标记外侧留空格。emoji 与对应说明放在同一行，不要单独占一整段。";

// Protect code and Markdown destinations before changing surrounding text.
// Balanced parentheses keep URL paths and query strings intact.
function protectedEnd(text: string, start: number): number | null {
  if (text[start] === "`") {
    let ticks = 1;
    while (text[start + ticks] === "`") ticks++;
    const marker = "`".repeat(ticks);
    const end = text.indexOf(marker, start + ticks);
    return end < 0 ? text.length : end + ticks;
  }
  const image = text[start] === "!" && text[start + 1] === "[";
  if (text[start] !== "[" && !image) return null;
  const close = text.indexOf("](", start + (image ? 2 : 1));
  if (close < 0 || text.slice(start, close).includes("\n")) return null;
  let depth = 1;
  for (let i = close + 2; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "(") depth++;
    if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return null;
}

type TextMapper = (part: string, before: string, after: string) => string;
function mapOrdinaryText(text: string, map: TextMapper, mapProtected?: TextMapper) {
  let result = "", plainStart = 0;
  for (let i = 0; i < text.length;) {
    const end = protectedEnd(text, i);
    if (end !== null) {
      result += map(text.slice(plainStart, i), result[result.length - 1] || "", text[i] || "");
      const token = text.slice(i, end);
      result += mapProtected ? mapProtected(token, result[result.length - 1] || "", text[end] || "") : token;
      plainStart = i = end;
    } else { i++; }
  }
  return result + map(text.slice(plainStart), result[result.length - 1] || "", "");
}

function trimUrlTail(value: string) {
  let candidate = value;
  // Peel punctuation and unmatched closing parentheses repeatedly, including
  // combinations such as "https://example.com/path).".
  for (;;) {
    const previous = candidate;
    candidate = candidate.replace(/[.,!?:;，。！？：；、"'”’》】]+$/u, "");
    if (candidate.endsWith(")") && (candidate.match(/\)/g)?.length || 0) > (candidate.match(/\(/g)?.length || 0)) candidate = candidate.slice(0, -1);
    if (candidate === previous) break;
  }
  return [candidate, value.slice(candidate.length)] as const;
}

function leadingSpace(before: string) {
  return before && !/[\s(]/u.test(before) ? " " : "";
}
function trailingSpace(after: string) {
  return after && !/[\s.,!?，。！？：；、）)」』]/u.test(after) ? " " : "";
}

export function normalizeCrispReply(text: string) {
  const linked = mapOrdinaryText(text, (part) => part.replace(
    /https?:\/\/[^\s<>`，。！？：；、「」『』]+/gu,
    (value) => {
      const [url, tail] = trimUrlTail(value);
      try {
        const parsed = new URL(url);
        if (!parsed.hostname) return value;
        // Explicit links work even when the provider emitted a bare URL next
        // to Chinese text. Keep both the URL label and destination verbatim.
        return `[${url}](${url})${tail}`;
      } catch { return value; }
    },
  ));
  // Re-scan after linkification so emphasis never changes URL contents.
  return mapOrdinaryText(linked, (part, before, after) => part
    .replace(/(?<![\\*])\*\*([^*\n]+)\*\*(?!\*)/gu, (match, _content, offset, source) => {
      const previous = offset ? source[offset - 1] : before;
      const next = source[offset + match.length] || after;
      return leadingSpace(previous) + match + trailingSpace(next);
    })
    .replace(/^([\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D]+)[ \t]*\n+(?=\S)/gmu, "$1 "),
    (token, before, after) => token.startsWith("[")
      ? leadingSpace(before) + token + trailingSpace(after)
      : token,
  );
}

// Convert only standalone legacy smileys. In particular, :/ inside https://
// must never turn into an emoji and corrupt a forwarded URL.
const smileys: Record<string, string> = {
  ":)": "🙂", ":D": "😀", ":$": "☺️", "x)": "😅", "8)": "😎", ":'(": "😭", ":/": "😒", "<3": "❤️", ":'D": "😀", ":(": "🙁", ":@": "😠", ":S": "😖", "[+1]": "👍", ":o": "😲", ":P": "😋", ";)": "😉",
};
export function convertStandaloneSmileys(text: string) {
  return mapOrdinaryText(text, (part) => part.replace(/https?:\/\/[^\s<>]+|(^|\s)(:'D|:'\(|:\)|:D|:\$|x\)|8\)|:\/|<3|:\(|:@|:S|\[\+1\]|:o|:P|;\))(?=$|[\s，。！？!?])/gu,
    (match, prefix, smiley) => smiley ? prefix + smileys[smiley] : match));
}
