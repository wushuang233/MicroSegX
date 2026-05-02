# MicroSegX 打包主手册

这份文档只做一件事：

**把当前源码树正确地打成可交付产物。**

覆盖三块内容：

- `MicroSegX core`
- `OpenZiti`
- `Port-Audit`

如果你是未来要继续写代码、改代码、重新出包的本地 agent，请同时看：

- [PACKAGING-AGENT-EXECUTION.zh-CN.md](./PACKAGING-AGENT-EXECUTION.zh-CN.md)

## 1. 先说结论

当前仓库最推荐、也最适合你后续 `1 master + 2 worker` 普通 Kubernetes 集群交付的路径只有一条：

```bash
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

这条链会自动串起来：

1. 构建 `MicroSegX core` release
2. 构建 `Port-Audit` containerd bundle
3. 构建 `OpenZiti` offline bundle
4. 把三者收成一个总交付包

最终产物：

```text
artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
```

如果你的最终目标是三节点 Kubernetes 集群，**默认就走这条主线，不要优先走本地 k3s 一体化路径。**

## 2. 支持的打包产物矩阵

| 产物 | 推荐脚本 | 适用场景 | 主要产物 |
|------|----------|----------|----------|
| `MicroSegX core` | `ops/full-release/build-and-package.sh` | 只验证 `manager/controller/enforcer/scanner/updater` | `artifacts/full-release/${CORE_TAG}` |
| `Port-Audit` containerd bundle | `k8s-node-surface/scripts/build-containerd-bundle.sh` | 只验证端口审计组件 | `k8s-node-surface/dist/k8s-port-audit-containerd-${VERSION}.tar.gz` |
| `OpenZiti` offline bundle | `openziti/build-openziti-offline-bundle.sh` | 只验证 OpenZiti 离线交付 | `openziti/dist/openziti-k8s-offline-${TAG}.tar.gz` |
| 普通 Kubernetes 集群总包 | `ops/full-release/build-k8s-containerd-suite.sh` | 最终对外交付主线 | `artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz` |
| 本机 `k3s` 一体化目录 | `ops/microsegx-local/build-and-package.sh` | 单机联调、演示、排障 | `artifacts/microsegx-local/${CORE_TAG}` |

## 3. 当前已经核过的真实情况

我这次不是只读文档，也核了脚本和实际环境。当前结论是：

- 当前机器具备打包前置命令：`docker`、`helm`、`go`、`make`、`node`、`npm`、`java`、`sbt`、`kubectl`、`ctr`
- `docker info` 可用
- `k8s-node-surface/scripts/verify-project.sh` 通过
- 关键打包脚本都通过了 `bash -n`
- `Port-Audit` containerd bundle 已实际构建成功
- `OpenZiti` offline bundle 已实际构建成功
- `MicroSegX core` 完整重打链已实际启动并连续走过 `controller → enforcer → manager` 镜像构建阶段；这条链构建时间明显更长，属于重任务

另外还发现并修正了两个真实阻塞点：

- `openziti/install-openziti-k8s.sh` 原本只是 `source env`，但没有导出变量，执行 `deploy-openziti-k8s.sh` 时可能带不进去；现在已修正
- `ops/microsegx-local/build-and-package.sh` 原本引用了一个仓库里不存在的说明文件；现在已修正为复制现有部署文档

## 4. 打包机前置条件

至少准备：

- `docker`
- `git`
- `go`
- `make`
- `curl`
- `tar`
- `gzip`
- `sha256sum`
- `node`
- `npm`
- `sbt`
- `java 17`
- `helm`
- `kubectl`

建议先跑一轮预检：

```bash
for c in docker helm go make node npm java sbt python3 tar gzip sha256sum ctr kubectl; do
  printf '%-10s' "$c"
  command -v "$c" || true
done
```

```bash
docker info >/dev/null
```

```bash
./k8s-node-surface/scripts/verify-project.sh
```

## 5. 最终推荐主线：普通 Kubernetes 集群总交付包

### 5.1 先确认环境文件

默认主线环境文件：

```text
ops/full-release/full-release.k8s-delivery.env
```

至少确认这些值：

- `DEPLOY_MODE=local`
- `LOCAL_RUNTIME=containerd`
- `LOCAL_IMAGE_REGISTRY=local.microsegx`
- `CORE_TAG`
- `SCANNER_TAG`
- `UPDATER_TAG`
- `BOOTSTRAP_PASSWORD`
- `CONTROLLER_PVC_STORAGE_CLASS`
- `OPENZITI_BUNDLE_TAG`

### 5.2 执行主线打包

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

### 5.3 产物

```text
artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz.sha256
```

总包内至少应包含：

- `microsegx-release-${CORE_TAG}.tar.gz`
- `k8s-port-audit-containerd-${PORT_AUDIT_VERSION}.tar.gz`
- `openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}.tar.gz`
- `DEPLOY.md`
- `CHECKSUMS.sha256`

## 6. 组件单独打包命令

### 6.1 只打 `MicroSegX core`

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-and-package.sh ops/full-release/full-release.k8s-delivery.env
```

