FROM node:20-alpine

LABEL org.opencontainers.image.title="Rail Trail Tracker" \
      org.opencontainers.image.source="https://hub.docker.com/r/marstonstudio/rail-trail-tracker"

WORKDIR /app

# Install dependencies first (cached layer — only re-runs if package.json changes)
COPY package*.json ./
RUN npm install --omit=dev

# Copy app files
COPY server.js ./
COPY public ./public

# Stamp build metadata into the frontend (replaced by CI; falls back to "dev")
ARG BUILD_DATE=dev
ARG BUILD_SHA=local
RUN sed -i "s/__BUILD_DATE__/${BUILD_DATE}/g" public/index.html && \
    sed -i "s/__BUILD_SHA__/${BUILD_SHA}/g"   public/index.html

EXPOSE 3000

CMD ["node", "server.js"]
