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
COPY trail-geometry-seed ./trail-geometry-seed

# Bake build metadata into the image as runtime ENV vars (server.js stamps HTML at startup)
ARG BUILD_DATE=
ARG BUILD_SHA=
ENV BUILD_DATE=${BUILD_DATE}
ENV BUILD_SHA=${BUILD_SHA}

EXPOSE 3000

CMD ["node", "server.js"]
