import { assertSafeObjectKey } from "./safety.js";

function normalizeLineEndings(text) {
  return String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export const SQL_DEFAULT_LIMITS = {
  maxCharacters: 2 * 1024 * 1024,
  maxRows: 10000,
  maxStatements: 1000,
};

function parseLimit(value, fallback) {
  if (value === Infinity || value === false || value === null) return Infinity;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sqlParseOptions(options = {}) {
  return {
    maxCharacters: parseLimit(options.maxCharacters, SQL_DEFAULT_LIMITS.maxCharacters),
    maxRows: parseLimit(options.maxRows, SQL_DEFAULT_LIMITS.maxRows),
    maxStatements: parseLimit(options.maxStatements, SQL_DEFAULT_LIMITS.maxStatements),
  };
}

function sqlError(message, index = null) {
  return new Error(Number.isFinite(index) ? `${message} at position ${index}.` : message);
}

function skipWhitespace(source, index) {
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

function keywordAt(source, index, keyword) {
  const slice = source.slice(index, index + keyword.length);
  if (slice.toLowerCase() !== keyword.toLowerCase()) return false;
  const before = index > 0 ? source[index - 1] : "";
  const after = source[index + keyword.length] || "";
  return !/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after);
}

function identifierStartIndex(source) {
  return skipWhitespace(source, 0);
}

function statementStartsWithKeyword(source, keyword) {
  return keywordAt(source, identifierStartIndex(source), keyword);
}

function expectKeyword(source, index, keyword) {
  const cursor = skipWhitespace(source, index);
  if (!keywordAt(source, cursor, keyword)) throw sqlError(`expected ${keyword}`, cursor);
  return cursor + keyword.length;
}

function readQuotedIdentifier(source, index, quote) {
  let value = "";
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === "\\" && cursor + 1 < source.length) {
      value += source[cursor + 1];
      cursor += 1;
      continue;
    }
    if (char === quote) {
      if (source[cursor + 1] === quote) {
        value += quote;
        cursor += 1;
        continue;
      }
      return { value, index: cursor + 1 };
    }
    value += char;
  }
  throw sqlError("unterminated quoted identifier", index);
}

function readIdentifierPart(source, index) {
  const cursor = skipWhitespace(source, index);
  const char = source[cursor];
  if (char === "`" || char === "\"") return readQuotedIdentifier(source, cursor, char);
  if (char === "[") {
    const end = source.indexOf("]", cursor + 1);
    if (end < 0) throw sqlError("unterminated bracket identifier", cursor);
    return { value: source.slice(cursor + 1, end), index: end + 1 };
  }

  const match = source.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_$]*/);
  if (!match) throw sqlError("expected identifier", cursor);
  return { value: match[0], index: cursor + match[0].length };
}

function readIdentifier(source, index) {
  const parts = [];
  let cursor = index;

  while (true) {
    const part = readIdentifierPart(source, cursor);
    parts.push(part.value);
    cursor = skipWhitespace(source, part.index);
    if (source[cursor] !== ".") break;
    cursor += 1;
  }

  return { value: parts.join("."), index: cursor };
}

function readParenthesized(source, index) {
  const start = skipWhitespace(source, index);
  if (source[start] !== "(") throw sqlError("expected '('", start);

  let quote = null;
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const char = source[cursor];

    if (quote) {
      if (quote === "'") {
        if (char === "\\" && cursor + 1 < source.length) {
          cursor += 1;
          continue;
        }
        if (char === "'" && source[cursor + 1] === "'") {
          cursor += 1;
          continue;
        }
      } else if (char === "\\" && cursor + 1 < source.length) {
        cursor += 1;
        continue;
      } else if (char === quote && source[cursor + 1] === quote) {
        cursor += 1;
        continue;
      }

      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: source.slice(start + 1, cursor),
          index: cursor + 1,
        };
      }
      if (depth < 0) throw sqlError("unexpected ')'", cursor);
    }
  }

  throw sqlError("unterminated parenthesized list", start);
}

function splitTopLevel(source, separator = ",") {
  const items = [];
  let quote = null;
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (quote === "'") {
        if (char === "\\" && index + 1 < source.length) {
          index += 1;
          continue;
        }
        if (char === "'" && source[index + 1] === "'") {
          index += 1;
          continue;
        }
      } else if (char === "\\" && index + 1 < source.length) {
        index += 1;
        continue;
      } else if (char === quote && source[index + 1] === quote) {
        index += 1;
        continue;
      }

      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth < 0) throw sqlError("unexpected ')'");
      continue;
    }
    if (char === separator && depth === 0) {
      items.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (quote) throw sqlError("unterminated quoted value");
  if (depth !== 0) throw sqlError("unbalanced parentheses");
  items.push(source.slice(start).trim());
  return items.filter(item => item.length > 0);
}

