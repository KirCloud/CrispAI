import { mountAIForm, logout } from "./console.js";

let currentList;
let panel;
let active = false;
let loading;
let previousSelection;
let scheduled = false;

function hideOriginalPanels() {
  if (!active || !panel?.parentElement) return;
  for (const native of panel.parentElement.querySelectorAll(
    '[role="tabpanel"]',
  )) {
    if (native !== panel) native.setAttribute("data-kc-hidden", "");
  }
}
function restoreOriginal() {
  active = false;
  currentList?.classList.remove("kc-ai-active");
  if (panel) panel.hidden = true;
  const tab = document.getElementById("kc-ai-tab");
  if (tab) {
    tab.setAttribute("aria-selected", "false");
    tab.tabIndex = -1;
  }
  if (previousSelection?.element.isConnected) {
    previousSelection.element.setAttribute("aria-selected", "true");
    previousSelection.element.setAttribute("data-selected", "true");
    previousSelection.element.tabIndex = 0;
  }
  previousSelection = undefined;
  document
    .querySelectorAll("[data-kc-hidden]")
    .forEach((native) => native.removeAttribute("data-kc-hidden"));
}
async function loadPanel() {
  if (panel.querySelector("#ai-form")) return;
  if (loading) return loading;
  loading = (async () => {
    const response = await fetch("/api/console/ai-panel", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 401) {
      location.replace(
        `/login?next=${encodeURIComponent(location.pathname + location.search)}`,
      );
      return;
    }
    if (!response.ok) throw new Error("AI 配置暂时无法加载，请稍后重试。");
    const template = document.createElement("template");
    template.innerHTML = await response.text();
    const form = template.content.querySelector("#ai-form");
    if (!form) throw new Error("AI 配置页面加载失败，请刷新重试。");
    panel.replaceChildren(form);
    mountAIForm(form);
  })()
    .catch((error) => {
      panel.replaceChildren();
      const text = document.createElement("p");
      text.className = "kc-card kc-message error";
      text.textContent = error.message;
      panel.append(text);
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}
function openAI() {
  if (!active) {
    const selected = currentList.querySelector(
      '[role="tab"][aria-selected="true"]:not(#kc-ai-tab)',
    );
    if (selected) {
      previousSelection = { element: selected };
      selected.setAttribute("aria-selected", "false");
      selected.removeAttribute("data-selected");
      selected.tabIndex = -1;
    }
  }
  active = true;
  currentList.classList.add("kc-ai-active");
  const tab = document.getElementById("kc-ai-tab");
  tab.setAttribute("aria-selected", "true");
  tab.tabIndex = 0;
  tab.focus({ preventScroll: true });
  panel.hidden = false;
  hideOriginalPanels();
  tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  void loadPanel();
}
function attachProjectTab(list) {
  if (list.querySelector("#kc-ai-tab")) {
    hideOriginalPanels();
    return;
  }
  const nativePanel = document.querySelector('[role="tabpanel"]');
  if (!nativePanel) return;
  currentList = list;
  active = false;
  previousSelection = undefined;
  panel = document.createElement("section");
  panel.id = "kc-ai-panel";
  panel.className = "kc-ai-settings";
  panel.hidden = true;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", "kc-ai-tab");
  panel.tabIndex = 0;
  const placeholder = document.createElement("p");
  placeholder.className = "kc-card kc-inline-loading";
  placeholder.textContent = "正在加载 AI 配置…";
  panel.append(placeholder);
  nativePanel.parentElement.append(panel);
  list.classList.add("kc-extended-tabs");
  const tab = document.createElement("button");
  tab.type = "button";
  tab.id = "kc-ai-tab";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.setAttribute("aria-controls", "kc-ai-panel");
  tab.tabIndex = -1;
  const icon = document.createElement("span");
  icon.textContent = "⚙";
  icon.setAttribute("aria-hidden", "true");
  tab.append(icon, document.createTextNode("AI 配置"));
  list.append(tab);
  list.addEventListener(
    "click",
    (event) => {
      const target = event.target.closest('[role="tab"]');
      if (target === tab) {
        event.preventDefault();
        event.stopPropagation();
        openAI();
      } else if (target && active) restoreOriginal();
    },
    true,
  );
  list.addEventListener(
    "keydown",
    (event) => {
      if (
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const target = event.target.closest('[role="tab"]');
      if (!target) return;
      const tabs = [...list.querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(target);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      event.preventDefault();
      event.stopPropagation();
      if (tabs[next] === tab) openAI();
      else {
        restoreOriginal();
        tabs[next].click();
      }
      tabs[next].focus();
    },
    true,
  );
}

function addHeaderActions() {
  const nav = document.querySelector("nav");
  if (!nav) return;
  const existing = nav.querySelector("#kc-header-actions");
  if (existing) {
    const link = existing.querySelector("a");
    const isProject = location.pathname.startsWith("/dashboard/project");
    if (isProject && link) link.remove();
    if (!isProject && !link) {
      const entry = document.createElement("a");
      entry.href = "/settings/ai";
      entry.className = "kc-header-link";
      entry.textContent = "AI 配置";
      existing.prepend(entry);
    }
    return;
  }
  const lastButton = [...nav.querySelectorAll("button")].at(-1);
  const list = lastButton?.closest("ul");
  if (!list) return;
  const item = document.createElement("li");
  item.id = "kc-header-actions";
  item.className = "kc-header-actions";
  if (!location.pathname.startsWith("/dashboard/project")) {
    const link = document.createElement("a");
    link.href = "/settings/ai";
    link.className = "kc-header-link";
    link.textContent = "AI 配置";
    item.append(link);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kc-header-link";
  button.textContent = "退出登录";
  button.addEventListener("click", () => {
    void logout(button);
  });
  item.append(button);
  list.append(item);
}
function scan() {
  scheduled = false;
  addHeaderActions();
  if (location.pathname.startsWith("/dashboard/project")) {
    const list = document.querySelector('[role="tablist"]');
    if (list) attachProjectTab(list);
  }
}
new MutationObserver(() => {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(scan);
  }
}).observe(document.body, { childList: true, subtree: true });
scan();
