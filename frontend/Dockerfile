# Etapa 1: Build
FROM node:22-slim AS builder
LABEL com.centurylinklabs.watchtower.enable="true"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates git python3 make g++ \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare yarn@3.2.3 --activate

# Copy shared types first
COPY shared/ ./shared/

# Copy frontend
COPY frontend/package.json frontend/yarn.lock ./frontend/
WORKDIR /app/frontend
RUN yarn install --frozen-lockfile

COPY frontend/ .
# Recreate symlink (COPY resolves symlinks, so we need to re-link)
RUN rm -rf shared && ln -s ../shared shared

ARG VITE_APP_BASE_URL=https://lendoor.xyz
ARG VITE_PUBLIC_BACKEND_URL=https://api.lendoor.xyz
ARG VITE_GRAPH_API_KEY

ENV VITE_NODE_ENV="production"
ENV VITE_APP_BASE_URL=${VITE_APP_BASE_URL}
ENV VITE_PUBLIC_BACKEND_URL=${VITE_PUBLIC_BACKEND_URL}
ENV VITE_CLARITY_ID="ue1k5wrs9c"

ENV VITE_EVAULT="0x31BF6609DC9AefcaFB5D6e5FA4773E0b1bF61a01"
ENV VITE_EVAULT_CONTROLLER="0x96041e7aad5462D7AF74d784AF0438e0505266d8"
ENV VITE_LOAN_MANAGER_ADDRESS="0x3E1536CC066C626Ee96D79bb00d1c9dC7d4D86b6"
ENV VITE_USDC="0xcebA9300f2b948710d2653dD7B07f33A8B32118C"
ENV VITE_RPC_URL="https://celo-mainnet.g.alchemy.com/v2/AMFpK_PeWovdvGwgZl_2S"
ENV VITE_EXPECTED_CHAIN_ID="42220"
ENV VITE_GRAPH_API_KEY=${VITE_GRAPH_API_KEY}

ENV VITE_SELF_SCOPE="self-playground"
ENV VITE_SELF_VERIFY_PATH="/self/verify"

# Spec 012 / 017 — founder admin dashboard allowlist, baked at build time.
# This value is not secret (the backend AdminGuard is the authoritative check);
# the frontend list only controls whether the /admin UI renders or shows
# "Not authorized". Any update requires a frontend rebuild.
ENV VITE_ADMIN_WALLETS="0x4CC122dFB13bA7888363C964dc0e53cb7153e185,0xe1a6db7ff4a99ff36defbc6403200c8af7f291d7,0xe2ad2Dc0F28105113e3fc95EDA2f61a671005185"

RUN yarn build


# Etapa 2: Runtime
FROM node:22-slim AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare yarn@3.2.3 --activate

COPY --from=builder /app/frontend/package.json ./
COPY --from=builder /app/frontend/yarn.lock ./
COPY --from=builder /app/frontend/node_modules ./node_modules
COPY --from=builder /app/frontend/dist ./dist
COPY --from=builder /app/frontend/vite.config.ts ./

EXPOSE 3000
CMD ["yarn", "preview", "--host", "0.0.0.0", "--port", "3000"]