产物目录：

```text
artifacts/full-release/${CORE_TAG}
```

### 6.2 只打 `Port-Audit`

```bash
cd /home/wushuang/MicroSegX
bash k8s-node-surface/scripts/build-containerd-bundle.sh
```

产物：

```text
k8s-node-surface/dist/k8s-port-audit-containerd-${VERSION}.tar.gz
```

### 6.3 只打 `OpenZiti`

```bash
cd /home/wushuang/MicroSegX
OPENZITI_BUNDLE_TAG=${CORE_TAG} bash openziti/build-openziti-offline-bundle.sh
```

产物：

```text
openziti/dist/openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}.tar.gz
```

## 7. 本地 `k3s` 一体化路径

这条路径只适合：

- 单机联调
- 本地演示
- 快速排障

不作为你后续三节点 Kubernetes 集群的默认交付路径。

命令：

```bash
cd /home/wushuang/MicroSegX
bash ops/microsegx-local/build-and-package.sh ops/full-release/full-release.env
```

产物：

```text
artifacts/microsegx-local/${CORE_TAG}
```

## 8. 打包后最小校验

### 8.1 总包是否存在

```bash
ls -lh artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
```

### 8.2 校验和

```bash
sha256sum artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
cat artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz.sha256
```

### 8.3 解包结构检查

```bash
tmp_dir="$(mktemp -d)"
tar -xzf artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz -C "$tmp_dir"
find "$tmp_dir" -maxdepth 2 -type f | sort | sed -n '1,120p'
```

### 8.4 Core bundle 结构检查

```bash
find artifacts/full-release/${CORE_TAG}/bundle -maxdepth 1 -type f | sort
```

至少应该看到：

- `deploy-core.sh`
- `load-local-images.sh`
- `import-core-images-containerd.sh`
- `apply-core-containerd.sh`
- `full-release.env`
- `full-release.containerd.env.example`

## 9. 真正容易踩的坑

### 9.1 `build-and-package.sh` 需要真实 env 文件路径

不要用这种方式：

```bash
bash ops/full-release/build-and-package.sh <(sed '...')
```

因为脚本会先做 `-f` 检查，进程替换路径不稳定。

正确做法是先复制一份临时 env 文件，再传真实路径。

### 9.2 最终三节点集群一定是“每个可能调度的节点都要先导入镜像”

这对三块组件都成立：

- `MicroSegX`
- `OpenZiti`
- `Port-Audit`

否则最典型报错就是：

```text
ErrImageNeverPull
```

### 9.3 `MicroSegX controller` 的持久化不能省

至少要明确：

- `CONTROLLER_PVC_ENABLED=true`
- `CONTROLLER_PVC_STORAGE_CLASS=<你的 StorageClass>`
- `BOOTSTRAP_PASSWORD=<首次登录密码>`

### 9.4 `OpenZiti` 必须明确外部地址和存储类

至少要设置：

- `ZITI_PUBLIC_HOST`
- `ZITI_STORAGE_CLASS_NAME`

### 9.5 如果改了代码但只复用旧镜像，产物就不是真正最新

尤其是下面几种情况：

- 改了 `manager`
- 改了 `controller`
- 改了 `enforcer`
- 改了 `scanner`
- 改了 `k8s-node-surface`
- 改了 `openziti` 清单或脚本

这时应该重新打包对应组件，最终交付时最好重出总包。

## 10. 推荐阅读顺序

如果你要最终交付到普通 Kubernetes 集群：

1. 先读这份文档
2. 再读 [K8S-CONTAINERD-DELIVERY-MANUAL.md](./K8S-CONTAINERD-DELIVERY-MANUAL.md)
3. 如果你是负责持续改代码和出包的 agent，再读 [PACKAGING-AGENT-EXECUTION.zh-CN.md](./PACKAGING-AGENT-EXECUTION.zh-CN.md)
