function normalizeExpectedCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function missingSubscriptionIndexes(expectedCount, items) {
  const count = normalizeExpectedCount(expectedCount);
  const presentIndexes = new Set(
    (Array.isArray(items) ? items : [])
      .map(item => Number(item?.index))
      .filter(index => Number.isInteger(index) && index >= 1 && index <= count),
  );
  const missing = [];
  for (let index = 1; index <= count; index += 1) {
    if (!presentIndexes.has(index)) missing.push(index);
  }
  return missing;
}

export function isSubscriptionBatchComplete({
  expectedCount,
  receivedDone,
  doneCount,
  items,
} = {}) {
  const count = normalizeExpectedCount(expectedCount);
  return receivedDone === true
    && Number(doneCount) === count
    && missingSubscriptionIndexes(count, items).length === 0;
}

export function subscriptionResultNeedsRetry(result) {
  return result?.ok !== true
    || result?.subscription_detail_status === "failed"
    || result?.offers_status === "unknown";
}

export function createIncompleteSubscriptionResult(index, tokenHint = "") {
  return {
    ok: false,
    index,
    ...(tokenHint ? { token_hint: tokenHint } : {}),
    reason: "stream-incomplete",
    message: "流式查询提前结束，该 AT 未返回结果。",
    status: 502,
    subscription_detail_status: "failed",
    offers_status: "unknown",
  };
}
