# syntax=docker/dockerfile:1.7

# Our Haven backend — Cloud Run image. US-region only (ADR-0004 §5, ADR-0009).

FROM node:20.11.1-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/openapi-types/package.json packages/openapi-types/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev --workspace=@our-haven/backend --workspace=@our-haven/openapi-types --workspace=@our-haven/domain --workspace=@our-haven/shared

FROM node:20.11.1-alpine AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/apps/backend/node_modules ./apps/backend/node_modules
COPY tsconfig.base.json package.json package-lock.json* ./
COPY apps/backend apps/backend
COPY packages/openapi-types packages/openapi-types
COPY packages/domain packages/domain
COPY packages/shared packages/shared
RUN npm run build --workspace=@our-haven/backend

FROM node:20.11.1-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /workspace/node_modules ./node_modules
COPY --from=build --chown=app:app /workspace/apps/backend/dist ./dist
COPY --from=build --chown=app:app /workspace/apps/backend/package.json ./package.json
COPY --from=build --chown=app:app /workspace/apps/backend/openapi ./openapi
USER app
EXPOSE 8080
CMD ["node", "dist/server.js"]
