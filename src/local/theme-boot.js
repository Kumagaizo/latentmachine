try {
  const theme = localStorage.getItem("lm-theme");
  if (theme === "dark" || theme === "light") document.documentElement.setAttribute("data-theme", theme);
} catch {
  // Storage may be unavailable in privacy-restricted contexts.
}
