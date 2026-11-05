# Erros

| Código | Ação |
| --- | --- |
| `UNKNOWN_FORMAT` | Pick one of the formats listed in the hint; do not invent formats. |
| `DUPLICATE_FORMAT` | Configuration problem in the application; tell the user, do not retry. |
| `NOT_FOUND` | Check the id with `artifact_list` or read the artifact again; never guess ids. |
| `INVALID_ENVELOPE` | Stored data is corrupt; tell the user, do not retry. |
| `UNSUPPORTED_FORMAT_VERSION` | The artifact was written with a format version this application cannot read; tell the user. |
| `MIGRATION_FAILED` | The artifact cannot be upgraded automatically; tell the user. |
| `INVALID_CONTENT` | Fix the fields at the reported `path` following each `hint`, then call again with the whole corrected content. |
| `INVALID_OPERATION` | Fix the operation at `operations[i]` following the hint (wrong `op`, missing or extra fields); resend the whole batch. |
| `OPERATION_FAILED` | The operation is valid but does not fit the current state (missing anchor, id or sheet). Read the outline, use existing references and resend. |
| `VERSION_CONFLICT` | Someone else changed the same parts. Read the artifact again and redo the operations from the current `version`. |
| `LOCKED` | Another author holds the lock. Wait or ask the user; do not loop retrying. |
| `LIMIT_EXCEEDED` | Reduce the batch or the content; split large content into several artifacts or batches. |
| `PERMISSION_DENIED` | You are not allowed to do this. Tell the user; do not retry with other ids. |
| `ASSET_REJECTED` | The file type, size or origin is not allowed; use another asset or ask the user. |
| `EXPORT_FAILED` | Try another target once; if it fails again, tell the user. |
| `ENGINE_UNAVAILABLE` | The calculation engine is busy or unavailable; retry once after a short pause, then tell the user. |
| `INTERNAL_ERROR` | Unexpected failure. Retry once; if it repeats, tell the user. |
