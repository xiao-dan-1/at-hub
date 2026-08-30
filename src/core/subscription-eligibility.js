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
  const promos = Array.isArray(data?.eligible_promos) ? data.eligible_promos : [];
  const offers = Array.isArray(data?.eligible_offers) ? data.eligible_offers : [];

  promos.map(rawEligibilityValue).filter(Boolean)
    .forEach(value => entries.push(`eligible_promos: ${value}`));
  offers.map(rawEligibilityValue).filter(Boolean)
    .forEach(value => entries.push(`eligible_offers: ${value}`));
  for (const key of ["is_eligible_for_free_trial", "is_eligible_for_yearly_plus_subscription"]) {
    if (data?.[key] !== undefined && data?.[key] !== null) entries.push(`${key}: ${String(data[key])}`);
  }
  if (entries.length === 0 && data?.has_previously_paid_subscription === true) {
    entries.push("has_previously_paid_subscription: true");
  }
  if (entries.length === 0) {
    return { primary: "未返回", secondary: "—", title: "未返回原始资格字段", state: "unknown" };
  }

  return {
    primary: entries[0],
    secondary: entries.slice(1).join(" · ") || "—",
    title: entries.join("\n"),
    state: promos.length > 0 || data?.is_eligible_for_free_trial === true ? "trial" : "available",
  };
}
