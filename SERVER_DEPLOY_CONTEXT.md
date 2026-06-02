# 服务器部署上下文（给下一个项目的 AI 用）

目的：确保下一个项目在同一台服务器上部署时**不与现有项目冲突**。  
服务器：`43.143.38.222`（仅 IP 访问，无域名）  
登录：`ssh ubuntu@43.143.38.222`

---

## 1. 现有项目（已占用配置）

**项目名**：JSZZBST  
**访问路径前缀**：`/zhuanben`  
**前端静态目录**：`/srv/JSZZBST/docker/www/zhuanben`  
**后端容器服务名**：`jszzbst-api`  
**数据库**：`jszzbst`  
**数据库用户**：`jszzbst`  
**数据库卷**：`jszzbst_mysql_data`  
**对外端口**：只开放 `80`（Nginx 统一对外）  
**部署目录**：`/srv/JSZZBST`

**项目名**：Timu（题目收集）  
**访问路径前缀**：`/timu`  
**后端容器服务名**：`timu-api`  
**应用代码目录**：`/srv/JSZZBST/timu`  
**数据（SQLite）目录**：`/srv/JSZZBST/docker/timu/instance`（数据库文件：`data.db`）  
**上传文件目录**：`/srv/JSZZBST/docker/timu/uploads`  
**对外端口**：只开放 `80`（Nginx 统一对外）  

**项目名**：Fenshu（分数线登记）  
**访问路径前缀**：`/fenshu`  
**前端容器服务名**：`fenshu-frontend`  
**后端容器服务名**：`fenshu-backend`  
**后端端口**：`3000`（仅容器内）  
**数据库**：SQLite（容器内：`/app/data/prod.db`）  
**数据库卷**：`fenshu-data`  
**API 路径**：前端请求 `/fenshu/api/*`，后端实际 `/api/*`（Nginx 需去掉 `/fenshu` 前缀）  
**Socket 路径**：`/fenshu/socket.io`（后端已配置该 path）  
**Docker 网络**：`projects_app-network`（external，共享给反向代理）  
**对外端口**：只开放 `80`（Nginx 统一对外）  

---

## 2. 当前服务器运行方式

- 统一用 Docker 部署（已有 JSZZBST 的 Nginx + MySQL + 后端；另有 Fenshu 的独立前后端容器）。
- Nginx 负责路径前缀路由（`/zhuanben`、`/timu`、`/fenshu`）。
- 前端有两种形态：静态文件挂到主 Nginx，或独立 Nginx 前端容器（如 `fenshu-frontend`）。
- 后端容器只在 Docker 内网暴露端口（不对外映射）。
- MySQL 也只在 Docker 内网，**不暴露到公网**。
- Fenshu 使用 SQLite，数据持久化在 Docker 卷 `fenshu-data`。
- Fenshu 的容器挂在 external 网络 `projects_app-network`，便于统一反向代理。

**关键文件位置：**
- `docker-compose.yml`：`/srv/JSZZBST/docker-compose.yml`
- Nginx 配置：`/srv/JSZZBST/docker/nginx/default.conf`
- 静态目录根：`/srv/JSZZBST/docker/www/`
- 环境变量：`/srv/JSZZBST/.env`（不要覆盖）
- Fenshu Compose：fenshu 项目目录内的 `docker-compose.yml`（以实际目录为准）

**Compose 命令：**
该服务器使用 `docker-compose`（独立版本），不是 `docker compose` 插件。

---

## 3. 多项目不冲突的规则（必须遵守）

1. **路径前缀唯一**  
   每个项目必须使用不同前缀，例如：`/zhuanben`、`/abc`、`/def`

2. **后端服务名唯一**  
   Docker 服务名不能重复，例如：`abc-api`、`def-api`

3. **数据库独立**  
   每个项目一个库 + 一个用户，例如：`abc` 库 + `abc` 用户

4. **SQLite/卷名独立**  
   使用 SQLite 的项目必须有独立 Docker 卷，例如：`fenshu-data`

5. **静态目录独立**  
   每个项目一个目录：`/srv/JSZZBST/docker/www/abc`

6. **对外只开放 80/443**  
   不给新项目暴露新端口，统一走 Nginx 路径前缀

7. **前端 base 必须同步**  
   Vite `base` 必须等于路径前缀，例如：`/abc/`

8. **Flask 项目注意路径前缀**  
   Flask 路由必须包含路径前缀（如 `/timu/...`），并确保 Session Cookie Path 与前缀一致，避免多项目冲突。

---

## 4. 给下一个项目的“登记模板”

```
项目名：abc
访问路径前缀：/abc
前端目录：/srv/JSZZBST/docker/www/abc
后端服务名：abc-api
数据库：abc
数据库用户：abc
```

**示例（已部署项目）**
```
项目名：timu
访问路径前缀：/timu
后端服务名：timu-api
应用代码目录：/srv/JSZZBST/timu
数据库：SQLite（/srv/JSZZBST/docker/timu/instance/data.db）
上传目录：/srv/JSZZBST/docker/timu/uploads
```

```
项目名：fenshu
访问路径前缀：/fenshu
前端服务名：fenshu-frontend
后端服务名：fenshu-backend
数据库：SQLite（/app/data/prod.db）
数据库卷：fenshu-data
```

---

## 5. 如何添加新项目（概要）

1. **前端构建**
   - `base` 设置为新路径（如 `/abc/`）
   - 构建产物放到 `/srv/JSZZBST/docker/www/abc`

2. **Nginx 加路由**
   - 在 `/srv/JSZZBST/docker/nginx/default.conf` 加一个 `location /abc/`  
   - 加 `location /abc/api/` 反代到新后端容器

3. **后端容器**
   - docker-compose 增加 `abc-api` 服务
   - 内部端口仍用 `5000`

4. **数据库**
   - 在当前 MySQL 容器里新建库和用户  
   - 不要影响 `jszzbst` 数据库

5. **Flask 项目（如 Timu）**
   - 直接反代 `location /timu/` 到 `http://timu-api:5000`
   - 若需要健康检查，单独加 `location /timu/health`
   - SQLite 数据目录与上传目录做 bind mount 持久化

6. **Node + SQLite 项目（如 Fenshu）**
   - `docker-compose` 建 `xxx-frontend` + `xxx-backend` 两个服务
   - 使用 external 网络 `projects_app-network` 让反向代理可访问
   - 后端端口例如 `3000`（仅容器内）
   - SQLite 数据使用独立 Docker 卷（如 `fenshu-data`）
   - Nginx 路由需覆盖 `/xxx/`、`/xxx/api/`、`/xxx/socket.io`，`/xxx/api/` 需映射到后端的 `/api/`

---

## 6. 现有数据注意事项

**不要删除以下内容：**
- `/srv/JSZZBST/.env`
- `/srv/JSZZBST/docker/www/zhuanben`
- Docker 卷：`jszzbst_mysql_data`
- `/srv/JSZZBST/timu`
- `/srv/JSZZBST/docker/timu/instance`
- `/srv/JSZZBST/docker/timu/uploads`
- Docker 卷：`fenshu-data`

否则会导致现有项目数据丢失。
