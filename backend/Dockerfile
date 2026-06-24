FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y git build-essential python3

# Fix deps que vienen como github:user/repo y se resuelven como git+ssh.
# Forzar HTTPS evita el "Host key verification failed" al instalar (el repo
# upstream del fork node-forge — remicolin/forge — es público vía HTTPS).
# IMPORTANTE: usar `--add` para que los 3 valores se acumulen en lugar de
# overrideearse mutuamente (multiple insteadOf en la misma key requiere --add).
RUN git config --global --add url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global --add url."https://github.com/".insteadOf "git+ssh://git@github.com/" \
 && git config --global --add url."https://github.com/".insteadOf "git@github.com:" \
 && git config --global --get-all url."https://github.com/".insteadOf

WORKDIR /app

# Copy shared types first
COPY shared/ ./shared/

# Copy backend
COPY backend/package.json backend/yarn.lock ./backend/
WORKDIR /app/backend
RUN yarn install

COPY backend/ .
# Recreate symlink (COPY resolves symlinks, so we need to re-link)
RUN rm -rf shared && ln -s ../shared shared
RUN yarn build

# Runtime stage
FROM node:22-slim AS runner

WORKDIR /app

COPY --from=builder /app/backend/package.json /app/backend/yarn.lock ./
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
# Spec 021 §Phase 3: operational CLI scripts (audit-sync/, ops/) ship
# with the image so operators don't need to `docker cp` each time.
# Pure `.js` / `.sh` — does not affect the Nest runtime.
COPY --from=builder /app/backend/scripts ./scripts

LABEL com.centurylinklabs.watchtower.enable="true"

EXPOSE 5000
CMD ["node", "dist/src/main.js"]
