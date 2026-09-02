# nas-hello

零依赖 Node HTTP 小程序。它本身没什么功能，存在的意义是**验证并沉淀一条可复刻的镜像自动发布链路**：

```
push 到 GitHub main
  -> GitHub Actions 构建 Docker 镜像
  -> 推送 ghcr.io（GitHub 容器仓库）
  -> NAS 上 Watchtower 轮询发现新镜像
  -> 自动 pull + 重建容器（无需登录 NAS 手动操作）
```

访问 `http://<nas>:8899/` 返回 JSON：`{ app, version, commit, host, time }`。
改 `package.json` 的 `version` 再 push，约 1 分钟内再访问就能看到版本变了 = 全链路通了。

> 已实测跑通（2026-09-02）：push 0.2.0 -> 自动构建 -> Watchtower 自动重建 -> 访问返回 `{"version": "0.2.0", "commit": "4833f7d"}`。

---

## 一、整条链路是怎么做到的（架构拆解）

```
【你的电脑 / CI】                          【GitHub】                          【NAS（绿联 UGOS）】
本地 git push ────────────► main 分支触发
                              │
                              ▼
                     .github/workflows/docker-image.yml
                     (1) checkout 代码
                     (2) 读 package.json 拿 version
                     (3) docker buildx 构建镜像
                     (4) 推 ghcr.io/<owner>/<repo>:{latest, version, sha}
                              │
                              ▼  Watchtower 每 30s 轮询 registry
                     containrrr/watchtower 容器（NAS 上常驻）
                              │  发现 latest 的 digest 变了
                              ▼
                     自动 docker pull + 重建 nas-hello 容器
                              │
                              ▼
                     新版本生效（容器带 label: watchtower.enable=true）
```

四个角色，缺一不可：

| 角色 | 载体 | 职责 |
|---|---|---|
| 触发器 | `.github/workflows/docker-image.yml` | push 到 main 后自动构建镜像 |
| 镜像仓库 | GHCR（ghcr.io） | 存镜像，public 仓库让 NAS 免 token 拉取 |
| 监听器 | watchtower 容器 | 轮询仓库，发现新版本就重建容器 |
| 目标 | NAS 上部署的 compose 项目 | 容器带 watchtower label 才会被更新 |

---

## 二、快速复刻：给一个新项目套上这套链路（约 10 分钟）

假设新项目叫 `my-app`、GitHub 账号 `YOUR_NAME`。

### 第 1 步：项目里放一个 Dockerfile

能构建出镜像即可（任何语言）。建议支持注入版本信息：

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./

ARG APP_VERSION=dev        # 构建时传入
ARG APP_COMMIT=local
ENV APP_VERSION=${APP_VERSION}
ENV APP_COMMIT=${APP_COMMIT}
EXPOSE 3000
CMD ["node", "server.mjs"]
```

### 第 2 步：复制 Actions workflow

把本仓库 `.github/workflows/docker-image.yml` 原样拷过去，**一行都不用改**：
它自动用 `github.repository`（即 `YOUR_NAME/my-app`）拼镜像名，并转成小写。
每次 push 打三个 tag：`latest`（供 watchtower 追）、`<version>`、`<sha7>`（供回滚）。

### 第 3 步：推到 GitHub（仓库 public，或 private + 配 token）

- public 仓库：NAS 匿名就能拉镜像，最简单。
- private 仓库：GHCR 包也 private，需要在 NAS 上配 `docker login`，麻烦，不推荐。

### 第 4 步：NAS 上部署一次 watchtower（全局只做一次）

用 `watchtower.compose.yml`（见下）。**watchtower 是全局的，之后所有项目共用它**。

### 第 5 步：部署你的应用 compose，加一行 label

```yaml
services:
  my-app:
    image: ghcr.io/your_name/my-app:latest   # 改成你的镜像
    container_name: my-app
    restart: unless-stopped
    ports:
      - "8899:3000"                          # 换成你的端口
    labels:
      - com.centurylinklabs.watchtower.enable=true   # 关键：纳入自动更新
