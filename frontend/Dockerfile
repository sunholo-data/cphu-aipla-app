# Build stage
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

ARG SKIP_QUALITY_CHECKS=false

# Firebase config (injected from Secret Manager via get-firebase-config.sh)
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_ADMIN_EMAIL
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_MCP_SANDBOX_URL
# AIPLA v0.1 — controls which auth UI to render at build time. Possible
# values: "anonymous_group_id" (AIPLA default; hides Google Sign-In),
# unset (template default; shows Google Sign-In via Firebase Auth).
# Sourced from FIREBASE_ENV Secret Manager entry via get-firebase-config.sh.
ARG NEXT_PUBLIC_AUTH_MODE
# 1.G-Ph2 — opt-in mockup bypass for the /teacher/* surface (set to '1'
# on the dev trigger only). Empty on test/prod so the layout renders
# the "sign-in required" placeholder instead of the seeded fixtures.
ARG NEXT_PUBLIC_TEACHER_MOCK
# COPILOT-1/2 — show the activity-authoring co-pilot panel in the teacher
# builder. '1' on the dev trigger ("for dev we always want to see what we
# built"); empty on test/prod until AR/JB's teaching framework lands.
ARG NEXT_PUBLIC_AUTHORING_COPILOT
# CONCEPT-1 — show the living-concept-map editor in the teacher builder.
# '1' on the dev trigger; empty on test/prod until the demo iteration settles.
ARG NEXT_PUBLIC_CONCEPT_MAP
# AIPLA help co-pilot — floating "AIPLA Hjælp" assistant. '1' on the dev trigger.
ARG NEXT_PUBLIC_AIPLA_HELP
ARG MAILGUN_WEBHOOK_SECRET

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_ADMIN_EMAIL=$NEXT_PUBLIC_ADMIN_EMAIL
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_MCP_SANDBOX_URL=$NEXT_PUBLIC_MCP_SANDBOX_URL
ENV NEXT_PUBLIC_AUTH_MODE=$NEXT_PUBLIC_AUTH_MODE
ENV NEXT_PUBLIC_TEACHER_MOCK=$NEXT_PUBLIC_TEACHER_MOCK
ENV NEXT_PUBLIC_AUTHORING_COPILOT=$NEXT_PUBLIC_AUTHORING_COPILOT
ENV NEXT_PUBLIC_CONCEPT_MAP=$NEXT_PUBLIC_CONCEPT_MAP
ENV NEXT_PUBLIC_AIPLA_HELP=$NEXT_PUBLIC_AIPLA_HELP
ENV MAILGUN_WEBHOOK_SECRET=$MAILGUN_WEBHOOK_SECRET

COPY package*.json ./
RUN npm cache clean --force && npm ci --no-audit --no-fund

COPY . .

# Quality checks (lint + typecheck + tests)
RUN if [ "$SKIP_QUALITY_CHECKS" != "true" ]; then \
      echo "Running quality checks..." && \
      npm run lint && \
      npx tsc --noEmit && \
      echo "Quality checks passed!"; \
    else \
      echo "Skipping quality checks"; \
    fi

# Build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
