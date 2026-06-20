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

EXPOSE 3000

CMD ["node", "server.js"]