function splitStatements(source) {
  const statements = [];
  let quote = null;
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (quote === "'") {
        if (char === "\\" && index + 1 < source.length) {
          index += 1;
          continue;
        }
        if (char === "'" && source[index + 1] === "'") {
          index += 1;
          continue;
        }
      } else if (char === "\\" && index + 1 < source.length) {
        index += 1;
        continue;
      } else if (char === quote && source[index + 1] === quote) {
        index += 1;
        continue;
      }

      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === ";" && depth === 0) {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }

  if (quote) throw sqlError("unterminated quoted value");
  if (depth !== 0) throw sqlError("unbalanced parentheses");
  const trailing = source.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function stripSqlComments(source) {
  let output = "";
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || "";

    if (quote) {
      output += char;
      if (quote === "'") {
        if (char === "\\" && index + 1 < source.length) {
          output += source[index + 1];
          index += 1;
          continue;
        }
        if (char === "'" && source[index + 1] === "'") {
          output += source[index + 1];
          index += 1;
          continue;
        }
      } else if (char === "\\" && index + 1 < source.length) {
        output += source[index + 1];
        index += 1;
        continue;
      } else if (char === quote && source[index + 1] === quote) {
        output += source[index + 1];
        index += 1;
        continue;
      }

      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      output += char;
      continue;
    }

    if (char === "-" && next === "-") {
      const after = source[index + 2] || "";
      if (!after || /\s/.test(after)) {
        while (index < source.length && source[index] !== "\n") index += 1;
        output += "\n";
        continue;
      }
    }

    if (char === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      if (index >= source.length) throw sqlError("unterminated block comment");
      index += 1;
      output += " ";
      continue;
    }

    output += char;
  }

  if (quote) throw sqlError("unterminated quoted value");
  return output;
}

function findTopLevelEquals(source) {
  let quote = null;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (quote === "'") {
        if (char === "\\" && index + 1 < source.length) {
          index += 1;
          continue;
        }
        if (char === "'" && source[index + 1] === "'") {
          index += 1;
          continue;
        }
      } else if (char === "\\" && index + 1 < source.length) {
        index += 1;
        continue;
      } else if (char === quote && source[index + 1] === quote) {
        index += 1;
        continue;
      }

      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "=" && depth === 0) return index;
  }

  return -1;
}

function parseSqlString(raw) {
  const text = raw.trim();
  if (!text.startsWith("'")) throw sqlError("expected SQL string");

  let value = "";
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      if (index + 1 >= text.length) throw sqlError("unterminated backslash escape");
      const escaped = text[index + 1];
      if (escaped === "0") value += "\0";
      else if (escaped === "b") value += "\b";
      else if (escaped === "n") value += "\n";
      else if (escaped === "r") value += "\r";
      else if (escaped === "t") value += "\t";
      else if (escaped === "Z") value += "\x1A";
      else value += escaped;
      index += 1;
      continue;
    }
    if (char === "'") {
      if (text[index + 1] === "'") {
        value += "'";
        index += 1;
        continue;
      }
      if (text.slice(index + 1).trim()) throw sqlError("unexpected text after SQL string");
      return value;
    }
    value += char;
  }

  throw sqlError("unterminated SQL string");
}

