const JWT_PATTERN = /\b(?:Bearer\s+)?([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/giu;
const TOKEN_KEYS = new Set(["accesstoken", "access_token", "token"]);

function normalizeCandidate(value) {
  const token = String(value ?? "").trim().replace(/^Bearer\s+/iu, "").trim();
  const match = token.match(/^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u);
  return match?.[1] ?? "";
}

function addToken(collection, token, source) {
  const normalized = normalizeCandidate(token);
  if (!normalized || collection.seen.has(normalized)) return;

  collection.seen.add(normalized);
  collection.tokens.push(normalized);
  if (!collection.sources.includes(source)) {
    collection.sources.push(source);
  }
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

export function extractAccessTokens(input) {
  const text = String(input ?? "");
  const collection = { tokens: [], sources: [], seen: new Set() };
  const events = [];
  const jsonObjects = readBalancedJsonObjects(text);

  for (const jsonObject of jsonObjects) {
    const jsonCollection = { tokens: [], sources: [], seen: new Set() };
    walkJson(jsonObject.value, jsonCollection);
    for (const token of jsonCollection.tokens) {
      events.push({ index: jsonObject.start, source: "json", token });
    }
  }

  for (const match of text.matchAll(JWT_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const isInsideJson = jsonObjects.some(jsonObject => matchIndex >= jsonObject.start && matchIndex < jsonObject.end);
    if (!isInsideJson) {
      events.push({ index: matchIndex, source: "jwt", token: match[1] });
    }
  }

  events.sort((left, right) => left.index - right.index);
  for (const event of events) {
    addToken(collection, event.token, event.source);
  }

  return {
    tokens: collection.tokens,
    sources: collection.sources,
  };
}
