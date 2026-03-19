# @tyrum/node-sdk

Generic node runtime SDK for managed node lifecycle, device identity, capability registration, and dispatch plumbing.

## What belongs here

- Managed node lifecycle wiring (`createManagedNodeClientLifecycle`)
- Capability provider contracts and generic dispatch registration (`autoExecute`)
- Generic node/device identity helpers used by embedded or standalone nodes
- Node-facing browser and Node.js entrypoints that compose the transport SDK with the node lifecycle surface

## What does not belong here

- Desktop-specific capability providers or backends
- Mobile/browser capability implementations
- Gateway runtime orchestration or operator-facing state

Platform-specific capability packages should depend on `@tyrum/node-sdk` for lifecycle and dispatch wiring, and keep device- or environment-specific execution logic in their own package.
