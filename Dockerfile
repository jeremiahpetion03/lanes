# --- build stage: install everything and bundle the React app ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime stage: only what's needed to run the server ---
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/lanes.db
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
# The SQLite database lives on a volume so data survives container restarts.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
# Don't run as root.
USER node
EXPOSE 3000
CMD ["npm", "start"]
