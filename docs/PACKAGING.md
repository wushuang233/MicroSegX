# MicroSegX 打包文档

这份文档只负责一件事：从当前源码树产出可交付的离线包或部署 bundle。

## 1. 先选你要的产物

### 1.1 普通 Kubernetes 集群离线交付总包

这是当前最推荐的产物，覆盖：

- `MicroSegX`
- `OpenZiti`
- `Port-Audit`
- 不使用私有仓库
- 在目标集群节点上用 `ctr/containerd` 导入镜像

脚本：

```bash
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

产物：

```text
artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
```

### 1.2 只打 `MicroSegX core` release

适用场景：

- 只交付 `manager/controller/enforcer/scanner/updater`
- 或者你想先单独验证 core bundle

脚本：

```bash
bash ops/full-release/build-and-package.sh ops/full-release/full-release.env
```

产物目录：

```text
artifacts/full-release/${CORE_TAG}
```

### 1.3 本机 `k3s` 一体化本地离线交付包

适用场景：

- 单机 `k3s`
- 用本地镜像导入
- 一次性把 `MicroSegX + OpenZiti + Port-Audit` 打成可拷贝目录

脚本：

```bash
bash ops/microsegx-local/build-and-package.sh ops/full-release/full-release.env
```

产物目录：

```text
artifacts/microsegx-local/${CORE_TAG}
```

## 2. 打包机前置条件

至少准备：

- `docker`
- `git`
- `go`
- `make`
- `curl`
- `tar`
- `gzip`
- `node`
- `npm`
- `sbt`
- `java 17`

说明：

- `manager/make_jar.sh` 会跑 `npm install`、`npm run build` 和 `sbt admin/assembly`
- `scanner` 构建会自动准备 CVE DB
- 打包机最好联网，目标集群可以离线

## 3. 先准备环境文件

### 3.1 通用 core 环境文件

复制模板：

```bash
cp ops/full-release/full-release.env.example ops/full-release/full-release.env
```

最关键的变量：

- `DEPLOY_MODE`
- `REGISTRY`
- `IMAGE_NAMESPACE`
- `LOCAL_IMAGE_REGISTRY`
- `LOCAL_RUNTIME`
- `CORE_TAG`
- `SCANNER_TAG`
- `UPDATER_TAG`
- `BOOTSTRAP_PASSWORD`
- `CONTROLLER_PVC_STORAGE_CLASS`

必须注意：

- `BOOTSTRAP_PASSWORD` 不能留空
- 如果目标是 Kubernetes 集群，`controller` 持久化相关参数必须明确

### 3.2 普通 Kubernetes 集群离线总包环境文件

默认文件：

```bash
ops/full-release/full-release.k8s-delivery.env
```

这份文件的目标就是：

- `DEPLOY_MODE=local`
- `LOCAL_RUNTIME=containerd`
- `LOCAL_IMAGE_REGISTRY=local.microsegx`

它是“普通 Kubernetes 集群 + `ctr` 离线导入”主线的默认入口。

### 3.3 推荐的核心参数基线

无论最终是 `k3s` 还是普通 Kubernetes，下面这组安全基线都建议保留：

```text
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
CONTROLLER_PVC_ENABLED=true
CONTROLLER_PVC_ACCESS_MODE=ReadWriteOnce
CONTROLLER_STRATEGY_TYPE=Recreate
```

## 4. 实际打包命令

### 4.1 构建 `MicroSegX core`

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-and-package.sh ops/full-release/full-release.env
```

### 4.2 构建普通 Kubernetes 集群离线总包

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

### 4.3 构建本机 `k3s` 一体化交付目录

```bash
cd /home/wushuang/MicroSegX
bash ops/microsegx-local/build-and-package.sh ops/full-release/full-release.env
```

## 5. 产物清单

### 5.1 `MicroSegX core`

关键文件：

- `images-${CORE_TAG}.tar.gz`
- `bundle/deploy-core.sh`
- `bundle/load-local-images.sh`
- `bundle/load-and-push.sh`
- `bundle/import-core-images-containerd.sh`
- `bundle/apply-core-containerd.sh`
- `bundle/reset-microsegx.sh`
- `bundle/full-release.env`
- `bundle/full-release.containerd.env.example`

### 5.2 普通 Kubernetes 集群离线总包

关键文件：

- `microsegx-release-${CORE_TAG}.tar.gz`
- `k8s-port-audit-containerd-${PORT_AUDIT_VERSION}.tar.gz`
- `openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}.tar.gz`
- `DEPLOY.md`
- `CHECKSUMS.sha256`

### 5.3 本机 `k3s` 一体化交付目录

关键文件：

- `core/`
- `port-audit-stack/`
- `deploy-local.sh`
- `setup-k3s-offline-auto-import.sh`
- `microsegx-local.env.example`

## 6. 打包完成后的验证

建议至少检查：

```bash
find artifacts/full-release/${CORE_TAG}/bundle -maxdepth 1 -type f | sort
```

```bash
ls -lh artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
```

```bash
sha256sum artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
```

## 7. 打包阶段最容易踩的坑

- `BOOTSTRAP_PASSWORD` 为空
  Fresh install 时会直接把安装链卡住。

- `scanner/data/cvedb` 只是 Git LFS 指针
  现在脚本会自动准备真实 DB，但如果你跳过默认脚本，仍然会踩这个坑。

- 本地联调后又单独重打了 `manager/controller/enforcer`
  这类“当前 live tag”不会自动进入旧交付包，后续迁移前要重新打包，或者重新导出这些精确 tag。

- 复用过期 tag
  最后容易出现“源码改了、镜像也打了、但线上实际跑的不是这次内容”。

下一步：

- 普通 Kubernetes 集群离线交付：看 [K8S-CONTAINERD-DELIVERY-MANUAL.md](./K8S-CONTAINERD-DELIVERY-MANUAL.md)
- 本机 `k3s` 参考：看 [IMPORT-DEPLOYMENT.md](./IMPORT-DEPLOYMENT.md)
