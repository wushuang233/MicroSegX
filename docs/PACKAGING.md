# MicroSegX 打包文档

这份文档只管一件事：从当前源码树产出可交付的镜像包和 bundle。

## 1. 推荐路径

推荐直接使用：

```bash
bash ops/full-release/build-and-package.sh ops/full-release/full-release.env
```

这条链现在默认是：

- 先从源码构建 `controller / enforcer / manager / scanner`
- 再使用仓库里的 `docker-images/Dockerfile.*` 打镜像
- 最后导出 `images-*.tar.gz` 和完整部署 bundle

不再推荐优先走 `microsegx/package/Dockerfile.*` 那条 SUSE 基础镜像链。那条链对外部仓库依赖更重，之前已经实测遇到过超时。

## 2. 打包机前置条件

打包机至少需要这些工具：

- `docker`
- `git`
- `go`
- `make`
- `curl`
- `tar`
- `gzip`
- `node` 和 `npm`
- `sbt`
- `java 17`
- `google-chrome`

说明：

- `manager/package/build_manager.sh` 会执行 `npm install`、`npm run build` 和 `sbt admin/assembly`
- `scanner` 现在由脚本自动用 `GOFLAGS=-mod=mod` 构建，不要手工再跑旧的 `make -C scanner build`
- 打包机需要联网访问基础镜像、`apt`、`npm` 和 `Consul` 下载地址
- 目标集群可以离线，但打包机最好是联网的

## 3. 准备环境文件

先复制模板：

```bash
cd /home/wushuang/MicroSegX
cp ops/full-release/full-release.env.example ops/full-release/full-release.env
```

最关键的变量：

- `DEPLOY_MODE`
- `IMAGE_NAMESPACE`
- `LOCAL_IMAGE_REGISTRY`
- `CORE_TAG`
- `SCANNER_TAG`
- `UPDATER_TAG`
- `BOOTSTRAP_PASSWORD`
- `USE_LOCAL_DOCKERFILES`
- `BUILD_FROM_SOURCE`

其中有一个不要留空：

- `BOOTSTRAP_PASSWORD`

原因：

- 首次在 Kubernetes 上安装时，需要它来生成 `microsegx-bootstrap-secret`
- controller 会用这个 secret 给默认 `admin` 用户灌入一次性初始密码
- 现在 `deploy-core.sh` 已经会在 fresh install 且该值为空时直接报错，避免部署到一半才踩坑

默认建议保留：

```bash
USE_LOCAL_DOCKERFILES=true
BUILD_FROM_SOURCE=true
BUILD_UPDATER_FROM_SOURCE=true
```

## 4. 单机 k3s 推荐环境参数

这是当前最稳的一组：

```bash
RELEASE_NAME=microsegx
NAMESPACE=microsegx

DEPLOY_MODE=local
LOCAL_RUNTIME=k3s
LOCAL_IMAGE_REGISTRY=local.microsegx
IMAGE_NAMESPACE=microsegx

CORE_TAG=2026.04.08-r2010
SCANNER_TAG=2026.04.08-scanner-r2010
UPDATER_TAG=2026.04.08-updater-r2010

USE_LOCAL_DOCKERFILES=true
BUILD_FROM_SOURCE=true
BUILD_UPDATER_FROM_SOURCE=true

BOOTSTRAP_PASSWORD='YourStrongPasswordHere'
```

## 5. 执行打包

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-and-package.sh ops/full-release/full-release.env
```

脚本会依次做这些事情：

1. 准备 scanner CVE DB
2. 从源码构建 controller、enforcer、scanner、manager
3. 使用 `docker-images/Dockerfile.controller`
4. 使用 `docker-images/Dockerfile.enforcer`
5. 使用 `docker-images/Dockerfile.manager`
6. 使用 `docker-images/Dockerfile.scanner`
7. 视配置构建或镜像化 `updater`
8. 导出镜像包和部署 bundle

默认产物目录：

```bash
artifacts/full-release/${CORE_TAG}
```

关键产物：

- `images-${CORE_TAG}.tar.gz`
- `images-${CORE_TAG}.tar.gz.sha256`
- `bundle/charts/`
- `bundle/deploy-core.sh`
- `bundle/load-local-images.sh`
- `bundle/load-and-push.sh`
- `bundle/reset-microsegx.sh`
- `bundle/full-release.env`
- `bundle/full-release.env.example`

## 6. scanner DB 说明

`scanner/data/cvedb` 在仓库里是 Git LFS 指针，不是真实漏洞库。

现在的打包链会先执行：

```bash
bash ops/full-release/prepare-scanner-db.sh
```

它会自动下载并校验真实的 `scanner/data/cvedb.regular`。

如果你看到类似下面的报错，说明你把 LFS 指针文件打进镜像了：

- `version header too big`
- `scanner/data/cvedb is only a Git LFS pointer`

处理方式只有一个：先跑 `prepare-scanner-db.sh`，再继续打包。

## 7. 什么时候不要走这条脚本

只有一种情况不建议直接用默认打包脚本：

- 你明确要复用原始 `package/Dockerfile.*` 的 SUSE 构建链

这时才把下面两个变量改掉：

```bash
USE_LOCAL_DOCKERFILES=false
BUILD_FROM_SOURCE=false
```

但这条路不作为当前推荐路径。

## 8. 打包完成后的下一步

如果目标是本地导入：

```bash
bash artifacts/full-release/${CORE_TAG}/bundle/load-local-images.sh artifacts/full-release/${CORE_TAG}/bundle/full-release.env
```

如果目标是私有仓库：

```bash
bash artifacts/full-release/${CORE_TAG}/bundle/load-and-push.sh artifacts/full-release/${CORE_TAG}/bundle/full-release.env
```

部署步骤见 [导入与部署文档](./IMPORT-DEPLOYMENT.md)。