```

### 第 6 步：验证

```bash
# 本地访问（或用你的 ugdocker 域名）
curl http://<nas>:8899/
# 返回新版本号即成功
```

之后每次迭代：改代码 -> `git push` -> 等 ~1 分钟 -> NAS 已是最新。**全程不用登录 NAS。**

---

## 三、关键文件逐行解读

### `.github/workflows/docker-image.yml`

| 片段 | 作用 |
|---|---|
| `on: push: branches: [main]` | 只监听 main 分支推送 |
| `paths:` | 只有相关文件变了才构建（避免无谓构建） |
| `permissions: packages: write` | 给 GITHUB_TOKEN 推 GHCR 的权限 |
| `Resolve metadata` 步骤 | 从 package.json 读 version、取 commit 前 7 位、仓库名转小写 |
| `docker/login-action` | 用 `secrets.GITHUB_TOKEN` 登录 ghcr（**不需要自己建 PAT**） |
| `docker/build-push-action` | 构建并推 3 个 tag，`--build-arg` 注入 version/commit |

### `watchtower.compose.yml`（NAS 全局部署一次）

```yaml
services:
  watchtower:
    image: containrrr/watchtower:latest
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock   # watchtower 靠它操控 docker
    environment:
      - DOCKER_API_VERSION=1.43                      # 关键！见「坑」一节
      - WATCHTOWER_POLL_INTERVAL=30                  # 每 30s 查一次仓库
      - WATCHTOWER_CLEANUP=true                      # 更新后清理旧镜像
      - WATCHTOWER_LABEL_ENABLE=true                 # 只更新带 label 的容器
      - TZ=Asia/Hong_Kong
```

### `server.mjs`

纯演示：把 `APP_VERSION` / `APP_COMMIT` 环境变量（构建时注入）原样吐出来，
这样用浏览器/curl 看一眼返回就知道当前跑的是哪个版本，验证链路最直观。

---

## 四、踩过的坑（复刻时直接避开）

### 坑 1：watchtower 在绿联 UGOS 上崩溃重启（必看）

- 现象：容器 exit 1 循环重启，日志：
  `Error response from daemon: client version 1.25 is too old. Minimum supported API version is 1.40`
- 根因：containrrr/watchtower 镜像**内置 `DOCKER_API_VERSION=1.25`**（为了兼容老 Docker），
  而 UGOS 的 dockerd 最低要求 API 1.40。
- 解决：compose 环境变量覆盖 `DOCKER_API_VERSION=1.43`。没有这一步 watchtower 在 UGOS 上根本跑不起来。

### 坑 2：UGOS Docker UI 里改 Compose 的 Monaco 编辑器

- 用自动化的 `fill` 或逐字 `type` 会把内容搞乱（报 `Map keys must be unique`）。
- 正确姿势：内容复制进剪贴板，编辑器内 `Ctrl+A` 全选后 `Ctrl+V` 粘贴覆盖。
- 或绕开 UI：直接用 WebDAV 改 `/volume1/docker/<项目>/docker-compose.yaml`，再到 UI 里点「重新部署」。

### 坑 3：创建项目后容器没自动跑

UGOS 的「创建完成后立即运行」勾选经常不生效。创建完去**项目列表点「启动」**即可。

### 坑 4：GHCR 镜像名必须全小写

GitHub 用户名如 `SakuraChiyo0v0` 含大写，GHCR 要求 repository 全小写。
workflow 里已用 `tr 'A-Z' 'a-z'` 转小写，不要手写带大写的镜像名。

### 坑 5：UGOS 登录 API 有频率限制

脚本高频调用 `ugreen/v1/verify/login` 会触发 IP 级限流（接口返回空）。
**浏览器操作不受影响**；脚本要控制频率，别在循环里疯狂登录。

---

## 五、为什么选 GHCR 而不是 Docker Hub / 阿里云

| | GHCR（推荐） | Docker Hub | 阿里云 ACR |
|---|---|---|---|
| 账号 | 复用 GitHub，零新增 | 需注册 | 需注册 |
| NAS 匿名拉取 | public 仓库可匿名 | 匿名有限流（6h/100 次），watchtower 轮询会撞 | 私有需登录 |
| 国内速度 | 一般（可配加速） | 一般 | 快 |

watchtower 每 30s 轮询一次，Docker Hub 的匿名限流会让它频繁失败，所以 GHCR 最合适。
国内拉 ghcr.io 慢的话，给 NAS docker 配 ghcr 的镜像加速（如 `docker.m.daocloud.io/ghcr.io/...`），仓库不用换。

---

## 六、文件清单

| 文件 | 作用 |
|---|---|
| `server.mjs` | HTTP 服务，返回版本号（验证用） |
| `package.json` | 版本来源（workflow 读它打 tag） |
| `Dockerfile` | 构建镜像，build-arg 注入 version/commit |
| `.github/workflows/docker-image.yml` | push 后自动构建推 GHCR（**复刻时原样拷贝**） |
| `docker-compose.nas.yml` | nas-hello 在 NAS 上的部署 compose（含 watchtower label） |
| `watchtower.compose.yml` | watchtower 自动更新器（NAS 全局部署一次） |

## 七、本地跑

```bash
node server.mjs        # http://localhost:3000
```
