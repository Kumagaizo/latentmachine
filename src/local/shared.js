export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

export function inlineCodeHtml(value) {
  return String(value ?? "").split(/(`[^`]+`)/g).map(part => (
    part.startsWith("`") && part.endsWith("`")
      ? `<code>${esc(part.slice(1, -1))}</code>`
      : esc(part)
  )).join("");
}

export function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}
