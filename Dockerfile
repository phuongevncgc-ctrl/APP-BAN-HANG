# Bước 1: dựng giao diện
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY web ./web
RUN npm run build

# Bước 2: bản chạy gọn nhẹ (Debian slim đã có sẵn dữ liệu múi giờ)
FROM node:22-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8099 \
    TZ=Asia/Ho_Chi_Minh
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
VOLUME /data
EXPOSE 8099
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
