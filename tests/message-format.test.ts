import { expect, test } from "bun:test";
import { convertStandaloneSmileys, normalizeCrispReply } from "../src/utils/message-format";

test("screenshot-like Chinese replies keep inline emoji, working bold and explicit links", () => {
  const input = "⚠️\n只在 App Store 退出，**不要**在设置退出 iCloud。\n下载页：\nhttps://apps.apple.com/us/app/shadowrocket/id932747118\n独享账号：[购买](https://hao.example.com)";
  const actual = normalizeCrispReply(input);
  expect(actual).toStartWith("⚠️ 只在 App Store");
  expect(actual).toContain("， **不要** 在设置");
  expect(actual).toContain("[https://apps.apple.com/us/app/shadowrocket/id932747118](https://apps.apple.com/us/app/shadowrocket/id932747118)");
  expect(actual).toContain("独享账号： [购买](https://hao.example.com)");
  expect(normalizeCrispReply(actual)).toBe(actual);
});

test("URL parameters, balanced parentheses and punctuation are preserved", () => {
  const url = "https://example.com/a(b)?q=one&token=a_b%2Fc#section";
  const input = `下载：${url}。\n其他：https://example.com/path).`;
  expect(normalizeCrispReply(input)).toBe(`下载： [${url}](${url})。\n其他： [https://example.com/path](https://example.com/path)).`);
  expect(normalizeCrispReply("https://example.com/a**b**c")).toBe("[https://example.com/a**b**c](https://example.com/a**b**c)");
});

test("existing named links are spaced once without nesting or editing their targets", () => {
  const input = "参考：[教程](https://example.com/a(b)?x=1&y=2)继续；**注意**[帮助](https://example.com/help)";
  const actual = normalizeCrispReply(input);
  expect(actual).toContain("参考： [教程](https://example.com/a(b)?x=1&y=2) 继续");
  expect(actual).toContain(" **注意** [帮助]");
  expect(normalizeCrispReply(actual)).toBe(actual);
});

test("code, Markdown images and emoji inside code are not rewritten", () => {
  const input = "`https://example.com **literal** :/`\n```text\n⚠️\n原样 **粗体** https://example.com\n```\n![截图](https://example.com/image.png?a=1&b=2)\n`unclosed **literal**";
  expect(normalizeCrispReply(input)).toBe(input);
  expect(convertStandaloneSmileys(input)).toBe(input);
});

test("emoji text joins without changing ordinary line breaks or literal emphasis", () => {
  expect(normalizeCrispReply("✅\n操作成功\n\n第一步\n第二步")).toBe("✅ 操作成功\n\n第一步\n第二步");
  expect(normalizeCrispReply("🇨🇳\n中国\n👍🏽\n完成")).toBe("🇨🇳 中国\n👍🏽 完成");
  expect(normalizeCrispReply("保留 \\**原样** 和 ***样式***")).toBe("保留 \\**原样** 和 ***样式***");
});

test("standalone smileys convert but URLs, paths and code remain intact", () => {
  const input = "https://example.com/a?q=:D&path=:/ :) :/\n[教程](https://example.com/:D) `:/ :)` /tmp/foo:/bar";
  expect(convertStandaloneSmileys(input)).toBe("https://example.com/a?q=:D&path=:/ 🙂 😒\n[教程](https://example.com/:D) `:/ :)` /tmp/foo:/bar");
  expect(convertStandaloneSmileys(":'( :D [+1]！")).toBe("😭 😀 👍！");
});
