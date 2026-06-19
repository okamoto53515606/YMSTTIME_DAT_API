# syntax=docker/dockerfile:1
# ============================================================
# Stage 1: Lambda Web Adapter バイナリを取得
# ============================================================
FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 AS lambda-adapter

# ============================================================
# Stage 2: TypeScript ビルド
# ============================================================
FROM node:20-alpine AS builder
WORKDIR /build

# 依存関係のインストール（キャッシュ最適化）
COPY app/package*.json ./
RUN npm ci --omit=dev && \
    npm install --save-dev typescript@5 @types/node@20

COPY app/tsconfig.json ./
COPY app/src ./src
RUN npx tsc --project tsconfig.json

# ============================================================
# Stage 3: 実行イメージ
# ============================================================
FROM node:20-alpine AS runner
WORKDIR /app

# Lambda Web Adapter を Extension として配置
COPY --from=lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter

# ビルド済みアプリをコピー
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules

# ヤマトマスタファイルをイメージに焼き付け
COPY YTCMST ./YTCMST

# Lambda Web Adapter の設定
ENV PORT=8080
ENV AWS_LWA_READINESS_CHECK_PATH=/health
ENV AWS_LWA_READINESS_CHECK_PROTOCOL=http

# サーバ起動コマンド
CMD ["node", "dist/index.js"]
