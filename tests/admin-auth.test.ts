import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createAdminAuth,
  safeReturnPath,
} from "../src/services/admin-auth.service";

const origin = "https://console.example";
function fixture() {
  let time = 100_000;
  const credentials = { username: "admin", password: "test-password" };
  const auth = createAdminAuth({
    credentials: () => credentials,
    publicUrl: origin,
    now: () => time,
  });
  const app = new Hono();
  app.route("/api/auth", auth.router);
  app.use("/api/private", auth.middleware);
  app.all("/api/private", (c) => c.json({ ok: true }));
  app.get("/dashboard", auth.middleware, (c) => c.text("dashboard"));
  const login = (password = credentials.password, next?: string) =>
    app.request(origin + "/api/auth/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: credentials.username, password, next }),
    });
  return {
    app,
    login,
    credentials,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const cookieOf = (response: Response) =>
  response.headers.get("set-cookie")!.split(";")[0]!;

describe("administrator sessions", () => {
  test("anonymous pages redirect, APIs return JSON without a native login prompt", async () => {
    const { app } = fixture();
    const page = await app.request(origin + "/dashboard");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login?next=%2Fdashboard");
    const api = await app.request(origin + "/api/private");
    expect(api.status).toBe(401);
    expect(api.headers.get("www-authenticate")).toBeNull();
    expect(api.headers.get("cache-control")).toBe("no-store");
  });
  test("valid login issues an HttpOnly secure cookie and logout revokes it", async () => {
    const { app, login } = fixture();
    const response = await login();
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(header).not.toContain("test-password");
    const cookie = cookieOf(response);
    expect(
      (
        await app.request(origin + "/api/private", {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(origin + "/api/auth/logout", {
          method: "POST",
          headers: { Cookie: cookie, Origin: origin },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(origin + "/api/private", {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(401);
  });
  test("login and authenticated writes reject cross-origin requests", async () => {
    const { app, login } = fixture();
    const cookie = cookieOf(await login());
    for (const source of [undefined, "https://attacker.example"]) {
      const headers: Record<string, string> = { Cookie: cookie };
      if (source) headers.Origin = source;
      expect(
        (
          await app.request(origin + "/api/private", {
            method: "POST",
            headers,
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await app.request(origin + "/api/private", {
          method: "POST",
          headers: { Cookie: cookie, Origin: origin },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(origin + "/api/auth/login", {
          method: "POST",
          headers: { Origin: "https://attacker.example" },
        })
      ).status,
    ).toBe(403);
  });
  test("CLI Basic auth works while browser-cached Basic credentials cannot bypass login", async () => {
    const { app } = fixture();
    const Authorization = "Basic " + btoa("admin:test-password");
    expect(
      (
        await app.request(origin + "/api/private", {
          headers: { Authorization },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(origin + "/api/private", {
          headers: { Authorization, "Sec-Fetch-Mode": "cors" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(origin + "/api/private", {
          headers: { Authorization, Cookie: "crispai_browser=1" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(origin + "/dashboard", {
          headers: { Authorization, "Sec-Fetch-Mode": "navigate" },
        })
      ).status,
    ).toBe(302);
  });
  test("expiry and credential rotation invalidate existing sessions", async () => {
    const { app, login, advance, credentials } = fixture();
    let cookie = cookieOf(await login());
    advance(12 * 60 * 60 * 1000 + 1);
    expect(
      (
        await app.request(origin + "/api/auth/session", {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(401);
    cookie = cookieOf(await login());
    credentials.password = "changed-on-server";
    expect(
      (
        await app.request(origin + "/api/private", {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(401);
  });
  test("failed logins are throttled and recover after the cooldown", async () => {
    const { login, advance } = fixture();
    for (let i = 0; i < 10; i++)
      expect((await login("wrong")).status).toBe(401);
    const throttled = await login();
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toBeTruthy();
    advance(15 * 60 * 1000 + 1);
    expect((await login()).status).toBe(200);
  });
  test("an unset administrator password fails closed", async () => {
    const { app, credentials } = fixture();
    credentials.password = "";
    expect((await app.request(origin + "/api/private")).status).toBe(503);
  });
  test("redirects stay on the same site", () => {
    for (const value of [
      "//attacker.example",
      "/\\attacker.example",
      "https://attacker.example",
      "/login",
      "/\nattack",
    ])
      expect(safeReturnPath(value)).toBe("/dashboard");
    expect(safeReturnPath("/settings/ai?from=login")).toBe(
      "/settings/ai?from=login",
    );
  });
});
