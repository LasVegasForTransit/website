FROM node:24-bookworm-slim AS dependencies
WORKDIR /build
RUN corepack enable
# Dockerfile.dockerignore admits only workspace manifests, tooling and runtime source.
COPY . .
# Root setup hooks and host credentials are not needed in the deployment dependency closure.
RUN --mount=type=secret,id=npmrc,required=true,target=/root/.npmrc --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN pnpm install --prod --frozen-lockfile --ignore-scripts --filter @lasvegasfortransit/workspace-connector...

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
COPY --from=dependencies --chown=node:node /build/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /build/apps/workspace-connector ./apps/workspace-connector
COPY --from=dependencies --chown=node:node /build/packages/platform-core ./packages/platform-core
COPY --from=dependencies --chown=node:node /build/packages/platform-integrations ./packages/platform-integrations
COPY --from=dependencies --chown=node:node /build/packages/platform-storage ./packages/platform-storage
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "--import", "./apps/workspace-connector/node_modules/tsx/dist/loader.mjs", "apps/workspace-connector/src/server.ts"]
