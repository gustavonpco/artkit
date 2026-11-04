# @artkit-ai/skills

Agent Skills that teach agents to use artkit (spec §14.7), generated from the kind registry:

- **`artkit-artefatos`**: for agents that create, read and edit artifacts through the artkit tools. `SKILL.md` (kind choice, standard flow, rules, error recovery) plus `references/<kind>.md`, `references/themes.md`, `references/errors.md` and complete `examples/`.
- **`artkit-integracao`**: for coding agents (Claude Code, Cursor…) integrating the library into an application.

The technical parts (fields, operations, limits, examples) are generated from each kind's schemas and instructions, never written by hand, so the skills always match the installed version. CI fails when the shipped folder is out of date or an example stops validating.

```bash
npm install @artkit-ai/skills
```

## Use the shipped folder

Harnesses with native skills support (Claude Code, `HarnessAgent`…) load the folder directly:

```bash
cp -r node_modules/@artkit-ai/skills/skills/artkit-artefatos .claude/skills/
```

## Generate with your own kinds or rules

```ts
import { artkitSkillFiles, createSkillsRegistry } from '@artkit-ai/skills';

const files = artkitSkillFiles({
  registry: createSkillsRegistry([myCustomKind]),
  extensions: {
    'artkit-artefatos/references/document.md':
      '## House rules\n\n- Proposals always end with a risks callout.',
  },
});
// files: { path, content }[] — write them where your harness expects skills.
```

Agents without native skills support get the same content on demand through the `artifact_guide` tool of `@artkit-ai/agent` (progressive disclosure), and MCP clients through `@artkit-ai/mcp` prompts and `artkit://guide/{topic}` resources.

## Maintainers

```bash
pnpm build && pnpm skills:generate   # rewrite packages/skills/skills
pnpm skills:check                    # fail when the folder is out of date
```

License: Apache-2.0.
