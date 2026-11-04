# Errors

Every tool returns errors as data instead of failing:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_OPERATION",
    "message": "Operation 2 is invalid.",
    "issues": [
      {
        "path": "operations[2].text",
        "message": "Expected string.",
        "hint": "Provide a value of type string."
      }
    ]
  }
}
```

Errors come back as `{ ok: false, error: { code, message, issues[{ path, message, hint }] } }`. Fix the call using the paths and hints. After 2 failed attempts on the same step, stop and ask the user for help.

| Code | What to do |
|---|---|
| `UNKNOWN_KIND` | Pick one of the kinds listed in the hint; do not invent kinds. |
| `DUPLICATE_KIND` | Configuration problem in the application; tell the user, do not retry. |
| `NOT_FOUND` | Check the id with `artifact_list` or read the artifact again; never guess ids. |
| `INVALID_ENVELOPE` | Stored data is corrupt; tell the user, do not retry. |
| `UNSUPPORTED_VERSION` | The artifact was written by a newer version of the application; tell the user. |
| `MIGRATION_FAILED` | The artifact cannot be upgraded automatically; tell the user. |
| `INVALID_CONTENT` | Fix the fields at the reported `path` following each `hint`, then call again with the whole corrected input. |
| `INVALID_OPERATION` | Fix the operation at `operations[i]` following the hint (wrong `op`, missing or extra fields); resend the whole batch. |
| `OPERATION_FAILED` | The operation is valid but does not fit the current state (missing id, bad anchor). Read the outline, use existing ids and resend. |
| `VERSION_CONFLICT` | Someone else changed the same items. Read the artifact again and redo the operations from the current `version`. |
| `LOCKED` | Another author holds the lock. Wait or ask the user; do not loop retrying. |
| `LIMIT_EXCEEDED` | Reduce the batch (max operations per call) or the content; split large content into several artifacts or batches. |
| `PERMISSION_DENIED` | You are not allowed to do this. Tell the user; do not retry with other ids. |
| `APPROVAL_REQUIRED` | The action needs human approval. Use `artifact_submit` and wait for the user. |
| `ASSET_REJECTED` | The file type, size or origin is not allowed; use another asset or ask the user. |
| `EXPORT_FAILED` | Try another format once; if it fails again, tell the user. |
| `INTERNAL_ERROR` | Unexpected failure. Retry once; if it repeats, tell the user. |

Lint warnings are not errors: the change was saved. Fix the ones that matter and continue.
