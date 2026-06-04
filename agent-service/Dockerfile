FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=9100
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY project ./project
COPY models.json ./models.json
EXPOSE 9100
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:9100/v1/health || exit 1
CMD ["node", "dist/server.js"]
