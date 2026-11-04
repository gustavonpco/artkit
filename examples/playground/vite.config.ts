import { defaultClientConditions, defineConfig } from 'vite';

// Resolve workspace packages to their TypeScript sources, so the playground needs no build step.
export default defineConfig({
  resolve: { conditions: ['@artkit/source', ...defaultClientConditions] },
  server: { port: 5287, strictPort: true },
});
