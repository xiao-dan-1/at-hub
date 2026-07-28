# AT Parser Minimal Overview Design

## Product Intent

The result screen should help a user quickly answer four questions after parsing one ChatGPT access token:

1. Which account is this token for?
2. What plan does the JWT claim?
3. How long does it remain within the declared time window?
4. Does it contain any permission that deserves immediate attention?

The product should feel like a focused local inspector, not a full audit report on the first screen. Complete data remains available in the advanced inspector and redacted JSON, but the default overview should only show information that supports the immediate decision.

## Recommended Approach

Use a minimal overview as the default result view:

- Show account email, masked by default with the existing ten-second reveal control.
- Show `chatgpt_plan_type` as "JWT 声明的套餐".
- Show validity as one compact line combining status, expiry, and remaining time.
- Show a key permission summary rather than the full `scp` list.
- Show only critical or interruptive warnings in the overview.
- Keep all other decoded claims in "高级检查器" and "脱敏 JSON".

This keeps the fast path calm while preserving power-user access.

## Information Architecture

### Primary Overview

The overview should render four compact blocks:

- 账号: email, masked by default. If no email claim exists, show "未提供".
- 套餐: `chatgpt_plan_type`, with copy that makes staleness explicit.
- 有效期: status, absolute expiry time, and remaining time in one readable sentence.
- 关键权限: a summarized set of meaningful flags, such as "模型调用", "离线访问", and "组织写入 1 个高风险".

The signature notice should become quiet helper copy, not a large warning row, unless an actual high-priority condition exists.

### Secondary Details

The following fields should not appear in the primary overview by default:

- `iss`
- `aud`
- `alg`
- `kid`
- `client_id`
- `session_id`
- `jti`
- `pwd_auth_time`
- `chatgpt_compute_residency`
- `verified_org_ids`
- `verified_ws_ids`

They remain searchable in the advanced inspector and present in redacted JSON.

### Warning Behavior

Normal facts should stay quiet:

- `aud` matching OpenAI API should not consume overview space.
- common algorithms such as `RS256` should not be visually prominent.
- the "not signature verified" limitation should be visible but not alarming.

Abnormal facts should interrupt:

- expired token
- not-yet-valid token
- missing or invalid time claims
- `alg=none`
- high-risk permission such as `organization.write`
- unexpected audience, if future logic adds that check

## Components

Reuse the existing result shell, tabs, reveal registry, permission interpreter, and advanced inspector. The main UI change is a narrower overview renderer that replaces the current status strip plus three definition sections with a concise decision panel.

The permission page can stay available for deeper reading, but the default overview should summarize rather than list.

## Data Flow

The parser continues to produce the full analysis object:

- `decoded`
- `status`
- `warnings`
- `account`
- `permissions`
- `entries`
- `redacted`

The overview consumes a smaller presentation model derived from that analysis. No field should be discarded from the analysis object. Redaction behavior remains unchanged: sensitive values are masked in UI by default and copied JSON uses `analysis.redacted`.

## Error Handling

Invalid input behavior stays the same:

- parsing failure returns the user to the input screen
- the original invalid input remains in the textarea for correction
- the error box explains the JWT structure or decoding issue

Missing non-critical claims should display "未提供" rather than produce warnings.

## Testing

Tests should prove:

- the overview includes email, plan, validity, and key permission summary
- the overview does not render low-priority technical fields by default
- sensitive email remains masked until revealed
- high-risk permissions still create an interruptive warning
- all fields remain available in the advanced inspector and redacted JSON
- existing local-only, no-network, no-persistence, and redaction tests continue to pass

## Scope Boundaries

This design does not add a backend, storage, live token validation, official permission verification, multi-token comparison, or account history. It only changes how a single decoded AT is presented after local parsing.

## Self Review

No incomplete markers remain. The primary and secondary fields are explicitly separated. The design preserves the existing local-only security contract and is narrow enough for one implementation plan.
