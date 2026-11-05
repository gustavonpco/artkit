---
name: artkit-integracao
description: Integrate artkit in an application: registry, store, authorization, toolkit and panel.
metadata:
  artkit: "0.3.0"
---
# Integração

1. Install the packages of the formats you use with the package manager already in the project.
2. Register the adapters, theme, store and authorization in one registry and service.
3. Plug the toolkit into the agent (ToolLoopAgent or another harness) and the panel with useArtifacts.
4. Never accept workspace or user ids from the model; take them from the execution context.
5. Keep content changes inside the operation pipeline; do not write artifacts directly to the store.
