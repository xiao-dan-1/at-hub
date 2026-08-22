import { decodeJsonObject } from "./jwt.js";

const JWT_PATTERN = /(?<![A-Za-z0-9_-])(?:Bearer\s+)?([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/giu;
const CREDENTIAL_LINE_SEPARATOR = "----";
const TOKEN_KEYS = new Set(["accesstoken", "access_token", "token"]);

function normalizeCandidate(value) {
  const token = String(value ?? "").trim().replace(/^Bearer\s+/iu, "").trim();
  const match = token.match(/^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u);
  if (!match) return "";

  const [header, payload] = match[1].split(".");
  try {
    decodeJsonObject(header, "Header");
    decodeJsonObject(payload, "Payload");
  } catch {
    return "";
  }

  return match[1];
}

function addToken(collection, token, source) {
  const normalized = normalizeCandidate(token);
  if (!normalized) return "invalid";
  if (collection.seen.has(normalized)) return "duplicate";

  collection.seen.add(normalized);
  collection.tokens.push(normalized);
  if (!collection.sources.includes(source)) {
    collection.sources.push(source);
  }
  return "added";
}

function readNonEmptyLineRanges(text) {
  const ranges = [];
  let lineStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== "\n") continue;
    const lineEnd = index;
    if (text.slice(lineStart, lineEnd).trim()) ranges.push({ start: lineStart, end: lineEnd });
    lineStart = index + 1;
  }
  return ranges;
}

function rangesOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function walkJson(value, collection) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, collection);
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (TOKEN_KEYS.has(key.toLowerCase()) && typeof nestedValue === "string") {
      addToken(collection, nestedValue, "json");
    }
    walkJson(nestedValue, collection);
  }
}

function readBalancedJsonObjects(text) {
  const values = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, index + 1);
        try {
          values.push({ start, end: index + 1, value: JSON.parse(candidate) });
        } catch {
          // Ignore malformed JSON snippets. The caller still gets a safe empty result.
        }
        start = -1;
      }
    }
  }

  return values;
}

function readCredentialLineTokens(text) {
  const events = [];
  const ranges = [];
  let lineStart = 0;

  for (let index = 0; index <= text.length; index += 1) {
    const isLineBreak = index === text.length || text[index] === "\n";
    if (!isLineBreak) continue;

    const lineEnd = index;
    const rawLine = text.slice(lineStart, lineEnd);
    if (rawLine.includes(CREDENTIAL_LINE_SEPARATOR)) {
      ranges.push({ start: lineStart, end: lineEnd });

      const trimmed = rawLine.trim();
      const parts = trimmed.split(CREDENTIAL_LINE_SEPARATOR);
      if (parts.length >= 4) {
        const candidate = parts.at(-1)?.trim() ?? "";
        const normalized = normalizeCandidate(candidate);
        if (normalized) {
          const leadingWhitespace = rawLine.search(/\S/u);
          const contentStart = leadingWhitespace === -1 ? 0 : leadingWhitespace;
          const candidateOffset = trimmed.lastIndexOf(candidate);
          events.push({
            index: lineStart + contentStart + candidateOffset,
            rangeStart: lineStart,
            rangeEnd: lineEnd,
            source: "credential-line",
            token: normalized,
          });
        }
      }
    }

    lineStart = index + 1;
  }

  return { events, ranges };
}

function isInsideRanges(index, ranges) {
  return ranges.some(range => index >= range.start && index < range.end);
}

export function extractAccessTokens(input) {
  const text = String(input ?? "");
  const collection = { tokens: [], sources: [], seen: new Set() };
  const events = [];
  const credentialLines = readCredentialLineTokens(text);
  const jsonObjects = readBalancedJsonObjects(text);

  for (const credentialLine of credentialLines.events) {
    events.push(credentialLine);
  }
  for (const jsonObject of jsonObjects) {
    const jsonCollection = { tokens: [], sources: [], seen: new Set() };
    walkJson(jsonObject.value, jsonCollection);
    for (const token of jsonCollection.tokens) {
      events.push({
        index: jsonObject.start,
        rangeStart: jsonObject.start,
        rangeEnd: jsonObject.end,
        source: "json",
        token,
      });
    }
  }

  for (const match of text.matchAll(JWT_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const isInsideJson = isInsideRanges(matchIndex, jsonObjects);
    const isInsideCredentialLine = isInsideRanges(matchIndex, credentialLines.ranges);
    if (!isInsideJson && !isInsideCredentialLine) {
      events.push({
        index: matchIndex,
        rangeStart: matchIndex,
        rangeEnd: matchIndex + match[0].length,
        source: "jwt",
        token: match[1],
      });
    }
  }

  events.sort((left, right) => left.index - right.index);
  const recognizedRanges = [];
  let duplicateCount = 0;
  for (const event of events) {
    const outcome = addToken(collection, event.token, event.source);
    if (outcome === "invalid") continue;
    if (outcome === "duplicate") duplicateCount += 1;
    recognizedRanges.push({ start: event.rangeStart, end: event.rangeEnd });
  }

  const inputLineRanges = readNonEmptyLineRanges(text);
  const unrecognizedLineCount = inputLineRanges.filter(lineRange => (
    !recognizedRanges.some(recognizedRange => rangesOverlap(lineRange, recognizedRange))
  )).length;

  return {
    tokens: collection.tokens,
    sources: collection.sources,
    input_line_count: inputLineRanges.length,
    duplicate_count: duplicateCount,
    unrecognized_line_count: unrecognizedLineCount,
  };
}
