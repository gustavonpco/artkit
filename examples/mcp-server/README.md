# artkit MCP server (stdio)

Exposes the artkit tools (`artifact_create`, `artifact_read`, `artifact_apply`, `artifact_export`, `artifact_list`, `artifact_submit`, `artifact_guide`), the `artifact://{id}` resources and the guide prompts to any MCP client, with artifacts stored on disk.

```bash
pnpm install && pnpm build
node examples/mcp-server/server.mjs --dir ~/.artkit --workspace personal --locale pt-BR
```

| Flag          | Default     | Meaning                                               |
| ------------- | ----------- | ----------------------------------------------------- |
| `--dir`       | `~/.artkit` | Store and asset folder                                |
| `--workspace` | `personal`  | Workspace every call acts in                          |
| `--locale`    | `en`        | Language of tool messages and default artifact locale |
| `--profile`   | `default`   | JSON Schema profile: `default`, `strict` or `compact` |

Client configuration (Claude Desktop, Claude Code and similar):

```json
{
  "mcpServers": {
    "artkit": {
      "command": "node",
      "args": [
        "/path/to/artkit/examples/mcp-server/server.mjs",
        "--dir",
        "/Users/me/.artkit",
        "--locale",
        "pt-BR"
      ]
    }
  }
}
```

Exports are saved in the asset folder and returned as `asset://` references.
