ARG BASE_CONTAINER=node:22-slim

FROM $BASE_CONTAINER AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN chown node:node /src
USER node
COPY --chown=node:node . .
RUN npm ci
RUN npm run build
# Refs before the startup-migration fix import dotenv from migrations although it is a
# devDependency there, so carry it across the prune when the ref still ships it.
RUN if [ -d node_modules/dotenv ]; then cp -r node_modules/dotenv /tmp/dotenv; fi \
  && npm prune --omit=dev \
  && if [ -d /tmp/dotenv ]; then cp -r /tmp/dotenv node_modules/dotenv; fi \
  && npm cache clean --force && rm -rf .git /tmp/dotenv

FROM $BASE_CONTAINER
WORKDIR /src
COPY --from=build --chown=node:node /src /src
RUN mkdir -p tmp && chown node:node tmp
USER node
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
