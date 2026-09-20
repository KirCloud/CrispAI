// CrispAI 欢迎语脚本：放在 Crisp 脚本之后加载。
// 接口地址取自本脚本自己的 src，所以部署在哪个域名都不用改
(function () {
  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : "";
  var websiteId = window.CRISP_WEBSITE_ID;

  if (!origin || !websiteId) return;
  window.$crisp = window.$crisp || [];
  window.$crisp.push([
    "on",
    "session:loaded",
    function (sessionId) {
      if (!sessionId) return;
      fetch(origin + "/api/v1/intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website_id: websiteId, session_id: sessionId }),
      });
    },
  ]);
})();
