(function () {
  var theme;
  try {
    theme = localStorage.getItem("theme");
  } catch (e) {}
  var dark =
    theme === "dark" ||
    (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.add(dark ? "dark" : "light");
})();
