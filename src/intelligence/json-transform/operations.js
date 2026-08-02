import { clone, getPath, setPath } from "./core.js";

export const NUMERIC_FORMULA_ROUNDING = Object.freeze(["half-up", "half-even", "half-away", "floor", "ceil", "trunc", "none"]);

export function parseJson(value, label = "JSON") {
  if (typeof value !== "string") return clone(value);
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error?.message || "Invalid JSON";
    throw new Error(`${label}: ${message}`);
  }
}

export function coerce(value, to) {
  if (to === "number") return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
  if (to === "string") return value === undefined || value === null ? value : String(value);
  if (to === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }
  return value;
}

export function titleCase(value) {
  return String(value ?? "").toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

export function transformString(value, mode) {
  const text = String(value ?? "");
  if (mode?.includes("+")) return mode.split("+").reduce((current, nextMode) => transformString(current, nextMode), text);
  if (mode === "identity") return text;
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  if (mode === "title") return titleCase(text);
  if (mode === "trim") return text.trim();
  return text;
}

function collapseWhitespace(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizePhone(value) {
  const text = String(value ?? "").trim();
  const digits = text.replace(/\D/g, "");
  const looksNorthAmericanLocal = digits.length === 10 && /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(text);
  if (text.startsWith("+")) return `+${digits}`;
  if (looksNorthAmericanLocal) return `+1${digits}`;
  return digits;
}

function normalizePhoneWithPolicy(value, policy = {}) {
  const text = String(value ?? "").trim();
  const digits = text.replace(/\D/g, "");
  if (!digits) return null;
  if (text.startsWith("+")) return digits.length >= 7 ? `+${digits}` : null;
  if (policy.defaultCountryCode && digits.length === (policy.localDigits || 10)) return `+${policy.defaultCountryCode}${digits}`;
  if (policy.requireCountryCode) return null;
  return normalizePhone(value);
}

export function phonePolicyForExamples(examples, sourcePath, targetValues) {
  const sourceValues = examples.map(example => String(getPath(example.input, sourcePath) ?? "").trim());
  const targetCodes = targetValues
    .filter(value => typeof value === "string" && value.startsWith("+"))
    .map(value => value.replace(/\D/g, ""))
    .map(digits => digits.startsWith("1") && digits.length === 11 ? "1" : digits.length > 10 ? digits.slice(0, digits.length - 10) : null)
    .filter(Boolean);
  const localPrefixes = sourceValues.map((value, index) => {
    const sourceDigits = value.replace(/\D/g, "");
    const targetDigits = String(targetValues[index] ?? "").replace(/\D/g, "");
    if (value.startsWith("+") || !String(targetValues[index] ?? "").startsWith("+")) return null;
    if (!targetDigits.endsWith(sourceDigits)) return null;
    return targetDigits.slice(0, targetDigits.length - sourceDigits.length);
  }).filter(Boolean);
  const defaultCountryCode = localPrefixes.length && new Set(localPrefixes).size === 1
    ? localPrefixes[0]
    : targetCodes.includes("1") ? "1" : null;
  return {
    defaultCountryCode,
    localDigits: 10,
    requireCountryCode: targetValues.every(value => typeof value === "string" && value.startsWith("+")) && !defaultCountryCode,
  };
}

function decodeS3Key(value) {
  const text = String(value ?? "").replace(/\+/g, " ");
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function parseDateParts(value) {
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (match) return validDateParts({ year: match[1], month: match[2], day: match[3] });
  match = text.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:[T\s].*)?$/);
  if (match) return validDateParts({ year: match[1], month: match[2], day: match[3] });
  match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return validDateParts({ year: match[3], month: match[2], day: match[1] });
  match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) return validDateParts({ year: match[3], month: match[2], day: match[1] });
  return null;
}

function validDateParts(parts) {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return parts;
}

export function isAmbiguousDateText(value) {
  const match = String(value ?? "").trim().match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!match) return false;
  return Number(match[1]) <= 12 && Number(match[2]) <= 12;
}

export function formatDateParts(parts, mode) {
  if (!parts) return null;
  if (mode === "isoDate") return `${parts.year}-${parts.month}-${parts.day}`;
  if (mode === "usSlash") return `${parts.month}/${parts.day}/${parts.year}`;
  if (mode === "euSlash") return `${parts.day}/${parts.month}/${parts.year}`;
  if (mode === "yearMonth") return `${parts.year}-${parts.month}`;
  if (mode === "year") return parts.year;
  return null;
}

function normalizeDate(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  return formatDateParts(parseDateParts(text), "isoDate") || text;
}

export function normalizeString(value, mode, options = {}) {
  if (mode === "collapseWhitespace") return collapseWhitespace(value);
  if (mode === "phone") return normalizePhoneWithPolicy(value, options.phonePolicy);
  if (mode === "dateNormalize") return normalizeDate(value);
  if (mode === "s3KeyDecode") return decodeS3Key(value);
  return transformString(value, mode);
}

export function parseQuantity(value) {
  const match = String(value ?? "").trim().match(/^(-?\d+(?:\.\d+)?)([a-zA-Z]+)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? { amount, unit: match[2] } : null;
}

export function formatQuantity(amount, unit) {
  const rounded = Number(amount.toFixed(6));
  return `${String(rounded)}${unit}`;
}

export function numericFormulaRounding(options = {}) {
  if (options.rounding) return options.rounding;
  if (options.round === "round") return "half-up";
  return options.round || "none";
}

function roundHalfEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  const epsilon = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(value)) * 4);
  if (Math.abs(fraction - 0.5) <= epsilon) return Math.abs(lower % 2) === 0 ? lower : lower + 1;
  return Math.round(value);
}

export function roundNumericFormulaValue(value, rounding) {
  if (rounding === "half-up") return Math.round(value);
  if (rounding === "half-even") return roundHalfEven(value);
  if (rounding === "half-away") return value < 0 ? -Math.round(-value) : Math.round(value);
  if (rounding === "floor") return Math.floor(value);
  if (rounding === "ceil") return Math.ceil(value);
  if (rounding === "trunc") return Math.trunc(value);
  return value;
}

export function applyNumericFormula(baseValue, rateValue, options = {}) {
  const base = Number(baseValue);
  const rate = Number(rateValue);
  if (!Number.isFinite(base) || !Number.isFinite(rate)) return null;
  const baseDivisor = options.baseDivisor || 1;
  const rateDivisor = options.rateDivisor || 100;
  const direction = options.direction === "decrease" ? -1 : 1;
  const decimals = Number.isInteger(options.decimals) ? options.decimals : 2;
  const factor = 10 ** decimals;
  const rounding = numericFormulaRounding(options);
  if (rounding === "none") {
    return options.evaluationOrder === "integer-rate"
      ? (base * (rateDivisor + direction * rate)) / (baseDivisor * rateDivisor)
      : (base / baseDivisor) * (1 + direction * (rate / rateDivisor));
  }
  const scaled = options.evaluationOrder === "integer-rate"
    ? (base * (rateDivisor + direction * rate) * factor) / (baseDivisor * rateDivisor)
    : ((base / baseDivisor) * (1 + direction * (rate / rateDivisor))) * factor;
  return roundNumericFormulaValue(scaled, rounding) / factor;
}

export function projectArrayRow(row, fields) {
  return fields.reduce((record, field) => {
    const value = getPath(row, field.source);
    return setPath(record, field.target, value === undefined ? undefined : field.transform ? normalizeString(value, field.transform) : value);
  }, {});
}
