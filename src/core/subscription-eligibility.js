function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function planLabel(...values) {
  const source = values.map(text).filter(Boolean).join(" ").toLowerCase();
  if (source.includes("plus")) return "Plus";
  if (source.includes("pro")) return "Pro";
  if (source.includes("business") || source.includes("team")) return "Business";
  if (source.includes("go")) return "Go";
  return "试用资格";
}

function percentageFromDiscount(discount) {
  const value = Number(discount?.percentage ?? discount?.percent ?? discount);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export function describeEligibilityPromo(item) {
  const value = typeof item === "string" ? { id: item } : item ?? {};
  const id = text(value.id ?? value.promo_campaign_id);
  const title = text(value.title);
  const normalizedId = id.toLowerCase();
  const monthsMatch = normalizedId.match(/(?:^|-)(\d+)-months?(?:-|$)/u);
  const percentMatch = normalizedId.match(/(?:^|-)(\d+)-pct-off(?:-|$)/u);
  const months = monthsMatch ? Number(monthsMatch[1]) : null;
  const percentage = percentMatch ? Number(percentMatch[1]) : percentageFromDiscount(value.discount);
  const free = /(?:^|-)free(?:-|$)/u.test(normalizedId) || percentage === 100;

  let benefit = title || id || "可试用";
  if (free) benefit = months ? `免费 ${months} 个月` : "免费试用";
  else if (percentage) benefit = `${months ? `${months} 个月 · ` : ""}${percentage}% 优惠`;
  else if (months) benefit = `${months} 个月试用`;

  return {
    plan: planLabel(value.plan_name, id, title),
    benefit,
    rawLabel: id || title || benefit,
  };
}

export function hasTrialEligibility(data) {
  return data?.is_eligible_for_free_trial === true
    || (Array.isArray(data?.eligible_promos) && data.eligible_promos.length > 0);
}

function purchasablePlans(data) {
  return [...new Set((data?.eligible_offers ?? []).map(item => (
    planLabel(typeof item === "string" ? item : item?.id)
  )).filter(label => label !== "试用资格"))];
}

export function buildEligibilityDisplay(data) {
  if (data?.eligibility_unconfirmed_due_to_egress === true) {
    const before = text(data.egress_before_country) || "?";
    const after = text(data.egress_after_country) || "?";
    return {
      primary: "需复测",
      secondary: data?.egress_consistency_status === "drifted" ? `${before}→${after}` : "出口未确认",
      title: "出口不稳定，未命中的试用资格不作否定判断",
      state: "uncertain",
    };
  }

  if (hasTrialEligibility(data)) {
    const promos = (data?.eligible_promos ?? []).map(describeEligibilityPromo);
    const first = promos[0] ?? { plan: "试用资格", benefit: "可试用", rawLabel: "可试用" };
    const extraCount = Math.max(0, promos.length - 1);
    return {
      primary: first.plan,
      secondary: `${first.benefit}${extraCount ? ` +${extraCount}` : ""}`,
      title: promos.length > 0
        ? promos.map(promo => `${promo.plan}：${promo.benefit}（${promo.rawLabel}）`).join("；")
        : "上游明确返回可试用标记",
      state: "trial",
    };
  }

  if (data?.is_eligible_for_yearly_plus_subscription === true) {
    return { primary: "Plus", secondary: "可年付", title: "Plus 年付资格可用", state: "available" };
  }

  const plans = purchasablePlans(data);
  if (plans.length > 0) {
    return {
      primary: "无试用",
      secondary: `可购买${plans.length <= 2 ? ` ${plans.join("/")}` : ""}`,
      title: `未返回试用活动；可购买套餐：${plans.join("、")}`,
      state: "purchase",
    };
  }

  if (data?.has_previously_paid_subscription === true) {
    return { primary: "无试用", secondary: "曾付费", title: "账号存在历史付费记录", state: "used" };
  }

  return { primary: "未返回", secondary: "—", title: "上游未返回可解释的资格信息", state: "unknown" };
}
