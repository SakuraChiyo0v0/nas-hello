# nas-hello

零依赖 Node HTTP 小程序，用来验证一条 CI/CD 链路：

```
push 到 GitHub main
  -> GitHub Actions 构建 Docker 镜像并推到 GHCR
  -> NAS 上 Watchtower 发现新镜像 -> 自动 pull + 重建容器
```

访问 http://<nas>:8899/ 返回 { app, version, commit, host, time }，改 package.json 的 version 再 push，等一会儿再访问就能看到版本变了 = 全链路通了。

## 本地跑

node server.mjs    # http://localhost:3000

## 文件说明

| 文件 | 作用 |
|---|---|
| server.mjs | HTTP 服务（零依赖，APP_VERSION/APP_COMMIT 由镜像注入） |
| Dockerfile | 构建镜像，--build-arg 注入版本与 commit |
| .github/workflows/docker-image.yml | main push 后构建并推送 ghcr.io/sakurachiyo0v0/nas-hello:{latest,version,sha} |
| docker-compose.nas.yml | NAS 端部署（拷到 /volume1/docker/nas-hello/） |
| watchtower.compose.yml | Watchtower 自动更新器（NAS 上单独项目部署） |

## 部署到 NAS

1. 把 docker-compose.nas.yml 放到 NAS /volume1/docker/nas-hello/，在 UGOS Docker 创建项目 nas-hello（端口 8899）
2. 部署 watchtower.compose.yml（挂 /var/run/docker.sock，轮询 30s）
3. push 代码，等 Actions 完成，30~60s 内 NAS 自动更新

> Watchtower 只重建带 com.centurylinklabs.watchtower.enable=true 标签的容器，不影响其它容器。

## 已跑通（2026-09-02）

验证结果：bump version -> push -> Actions 构建推 GHCR -> Watchtower 30s 内自动重建 -> 访问返回新版本。

```json
{ "app": "nas-hello", "version": "0.2.0", "commit": "4833f7d" }
```

### 踩坑：watchtower 在绿联 UGOS 上崩溃

现象：容器 exit 1 循环重启、日志只有 `Error response from daemon: client version 1.25 is too old. Minimum supported API version is 1.40`。

原因：containrrr/watchtower 镜像内置 `DOCKER_API_VERSION=1.25`，UGOS 的 dockerd 最低要求 1.40。

解决：compose 里覆盖环境变量 `DOCKER_API_VERSION=1.43`（见 watchtower.compose.yml）。
