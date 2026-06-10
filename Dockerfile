FROM node:20-alpine

WORKDIR /app

# Install dependencies first so this layer is cached unless the manifests change.
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application source.
COPY . .

CMD ["node", "feed.js"]

