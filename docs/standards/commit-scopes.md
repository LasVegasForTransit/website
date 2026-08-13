# Commit scopes

Commit scopes are shared across active Las Vegans for Better Transit
repositories. They are optional labels for durable repository boundaries, not
for the feature, file, or task that happened to change.

| Scope     | Boundary                                        |
| --------- | ----------------------------------------------- |
| `web`     | Browser application behavior                    |
| `worker`  | Server or edge-worker behavior                  |
| `core`    | Shared domain logic                             |
| `pwa`     | Installable/offline application behavior        |
| `dx`      | Local developer workflow                        |
| `tooling` | Reusable developer tooling                      |
| `ci`      | Continuous-integration and deployment workflows |

Omit the scope for cross-boundary work. The shared validator is authoritative;
this page explains the rule but does not define a website-only exception.

See [Commit messages](./commit-messages.md) for the complete title policy.
