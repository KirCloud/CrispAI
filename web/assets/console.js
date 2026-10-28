const $ = (selector) => document.querySelector(selector);
const page = document.body.dataset.page;
let dirty = false;

function message(target, text, kind = "") {
  const element = $(target);
  element.textContent = text;
  element.className = `form-message ${kind}`;
}

async function request(path, { method = "GET", body, login = false } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response
    .json()
    .catch(() => ({ message: "服务器返回了无法读取的响应" }));
  if (response.status === 401 && !login) {
    dirty = false;
    location.replace(
      `/login?next=${encodeURIComponent(location.pathname + location.search)}`,
    );
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) throw new Error(result.message || "请求失败，请稍后重试");
  return result;
}

document.querySelectorAll("[data-reveal]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.reveal);
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.textContent = reveal ? "隐藏" : "显示";
    button.setAttribute("aria-pressed", String(reveal));
    button.setAttribute(
      "aria-label",
      (reveal ? "隐藏" : "显示") + (input.id === "api-key" ? "密钥" : "密码"),
    );
  });
});

document.querySelectorAll("[data-logout]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (dirty && !confirm("还有未保存的配置，确定退出吗？")) return;
    button.disabled = true;
    try {
      await request("/api/auth/logout", { method: "POST", body: {} });
      dirty = false;
      location.replace("/login");
    } catch (error) {
      message(
        page === "ai" ? "#form-message" : "#page-message",
        error.message,
        "error",
      );
      button.disabled = false;
    }
  });
});

if (page === "login") {
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-submit");
    button.disabled = true;
    button.textContent = "正在登录…";
    message("#form-message", "");
    try {
      const result = await request("/api/auth/login", {
        method: "POST",
        login: true,
        body: {
          username: $("#username").value.trim(),
          password: $("#password").value,
          next:
            new URLSearchParams(location.search).get("next") || "/dashboard",
        },
      });
      $("#password").value = "";
      location.replace(result.redirect);
    } catch (error) {
      message("#form-message", error.message, "error");
      button.disabled = false;
      button.textContent = "登录控制台 →";
    }
  });
} else {
  request("/api/auth/session")
    .then((data) => {
      $("#account-name").textContent = data.username;
    })
    .catch(() => {});
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function loadProjects() {
  const [projects, settings] = await Promise.all([
    request("/api/v1/projects"),
    request("/api/v1/settings/ai"),
  ]);
  $("#stat-total").textContent = projects.data.length;
  $("#stat-active").textContent = projects.data.filter(
    (project) => project.enabled,
  ).length;
  $("#stat-ai").textContent = settings.data.configured ? "已配置" : "待配置";
  $("#project-count").textContent = projects.data.length;
  const container = $("#projects");
  container.replaceChildren();
  if (!projects.data.length) {
    const empty = node("div", "empty-state", "还没有项目");
    empty.append(node("p", "", "点击「新建项目」，开始连接你的客服站点。"));
    container.append(empty);
  }
  for (const project of projects.data) {
    const card = node("article", "project-card");
    const top = node("div", "project-card-top");
    const icon = node("span", "project-icon", project.name?.slice(0, 1) || "K");
    icon.setAttribute("aria-hidden", "true");
    top.append(
      icon,
      node("h3", "", project.name || "未命名项目"),
      node(
        "span",
        `status-badge ${project.enabled ? "ready" : ""}`,
        project.enabled ? "运行中" : "未启用",
      ),
    );
    const meta = node("div", "project-meta");
    meta.append(
      node("span", "", `Crisp ${project.websiteId ? "已连接" : "未设置"}`),
      node("span", "", `Telegram ${project.telegramId ? "已连接" : "未设置"}`),
      node("span", "", `AI 回复${project.enableAI ? "开启" : "关闭"}`),
    );
    const actions = node("div", "project-actions");
    const edit = node("a", "", "管理项目 →");
    edit.href = `/dashboard/project/?id=${encodeURIComponent(project.id)}`;
    const download = node("a", "", "导出配置 ↗");
    download.href = `/api/v1/exportProject?id=${encodeURIComponent(project.id)}`;
    actions.append(edit, download);
    card.append(top, meta, actions);
    container.append(card);
  }
}

if (page === "dashboard") {
  loadProjects().catch((error) => {
    message("#page-message", error.message, "error");
    $("#projects").replaceChildren(
      node("div", "empty-state", "暂时无法加载项目，请刷新重试。"),
    );
  });
  $("#new-project").addEventListener("click", () =>
    $("#create-dialog").showModal(),
  );
  $("#close-dialog").addEventListener("click", () =>
    $("#create-dialog").close(),
  );
  $("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const result = await request("/api/v1/createProject", {
        method: "POST",
        body: { name: $("#project-name").value.trim() },
      });
      location.assign(
        `/dashboard/project/?id=${encodeURIComponent(result.data[0].id)}`,
      );
    } catch (error) {
      message("#create-message", error.message, "error");
      button.disabled = false;
    }
  });
  $("#import-project").addEventListener("click", () =>
    $("#import-file").click(),
  );
  $("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const button = $("#import-project");
    button.disabled = true;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("文件超过 10 MB，请缩小后重试");
      let body;
      try {
        body = JSON.parse(await file.text());
      } catch {
        throw new Error("请选择有效的项目 JSON 文件");
      }
      const result = await request("/api/v1/importProject", {
        method: "POST",
        body,
      });
      message(
        "#page-message",
        [
          "项目已导入，默认保持停用，请检查配置后启用。",
          ...(result.warnings || []),
        ].join("\n"),
        "success",
      );
      await loadProjects();
    } catch (error) {
      message("#page-message", error.message, "error");
    } finally {
      button.disabled = false;
      event.target.value = "";
    }
  });
}