function parseSqlValue(raw) {
  const value = raw.trim();
  if (!value) throw sqlError("empty value");
  if (value.startsWith("'")) return parseSqlString(value);
  if (/^[en]'/i.test(value)) return parseSqlString(value.slice(1));
  if (/^null$/i.test(value)) return null;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return Number(value);
  return `[SQL expression: ${value}]`;
}

function parseColumnList(source) {
  const columns = splitTopLevel(source).map(item => {
    const parsed = readIdentifier(item, 0);
    const trailing = item.slice(skipWhitespace(item, parsed.index)).trim();
    if (trailing) throw sqlError(`unexpected column text "${trailing}"`);
    return parsed.value;
  });
  if (!columns.length) throw sqlError("column list is empty");
  const seen = new Set();
  for (const column of columns) {
    assertSafeObjectKey(column, "SQL column");
    if (seen.has(column)) throw sqlError(`duplicate column "${column}"`);
    seen.add(column);
  }
  return columns;
}

function parseInsertPrefix(statement) {
  let cursor = skipWhitespace(statement, 0);
  if (keywordAt(statement, cursor, "REPLACE")) {
    cursor = expectKeyword(statement, cursor, "REPLACE");
    return expectKeyword(statement, cursor, "INTO");
  }

  cursor = expectKeyword(statement, cursor, "INSERT");
  cursor = skipWhitespace(statement, cursor);

  if (keywordAt(statement, cursor, "OR")) {
    cursor = expectKeyword(statement, cursor, "OR");
    const strategy = readIdentifierPart(statement, cursor);
    if (!/^(rollback|abort|replace|fail|ignore)$/i.test(strategy.value)) {
      throw sqlError(`unsupported INSERT OR strategy "${strategy.value}"`, cursor);
    }
    cursor = strategy.index;
  } else {
    while (true) {
      const current = skipWhitespace(statement, cursor);
      const modifier = ["LOW_PRIORITY", "DELAYED", "HIGH_PRIORITY", "IGNORE"].find(keyword => keywordAt(statement, current, keyword));
      if (!modifier) break;
      cursor = current + modifier.length;
    }
  }

  return expectKeyword(statement, cursor, "INTO");
}

function parseSetAssignments(source) {
  const row = {};
  for (const assignment of splitTopLevel(source)) {
    const equals = findTopLevelEquals(assignment);
    if (equals < 0) throw sqlError(`expected '=' in SET assignment "${assignment}"`);
    const parsedColumn = readIdentifier(assignment.slice(0, equals), 0);
    const trailing = assignment.slice(skipWhitespace(assignment, parsedColumn.index), equals).trim();
    if (trailing) throw sqlError(`unexpected column text "${trailing}"`);
    const column = parsedColumn.value;
    assertSafeObjectKey(column, "SQL column");
    if (Object.prototype.hasOwnProperty.call(row, column)) throw sqlError(`duplicate column "${column}"`);
    row[column] = parseSqlValue(assignment.slice(equals + 1));
  }
  if (!Object.keys(row).length) throw sqlError("SET assignment list is empty");
  return row;
}

function enforceRowBudget(rowBudget) {
  rowBudget.count += 1;
  if (rowBudget.count > rowBudget.maxRows) {
    throw sqlError(`SQL INSERT parsing is limited to ${rowBudget.maxRows.toLocaleString()} rows. Split the dump or pass a higher maxRows option for trusted local use.`);
  }
}

function isIgnorableInsertTail(trailing) {
  const text = trailing.trim();
  return !text
    || /^ON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(text)
    || /^ON\s+CONFLICT\b/i.test(text)
    || /^RETURNING\b/i.test(text);
}

function unsupportedInsertSyntax(statement, cursor) {
  const trailing = statement.slice(cursor).trim();
  if (/^SELECT\b/i.test(trailing)) {
    throw sqlError("SQL INSERT parser supports row data only: use INSERT ... VALUES or INSERT ... SET. INSERT ... SELECT is not supported.", cursor);
  }
  if (/^DEFAULT\s+VALUES\b/i.test(trailing)) {
    throw sqlError("SQL INSERT parser supports explicit row values only. DEFAULT VALUES inserts are not supported.", cursor);
  }
  throw sqlError("SQL INSERT parser supports INSERT ... VALUES or INSERT ... SET row data only.", cursor);
}

function parseInsertStatement(statement, rowBudget) {
  let cursor = parseInsertPrefix(statement);
  const table = readIdentifier(statement, cursor);
  assertSafeObjectKey(table.value, "SQL table");
  cursor = skipWhitespace(statement, table.index);

  let columns = null;
  if (statement[cursor] === "(") {
    const parsedColumns = readParenthesized(statement, cursor);
    columns = parseColumnList(parsedColumns.value);
    cursor = skipWhitespace(statement, parsedColumns.index);
  }

  if (keywordAt(statement, cursor, "SET")) {
    if (columns) throw sqlError("column list cannot be combined with SET syntax", cursor);
    cursor = expectKeyword(statement, cursor, "SET");
    enforceRowBudget(rowBudget);
    return { table: table.value, rows: [parseSetAssignments(statement.slice(cursor))] };
  }

  const valueKeyword = keywordAt(statement, cursor, "VALUES") ? "VALUES" : keywordAt(statement, cursor, "VALUE") ? "VALUE" : null;
  if (!valueKeyword) unsupportedInsertSyntax(statement, cursor);
  cursor = expectKeyword(statement, cursor, valueKeyword);
  const rows = [];

  while (skipWhitespace(statement, cursor) < statement.length) {
    const parsedRow = readParenthesized(statement, cursor);
    const values = splitTopLevel(parsedRow.value).map(parseSqlValue);
    if (columns && values.length !== columns.length) {
      throw sqlError(`expected ${columns.length} values, got ${values.length}`, cursor);
    }
    enforceRowBudget(rowBudget);
    rows.push(columns
      ? Object.fromEntries(columns.map((column, index) => [column, values[index]]))
      : values);

    cursor = skipWhitespace(statement, parsedRow.index);
    if (statement[cursor] === ",") {
      cursor += 1;
      continue;
    }
    const trailing = statement.slice(cursor).trim();
    if (trailing && !isIgnorableInsertTail(trailing)) throw sqlError(`unexpected text "${trailing}"`, cursor);
    break;
  }

  if (!rows.length) throw sqlError("INSERT has no rows");
  return { table: table.value, rows };
}

function isInsertLikeStatement(statement) {
  return statementStartsWithKeyword(statement, "INSERT") || statementStartsWithKeyword(statement, "REPLACE");
}

export function detectSQL(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  try {
    return splitStatements(stripSqlComments(normalizeLineEndings(text)))
      .some(statement => isInsertLikeStatement(statement));
  } catch {
    return /^\s*(?:INSERT|REPLACE)\b/im.test(text);
  }
}

function parseSQLInsertInternal(text, options = {}) {
  if (typeof text !== "string") throw sqlError("input must be a string.");
  const limits = sqlParseOptions(options);
  if (text.length > limits.maxCharacters) {
    throw sqlError(`SQL input is limited to ${limits.maxCharacters.toLocaleString()} characters. Import a smaller dump slice or pass a higher maxCharacters option for trusted local use.`);
  }
  const source = stripSqlComments(normalizeLineEndings(text)).trim();
  if (!source) throw sqlError("input is empty.");

  const allStatements = splitStatements(source);
  const statements = allStatements.filter(isInsertLikeStatement);
  const skippedStatements = allStatements.length - statements.length;
  if (!statements.length) throw sqlError("no INSERT or REPLACE row statements found. SQL input must contain INSERT ... VALUES, INSERT ... SET, or REPLACE INTO ... VALUES statements.");
  if (statements.length > limits.maxStatements) {
    throw sqlError(`SQL INSERT parsing is limited to ${limits.maxStatements.toLocaleString()} INSERT statements. Split the dump or pass a higher maxStatements option for trusted local use.`);
  }

  const groups = new Map();
  const rowBudget = { count: 0, maxRows: limits.maxRows };
  for (const statement of statements) {
    const parsed = parseInsertStatement(statement, rowBudget);
    if (!groups.has(parsed.table)) groups.set(parsed.table, []);
    groups.get(parsed.table).push(...parsed.rows);
  }

  const value = groups.size === 1 ? [...groups.values()][0] : Object.fromEntries([...groups.entries()]);
  const warnings = [];
  if (skippedStatements > 0) {
    warnings.push({
      message: `Ignored ${skippedStatements.toLocaleString()} non-INSERT SQL statement${skippedStatements === 1 ? "" : "s"} while extracting rows.`,
      skippedStatements,
    });
  }
  return { value, warnings, stats: { rows: rowBudget.count, statements: statements.length, skippedStatements } };
}

export function parseSQLInsert(text, options = {}) {
  return parseSQLInsertInternal(text, options).value;
}

export function parseSQLInsertWithWarnings(text, options = {}) {
  return parseSQLInsertInternal(text, options);
}

export function serializeSQLInsert() {
  throw sqlError("SQL INSERT is input-only. Choose JSON, XML, CSV, TOML, YAML, or .env as the output format.");
}

export const sqlFormat = {
  id: "sql",
  label: "SQL INSERT",
  fileExtension: "sql",
  mimeType: "text/plain",
  inputOnly: true,
  detect: detectSQL,
  parse: parseSQLInsert,
  parseWithWarnings: parseSQLInsertWithWarnings,
  serialize: serializeSQLInsert,
};
