# ==============================================================================
# Production Dockerfile for FlashBite Multi-Tenant Backend
# Multi-stage build optimized with node:18-alpine for minimal footprint & security
# ==============================================================================

# Stage 1: Dependencies & Build
FROM node:18-alpine AS dependencies
WORKDIR /app

# Install native compilation dependencies for bcrypt / crypto packages if needed
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Final Production Runner
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy dependencies from previous stage
COPY --from=dependencies --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup package.json ./
COPY --chown=appuser:appgroup src ./src
COPY --chown=appuser:appgroup public ./public
COPY --chown=appuser:appgroup certs ./certs

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

CMD ["npm", "start"]
