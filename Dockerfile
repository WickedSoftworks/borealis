# syntax=docker/dockerfile:1

###############################################################################
# deps — install with the build toolchain present.
#
# better-sqlite3 is a native addon; without python3/make/g++ its install falls
# back to a prebuild that may not match this platform, and the container dies at
# first query rather than at build time.
###############################################################################
# Named so Dependabot tracks it like the other base images.
FROM oven/bun:1.4.2-alpine AS bun

FROM node:25-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat python3 make g++

# Installed from bun.lock, exactly. `npm install` ignores that lockfile and
# resolves every range afresh, so the image silently got whatever was newest on
# the day it was built — which broke the build outright when better-auth 1.7
# moved an export the code imports. Only bun's binary is borrowed: Node stays
# the runtime, and install scripts (better-sqlite3's native build) run under
# this image's Node, so the addon matches the runner.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

###############################################################################
# builder — generate the Prisma client, then build Next.
###############################################################################
FROM node:25-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The datasource block and the client are provider-specific and are baked in at
# build time, so the image is built for one database. Rebuild with
# --build-arg DATABASE_PROVIDER=postgresql to target Postgres.
ARG DATABASE_PROVIDER=sqlite
ENV DATABASE_PROVIDER=${DATABASE_PROVIDER}

# prisma.config.ts resolves env("DATABASE_URL") when the CLI loads it, so this
# has to be set before `prisma generate` runs, not just before the Next build.
# The value is a placeholder — nothing connects at build time, and the real URL
# arrives from the environment at runtime.
ENV DATABASE_URL="file:/app/data/borealis.db"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx tsx scripts/set-db-provider.mts
RUN npx prisma generate
RUN npm run build

# Compile the admin console to one self-contained ESM file.
#
# Shipping the .mts and a TypeScript runtime instead means hand-picking tsx's
# transitive dependency tree into the runner, which breaks the moment the
# package manager hoists differently. Only genuinely native modules stay
# external; they are already present via the standalone trace.
#
# The banner gives the bundle a `require`: Prisma's runtime is CommonJS and
# calls require("node:path") at load, which an ESM bundle otherwise has no way
# to answer ("Dynamic require of … is not supported").
RUN npx esbuild scripts/root.mts \
      --bundle --platform=node --format=esm --target=node22 \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
      --external:better-sqlite3 --external:pg --external:nodemailer \
      --outfile=/app/dist/root.mjs

###############################################################################
# runner — the shipped image.
###############################################################################
FROM node:25-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat tini su-exec

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Defaults that make the container work with no configuration at all.
ENV DATABASE_PROVIDER=sqlite
ENV DATABASE_URL="file:/app/data/borealis.db"
ENV STORAGE_DRIVER=local
ENV STORAGE_PATH=/app/uploads
# On the data volume, so `borealis-root backup` with no argument survives the
# container. Copy it off the box as well; a backup beside the original is not
# much of one.
ENV BACKUP_DIR=/app/data/backups

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Migrations and the compiled admin console. The entrypoint applies migrations
# and seeds root; the operator manages accounts with `borealis-root`.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/dist/root.mjs ./dist/root.mjs

# The Prisma CLI gets its own complete install under /opt rather than having
# selected subtrees copied out of the builder. Copying `prisma` and `@prisma`
# alone leaves its transitive dependencies (`effect`, among others) missing,
# and the exact set shifts between releases. Installing it properly, isolated
# from the app's own node_modules so neither can shadow the other, is the only
# version of this that stays fixed.
RUN npm install --no-audit --no-fund --prefix /opt/prisma prisma@7.9.1

# prisma.config.ts imports `prisma/config`, which the CLI's config loader
# resolves from the config file's own directory — /app, whose node_modules is
# the standalone trace and has no `prisma` in it. Without this every start
# fails at "Cannot find module 'prisma/config'" before migrating. One name,
# pointing at the isolated install, so nothing of the app's is shadowed.
RUN ln -s /opt/prisma/node_modules/prisma /app/node_modules/prisma

# `borealis-root invite --admin` rather than a path nobody can remember.
RUN printf '#!/bin/sh\nexec node /app/dist/root.mjs "$@"\n' > /usr/local/bin/borealis-root \
    && chmod +x /usr/local/bin/borealis-root

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# CRs stripped: a Windows checkout made before .gitattributes pinned LF has a
# `#!/bin/sh\r` shebang, and the container dies with "No such file or
# directory" pointing at a file that plainly exists.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh

# Data and uploads are the two things that must outlive the container.
RUN mkdir -p /app/data /app/uploads

VOLUME ["/app/data", "/app/uploads"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards signals so the container stops promptly.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
