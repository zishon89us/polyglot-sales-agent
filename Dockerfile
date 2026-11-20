# One image for every process of the product (api, worker, ops, the
# database tool) and for the development stand-in for WhatsApp. Which one
# runs is the command given to the container; `docker-compose.yml` shows
# each. Node runs the TypeScript sources as they are (ADR 0002): there is
# no build step.
#
# The base image is named by tag, not pinned to a digest (#279).
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# pnpm at the version `package.json` names.
RUN corepack enable
COPY . .
# From the lockfile, and only what runs: no test or lint tooling.
RUN pnpm install --frozen-lockfile --prod
# Not root.
USER node
CMD ["node", "apps/api/src/main.ts"]
