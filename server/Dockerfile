# 后端 Dockerfile
FROM node:18-alpine

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN apk add --no-cache openssl libc6-compat
RUN npm ci

# 复制 Prisma schema
COPY prisma ./prisma/

# 生成 Prisma Client
RUN npx prisma generate

# 复制源代码
COPY . .

# 创建数据目录
RUN mkdir -p /app/prisma

EXPOSE 3000

# 启动时运行数据库迁移并启动服务
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node index.js"]
