# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS node-runtime
FROM python:3.12-slim-bookworm
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/* \
    && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --no-audit --no-fund
COPY requirements-providers.txt ./
COPY sources/sports-odds-api-python ./sources/sports-odds-api-python
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; \
    python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements-providers.txt
ENV PATH="/opt/venv/bin:${PATH}"
COPY . .
RUN npm run build
ENV HOST=0.0.0.0 PORT=3000 EDGEBOARD_DB=/var/data/edgeboard.sqlite3 EDGEFUSION_DB=/var/data/edgefusion.sqlite3
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
