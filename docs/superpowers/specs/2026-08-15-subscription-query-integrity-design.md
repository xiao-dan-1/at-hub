# Subscription Query Integrity Design

## Goal

Ensure `/subscription` produces an explicit, traceable outcome for every recognized AT and never reports a partial stream as complete.

## Confirmed failure modes

1. The JWT scanner uses word boundaries, so a valid Base64URL signature ending in `-` can be truncated before it is queried.
2. The browser accepts an SSE EOF without a `done` event or a complete set of result indexes, then labels the batch complete.
3. A successful account lookup with failed subscription details remains `ok: true`, so it is counted as fully successful and excluded from failed-item retries.
4. Input normalization silently removes duplicates and unrecognized lines, obscuring why input-line count differs from query count.
5. A second query can overlap the first and allow stale stream events to overwrite the active result.

## Design

### Exact token extraction and visible input accounting

- Replace the JWT word-boundary matcher with Base64URL-character lookarounds so the complete token, including a trailing `-`, is preserved.
- Extend token extraction metadata with total non-empty input lines, duplicate count, and unrecognized line count.
- Keep the original textarea content unchanged after a query. Display recognized, duplicate, and unrecognized counts beside it.
- Query each unique AT once; duplicates remain visible in the input statistics rather than being silently erased.

### Stream completeness invariant

A batch is complete only when all of the following are true:

- a `done` event was received;
- `done.count` matches the expected token count;
- every index from `1..count` has exactly one result.

If EOF arrives early or indexes are missing, retry only the missing ATs once using a fresh stream. If the retry is still incomplete, insert explicit failure rows for those indexes. The UI must never hide missing indexes or label the batch fully complete.

### Partial subscription detail handling

Treat `subscription_detail_status === "failed"` or `offers_status === "unknown"` as an incomplete result. It remains an account-level success, but it:

- is counted as pending/partial rather than fully successful;
- is included in “retry incomplete items”;
- retains the successful account identity and diagnostics.

### Query isolation

Assign each run a monotonically increasing request ID and an `AbortController`. Starting a new query or clearing the page aborts the previous stream. Rendering functions ignore events whose request ID is no longer active.

## Error handling

- Premature EOF: retry missing indexes once, then show an explicit `stream-incomplete` row.
- Duplicate index: replace the existing row for that index, but record completeness from the unique index set.
- `done.count` mismatch: use the original expected token count and treat absent indexes as missing.
- Partial subscription details: keep the row and identity, mark it retryable.

## Verification

- Unit tests for JWTs ending in `-`, input statistics, and duplicate handling.
- Stream tests for early EOF, count mismatch, and missing indexes.
- Controller tests for partial-result retry selection and stale-query isolation.
- Existing 197-test suite remains green.

