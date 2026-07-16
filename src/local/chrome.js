const path = location.pathname.replace(/\/+$/, "") || "/";
const themeButtons = Array.from(document.querySelectorAll("[data-theme-toggle]"));

function storedTheme() {
  try {
    const value = localStorage.getItem("lm-theme");
    return value === "dark" || value === "light" ? value : "";
  } catch (error) {
    return "";
  }
}

function effectiveTheme() {
  const explicit = document.documentElement.dataset.theme || storedTheme();
  if (explicit === "dark" || explicit === "light") return explicit;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function syncThemeButtons() {
  const current = effectiveTheme();
  const next = current === "dark" ? "light" : "dark";
  themeButtons.forEach(button => {
    button.setAttribute("aria-label", `Switch to ${next} theme`);
    button.setAttribute("aria-pressed", String(current === "dark"));
    button.title = `Switch to ${next} theme`;
  });
}

document.querySelectorAll(".site-nav a[href], .site-footer a[href]").forEach(link => {
  const href = new URL(link.getAttribute("href"), location.origin).pathname.replace(/\/+$/, "") || "/";
  const active = href === path || (href === "/latentlog" && path.startsWith("/latentlog/"));
  if (active) link.setAttribute("aria-current", "page");
  else link.removeAttribute("aria-current");
});

themeButtons.forEach(button => {
  button.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("lm-theme", next);
    } catch (error) {}
    syncThemeButtons();
  });
});

syncThemeButtons();

try {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeButtons);
} catch (error) {}
