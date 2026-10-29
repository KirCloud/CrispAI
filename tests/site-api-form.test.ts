import { expect, test } from "bun:test";
import { mountSiteAPI } from "../web/assets/site-api.js";
class Control {
  value = "";
  checked = false;
  disabled = true;
  textContent = "";
  placeholder = "";
  listeners = new Map<string, Function>();
  addEventListener(type: string, listener: Function) {
    this.listeners.set(type, listener);
  }
  reportValidity() {
    return true;
  }
  async trigger(type: string) {
    await this.listeners.get(type)?.();
  }
}
function view() {
  const controls = new Map<string, Control>();
  for (const id of [
    "site-api-base",
    "site-api-url",
    "site-api-enabled",
    "site-api-token",
    "site-api-token-state",
    "site-api-status",
    "save-site-api",
    "test-site-api",
    "reload-site-api",
  ])
    controls.set(id, new Control());
  const section: any = new Control();
  section.querySelector = (selector: string) => controls.get(selector.slice(1));
  section.querySelectorAll = () =>
    [...controls]
      .filter(([name]) => !name.endsWith("state") && !name.endsWith("status"))
      .map(([, c]) => c);
  return { section, get: (name: string) => controls.get(name)! };
}
test("website form binds real save/test actions and reloads persisted settings while masking saved credentials", async () => {
  let saved: any = {
    apiBaseUrl: "https://api.example/api/v1",
    siteUrl: "https://site.example",
    enabled: true,
    hasAuthorization: true,
  };
  const requests: any[] = [];
  const request = async (path: string, options?: any) => {
    requests.push({ path, options });
    if (options?.method === "PUT") {
      saved = { ...options.body, hasAuthorization: true };
      delete saved.authorization;
    }
    if (path.includes("/test?"))
      return {
        message: "四类接口全部通过",
        data: [{ topic: "plans", ok: true }],
      };
    return { data: structuredClone(saved) };
  };
  const first = view();
  await mountSiteAPI(first.section, "project-a", request);
  expect(first.get("site-api-base").value).toBe(saved.apiBaseUrl);
  expect(first.get("site-api-token").value).toBe("");
  expect(first.get("site-api-token-state").textContent).toContain(
    "已保存在服务器",
  );
  first.get("site-api-url").value = "https://site.example/";
  await first.section.trigger("input");
  await first.get("test-site-api").trigger("click");
  expect(first.get("site-api-status").textContent).toContain("先保存");
  expect(requests).toHaveLength(1);
  await first.get("save-site-api").trigger("click");
  expect(requests[1].options.method).toBe("PUT");
  expect(requests[1].options.body.authorization).toBe("");
  expect(first.get("site-api-status").textContent).toContain("保存成功");
  await first.get("test-site-api").trigger("click");
  expect(requests[2].path).toContain("/test?project_id=project-a");
  expect(first.get("site-api-status").textContent).toContain("套餐：通过");
  const refreshed = view();
  await mountSiteAPI(refreshed.section, "project-a", request);
  expect(refreshed.get("site-api-url").value).toBe("https://site.example/");
  expect(refreshed.get("site-api-enabled").checked).toBe(true);
  expect(refreshed.get("site-api-token").value).toBe("");
  expect(refreshed.get("test-site-api").disabled).toBe(false);
});
test("failed initial load blocks destructive saves and shows a retry action; failed saves retain inputs", async () => {
  const form = view();
  let failLoad = true,
    failSave = true;
  const request = async (_: string, options?: any) => {
    if (failLoad || (options?.method === "PUT" && failSave))
      throw new Error("network unavailable");
    return {
      data: {
        apiBaseUrl: "https://api.example/api/v1",
        siteUrl: "https://site.example",
        enabled: true,
        hasAuthorization: true,
      },
    };
  };
  await mountSiteAPI(form.section, "project-a", request);
  expect(form.get("site-api-status").textContent).toContain("读取失败");
  expect(form.get("save-site-api").disabled).toBe(true);
  expect(form.get("reload-site-api").disabled).toBe(false);
  failLoad = false;
  await form.get("reload-site-api").trigger("click");
  // The reload button starts a background read, as in the browser event loop.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(form.get("save-site-api").disabled).toBe(false);
  form.get("site-api-token").value = "replacement-token";
  await form.section.trigger("input");
  await form.get("save-site-api").trigger("click");
  expect(form.get("site-api-status").textContent).toContain("保存失败");
  expect(form.get("site-api-token").value).toBe("replacement-token");
  expect(form.get("save-site-api").disabled).toBe(false);
});
