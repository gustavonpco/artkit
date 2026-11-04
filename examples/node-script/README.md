# Node script example

Creates one artifact of each kind with the inputs models know best (Markdown, CSV, Mermaid and semantic slide layouts), edits them with small operations, exports every format available in Node and prints the outline a model would read.

```bash
pnpm install && pnpm build
node examples/node-script/generate.mjs ./artkit-output
```

Artifacts are stored with the filesystem store in `./artkit-output/.store`; exported files land in `./artkit-output`.
