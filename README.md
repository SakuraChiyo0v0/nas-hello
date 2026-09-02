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
