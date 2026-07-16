export const FILE_IMPORT_MAX_BYTES = 1024 * 1024;

const FILE_IMPORT_FORMATS = {
  ".csv": "csv",
  ".tsv": "csv",
  ".env": "env",
  ".json": "json",
  ".sql": "sql",
  ".toml": "toml",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function fileExtension(filename = "") {
  const match = String(filename).toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
}

export function importedFileFormat(file) {
  return FILE_IMPORT_FORMATS[fileExtension(file?.name)];
}

export function unsafeTextReason(text) {
  if (text.includes("\0")) return "The file contains null bytes, so it does not look like plain text.";
  if (/[\x01-\x08\x0B\x0C\x0E-\x1F]/.test(text)) return "The file contains control characters outside normal text.";
  return "";
}

export function validateImportFile(file, options = {}) {
  const maxBytes = Number(options.maxBytes) || FILE_IMPORT_MAX_BYTES;
  if (!file) return { ok: false, tone: "danger", text: "Choose one JSON, XML, CSV, TSV, TOML, SQL INSERT, YAML, or .env file." };
  const format = importedFileFormat(file);
  if (!format) return { ok: false, tone: "danger", text: "Only .json, .xml, .csv, .tsv, .toml, .sql, .yaml, .yml, and .env files can be imported." };
  if (file.size > maxBytes) {
    return { ok: false, tone: "danger", text: `File is too large. Limit is ${formatBytes(maxBytes)}.` };
  }
  return { ok: true, format };
}

export function validateImportText(text) {
  const unsafeReason = unsafeTextReason(text);
  return unsafeReason ? { ok: false, tone: "danger", text: unsafeReason } : { ok: true };
}
