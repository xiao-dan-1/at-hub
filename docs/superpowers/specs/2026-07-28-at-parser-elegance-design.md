# AT Inspector Elegance Iteration Design

## Goal

Refine the existing V2 result experience so real ChatGPT-shaped JWT data remains orderly after rendering, while preserving the approved local-only inspector architecture and every existing workflow.

## Design Decisions

1. Overview remains an open two-column definition layout. No dashboard card grid is introduced.
2. Sensitive values stay masked in-place and only one value may be revealed at a time across the whole result view. Revealing another value or switching tabs immediately conceals the previous value.
3. Overview arrays are summarized as readable Chinese text. Authentication methods use semantic labels such as `OTP` and `邮箱验证码`; the audience uses a compact service label. Raw arrays remain available in the advanced inspector.
4. Permission items are grouped into `身份与会话`, `模型`, `组织`, and `其他` sections. Each row keeps the original scope and explanation, but the risk label sits near the permission name instead of at the far edge of the viewport.
5. Low-risk language becomes `较低关注` so the local heuristic does not imply an official safety verdict.
6. Monospace typography is limited to raw keys, paths, scopes, and raw values. Semantic account values use the UI typeface.
7. The advanced inspector keeps its three-column desktop structure. Border density, selected-state treatment, and minimum height are reduced so it reads as a focused tool rather than a large form.
8. Remaining time omits zero-value units, for example `约 10 天` instead of `约 10 天 0 小时`.

## Responsive Behavior

- Desktop keeps the current 1180px content boundary and open page structure.
- Sensitive rows reserve a stable action area and wrap the revealed value inside its own value region.
- Permission groups remain full-width bands; mobile rows collapse to one readable column without horizontal overflow.
- The inspector continues to replace category navigation with a select control on mobile.

## Interaction And Safety

- The reveal registry owns one active reveal only.
- Tab changes clear the registry.
- Inspector field/category/search changes continue to clear the registry.
- Copy remains permanently redacted and independent of reveal state.
- `Esc` continues to clear the current result, matching the approved V2 behavior.

## Verification

- Unit tests cover single-active reveal behavior, semantic overview summaries, zero-unit removal, grouped permissions, and revised heuristic labels.
- The complete test suite and single-file publish build must pass.
- Browser verification covers the overview, permissions, and inspector at desktop and mobile widths, including reveal handoff and tab concealment.