if (page === "ai") {
  const form = $("#ai-form");
  const save = $("#save-ai");
  const test = $("#test-connection");
  let loaded = false;
  let busy = false;
  function setDirty(value) {
    dirty = value;
    $("#save-state").textContent = value ? "有未保存的修改" : "配置已同步";
    $("#save-indicator").className =
      `save-indicator ${value ? "dirty" : "saved"}`;
  }
  function applyPublicState(config) {
    $("#config-status").textContent = config.configured
      ? "● 接口已配置"
      : "○ 等待配置";
    $("#config-status").className =
      `status-badge ${config.configured ? "ready" : ""}`;
    $("#key-status").textContent = config.hasApiKey ? "已安全保存" : "尚未设置";
    $("#key-status").className =
      `key-status ${config.hasApiKey ? "ready" : ""}`;
    $("#summary-key").textContent = config.hasApiKey ? "已设置" : "未设置";
    $("#config-source").textContent =
      config.source === "database" ? "后台配置" : "环境变量";
    $("#api-key").placeholder = config.hasApiKey
      ? "留空保留现有密钥"
      : "输入 API 密钥";
    $("#key-help").textContent = config.hasApiKey
      ? "已保存的密钥不会回显。留空则保留原密钥，填写新值将替换。"
      : "密钥仅保存在服务器，不会通过读取接口返回。";
  }
  const values = () => ({
    baseUrl: $("#base-url").value.trim(),
    apiKey: $("#api-key").value.trim(),
    model: $("#chat-model").value.trim(),
    embeddingModel: $("#embedding-model").value.trim(),
  });
  function setBusy(value) {
    busy = value;
    for (const input of form.querySelectorAll("input,button"))
      input.disabled = value;
    save.textContent = value ? "处理中…" : "保存配置 →";
  }
  // Prevent submitting defaults while the persisted configuration is loading.
  setBusy(true);
  request("/api/v1/settings/ai")
    .then(({ data }) => {
      $("#base-url").value = data.baseUrl;
      $("#chat-model").value = data.model;
      $("#embedding-model").value = data.embeddingModel;
      applyPublicState(data);
      loaded = true;
      setBusy(false);
      setDirty(false);
    })
    .catch((error) => {
      $("#save-state").textContent = "配置读取失败，请刷新重试";
      message("#form-message", error.message, "error");
    });
  form.addEventListener("input", (event) => {
    if (!loaded || event.target.id === "test-embedding") return;
    setDirty(true);
    message("#form-message", "");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loaded || busy) return;
    const data = values();
    setBusy(true);
    message("#form-message", "正在保存配置…");
    try {
      const result = await request("/api/v1/settings/ai", {
        method: "PUT",
        body: data,
      });
      $("#api-key").value = "";
      $("#api-key").type = "password";
      const reveal = document.querySelector('[data-reveal="api-key"]');
      reveal.textContent = "显示";
      reveal.setAttribute("aria-label", "显示密钥");
      reveal.setAttribute("aria-pressed", "false");
      $("#base-url").value = result.data.baseUrl;
      applyPublicState(result.data);
      setDirty(false);
      message(
        "#form-message",
        "配置已保存，即时生效。请在项目「智能回复」中开启需要的能力。",
        "success",
      );
    } catch (error) {
      message("#form-message", error.message, "error");
    } finally {
      setBusy(false);
    }
  });
  test.addEventListener("click", async () => {
    if (!loaded || busy || !form.reportValidity()) return;
    const data = { ...values(), testEmbedding: $("#test-embedding").checked };
    setBusy(true);
    message("#form-message", "正在验证当前表单中的连接参数…");
    try {
      const result = await request("/api/v1/settings/ai/test", {
        method: "POST",
        body: data,
      });
      message(
        "#form-message",
        `${result.message} · ${result.latencyMs} ms${result.embeddingDimensions ? ` · ${result.embeddingDimensions} 维` : ""}。测试未保存配置。`,
        "success",
      );
    } catch (error) {
      message("#form-message", error.message, "error");
    } finally {
      setBusy(false);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}
