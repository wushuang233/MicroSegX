# 普通 Kubernetes 集群最简交付文档

> 如果目标环境走 `ctr/containerd` 离线导入，请优先使用 `/home/wushuang/MicroSegX/docs/K8S-CONTAINERD-DELIVERY-MANUAL.md`。

这份文档只保留四件事：

- 哪两个 `tar.gz` 要发到新服务器
- 新服务器上怎么解压
- `microsegx` 在普通 `k8s` 上要运行哪两个脚本
- `port-audit` 在普通 `k8s` 上要运行哪一个脚本

适用场景：

- 普通 Kubernetes 集群
- 集群节点从镜像仓库拉镜像
- 不走 `k3s ctr images import`
- 本文档覆盖 `microsegx + port-audit`

不适用：

- 单机 `k3s` 本地导入镜像
- `OpenZiti + port-audit` 本地离线 bundle

## 1. 要发送到新服务器的两个压缩包

### 1.1 MicroSegX release 包

先在打包机准备 `full-release.env`：

```bash
cp /home/wushuang/MicroSegX/ops/full-release/full-release.env.example /home/wushuang/MicroSegX/ops/full-release/full-release.env
```

至少改这几个值：

```text
DEPLOY_MODE=registry
REGISTRY=harbor.example.com
IMAGE_NAMESPACE=microsegx
CORE_TAG=2026.04.08-r1
SCANNER_TAG=2026.04.08-scanner-r1
BOOTSTRAP_PASSWORD=<首次登录密码>
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
CONTROLLER_PVC_ENABLED=true
CONTROLLER_REPLICAS=1
CONTROLLER_PVC_ACCESS_MODE=ReadWriteOnce
CONTROLLER_PVC_STORAGE_CLASS=<你的 StorageClass>
CONTROLLER_STRATEGY_TYPE=Recreate
```

然后生成 release 目录：

```bash
bash /home/wushuang/MicroSegX/ops/full-release/build-and-package.sh /home/wushuang/MicroSegX/ops/full-release/full-release.env
```

再把整个 release 目录打成一个包：

```bash
CORE_TAG=2026.04.08-r1
tar -C /home/wushuang/MicroSegX/artifacts/full-release -czf microsegx-release-${CORE_TAG}.tar.gz ${CORE_TAG}
```

这个包里已经包含：

- `images-${CORE_TAG}.tar.gz`
- `bundle/load-and-push.sh`
- `bundle/deploy-core.sh`
- `bundle/reset-microsegx.sh`
- `bundle/full-release.env`

### 1.2 Port-Audit 普通 k8s 包

在打包机生成普通 `k8s` 交付包：

```bash
bash /home/wushuang/MicroSegX/k8s-node-surface/scripts/build-registry-bundle.sh
```

然后把生成目录打成一个包：

```bash
PORT_AUDIT_VERSION=$(head -n 1 /home/wushuang/MicroSegX/k8s-node-surface/VERSION | tr -d '[:space:]')
tar -C /home/wushuang/MicroSegX/k8s-node-surface/dist -czf k8s-port-audit-registry-${PORT_AUDIT_VERSION}.tar.gz k8s-port-audit-registry-${PORT_AUDIT_VERSION}
```

这个包里已经包含：

- `k8s-port-audit-${PORT_AUDIT_VERSION}.tar.gz`
- `k8s-port-audit.yaml`
- `push-and-apply.sh`
- `VERSION`

## 2. 发到新服务器后解压

```bash
mkdir -p /opt/microsegx-delivery
cd /opt/microsegx-delivery

tar -xzf microsegx-release-${CORE_TAG}.tar.gz
tar -xzf k8s-port-audit-registry-${PORT_AUDIT_VERSION}.tar.gz
```

## 3. 安装 MicroSegX

先检查 release 里的环境文件，尤其是下面这些值：

```text
DEPLOY_MODE=registry
REGISTRY=harbor.example.com
IMAGE_NAMESPACE=microsegx
BOOTSTRAP_PASSWORD=<首次登录密码>
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
CONTROLLER_PVC_ENABLED=true
CONTROLLER_REPLICAS=1
CONTROLLER_PVC_ACCESS_MODE=ReadWriteOnce
CONTROLLER_PVC_STORAGE_CLASS=<你的 StorageClass>
CONTROLLER_STRATEGY_TYPE=Recreate
IMAGE_PULL_SECRET=regcred
REGISTRY_USERNAME=<如需登录镜像仓库就填写>
REGISTRY_PASSWORD=<如需登录镜像仓库就填写>
```

如果目标服务器使用的私有仓库地址和打包机不一致，先改 `bundle/full-release.env` 里的 `REGISTRY`、`IMAGE_NAMESPACE`、`IMAGE_PULL_SECRET`、`REGISTRY_USERNAME`、`REGISTRY_PASSWORD`，再继续。

如果新服务器上装过旧版 `microsegx`，先清理：

```bash
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/reset-microsegx.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

然后加载镜像到 Docker 并推送到私有仓库：

```bash
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/load-and-push.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

再执行部署：

```bash
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/deploy-core.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

## 4. 安装 Port-Audit

先进入交付包目录：

```bash
cd /opt/microsegx-delivery/k8s-port-audit-registry-${PORT_AUDIT_VERSION}
```

如果 `port-audit` 也要推到同一个私有仓库，直接执行：

```bash
export PORT_AUDIT_IMAGE=harbor.example.com/security/k8s-port-audit:${PORT_AUDIT_VERSION}
./push-and-apply.sh
```

如果镜像仓库需要认证，再补这几个变量：

```bash
export REGISTRY_USERNAME='<username>'
export REGISTRY_PASSWORD='<password>'
export IMAGE_PULL_SECRET=regcred
./push-and-apply.sh
```

这条脚本会自动完成：

- 把 bundle 里的镜像 tar.gz 加载到 Docker
- 打 tag 成目标仓库镜像
- 推送到目标仓库
- 用目标镜像渲染 `k8s-port-audit.yaml`
- `kubectl apply`
- 等待 deployment 就绪

## 5. 最小验证

```bash
kubectl get pods -n microsegx
kubectl get pvc -n microsegx
kubectl get pods -n port-audit
```

`microsegx` 侧至少要看到：

- `microsegx-controller-pod`
- `microsegx-manager-pod`
- `microsegx-scanner-pod`
- `microsegx-enforcer-pod`
- `microsegx-data` 为 `Bound`

`port-audit` 侧至少要看到：

- `k8s-port-audit` 为 `Running`

访问 `port-audit`：

```bash
kubectl -n port-audit port-forward svc/k8s-port-audit 8080:8080
```

打开：

```text
http://127.0.0.1:8080
```

## 6. 这份文档里最重要的三条

- 普通 `k8s` 不要再用 `load-local-images.sh`，要用 `load-and-push.sh`
- 普通 `k8s` 不要再用 `ctr images import`，节点要从仓库拉镜像
- `controller` 持久化必须开，不然重启后会回到重新初始化密码和配置的坑里
- 默认安全配置要保持 `CONTROLLER_HOST_NETWORK=false`、`ENFORCER_HOST_NETWORK=false`、`CONTROLLER_API_SERVICE_TYPE=ClusterIP`
