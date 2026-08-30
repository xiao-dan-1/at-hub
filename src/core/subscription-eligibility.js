function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function rawEligibilityValue(item) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return String(item ?? "");
  const primary = text(item.id ?? item.promo_campaign_id ?? item.title);
  if (primary) return primary;
  try {
    return JSON.stringify(item);
  } catch {
    return String(item);
  }
}

export function hasTrialEligibility(data) {
  return data?.is_eligible_for_free_trial === true
    || (Array.isArray(data?.eligible_promos) && data.eligible_promos.length > 0);
}

export function buildEligibilityDisplay(data) {
  const entries = [];
  const offers = Array.isArray(data?.eligible_offers) ? data.eligible_offers : [];

  offers.map(rawEligibilityValue).filter(Boolean)
    .forEach(value => entries.push({ key: "eligible_offers", value }));
  if (entries.length === 0) {
    return { primary: "—", secondary: "未返回", title: "未返回 eligible_offers", state: "unknown" };
  }

  return {
    primary: entries[0].value,
    secondary: entries.slice(1).map(entry => entry.value).join(" · ") || "—",
    title: entries.map(entry => `${entry.key}: ${entry.value}`).join("\n"),
    state: "available",
  };
}
