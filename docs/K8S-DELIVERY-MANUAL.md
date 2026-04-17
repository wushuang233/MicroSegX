# Kubernetes 仓库拉取交付手册

这份文档只保留给下面这种场景：

- 目标集群可以访问私有镜像仓库
- 你明确要走 `registry` 模式
- 不打算在节点上用 `ctr/containerd` 手工导入镜像

如果目标环境是离线集群或半离线集群，请不要再用这份手册。
当前主线是：

- [K8S-CONTAINERD-DELIVERY-MANUAL.md](./K8S-CONTAINERD-DELIVERY-MANUAL.md)

## 1. 什么时候用它

适用：

- 企业内部已有 Harbor 或其他私有仓库
- 集群节点能从私有仓库稳定拉镜像
- 你愿意在打包机上先 `docker load/tag/push`

不适用：

- 目标集群完全离线
- 你不想维护镜像仓库账号和网络连通性

## 2. `MicroSegX core` 打包与推送

### 2.1 准备环境文件

```bash
cp /home/wushuang/MicroSegX/ops/full-release/full-release.env.example /home/wushuang/MicroSegX/ops/full-release/full-release.env
```

至少确认这些值：

```text
DEPLOY_MODE=registry
REGISTRY=<你的私有仓库>
IMAGE_NAMESPACE=<你的命名空间>
BOOTSTRAP_PASSWORD=<首次登录密码>
CONTROLLER_PVC_ENABLED=true
CONTROLLER_PVC_STORAGE_CLASS=<目标集群 StorageClass>
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
IMAGE_PULL_SECRET=<如需>
REGISTRY_USERNAME=<如需>
REGISTRY_PASSWORD=<如需>
```

### 2.2 生成 release

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-and-package.sh ops/full-release/full-release.env
```

### 2.3 推送镜像到私有仓库

```bash
bash artifacts/full-release/${CORE_TAG}/bundle/load-and-push.sh artifacts/full-release/${CORE_TAG}/bundle/full-release.env
```

### 2.4 部署 `MicroSegX`

```bash
bash artifacts/full-release/${CORE_TAG}/bundle/deploy-core.sh artifacts/full-release/${CORE_TAG}/bundle/full-release.env
```

## 3. `Port-Audit` 仓库推送路径

### 3.1 打包

```bash
cd /home/wushuang/MicroSegX
bash k8s-node-surface/scripts/build-registry-bundle.sh
```

### 3.2 推送并应用

```bash
cd /home/wushuang/MicroSegX/k8s-node-surface/dist/k8s-port-audit-registry-$(head -n 1 /home/wushuang/MicroSegX/k8s-node-surface/VERSION | tr -d '[:space:]')
export PORT_AUDIT_IMAGE=<你的私有仓库镜像地址>
./push-and-apply.sh
```

如需仓库认证，再补：

```bash
export REGISTRY_USERNAME='<username>'
export REGISTRY_PASSWORD='<password>'
export IMAGE_PULL_SECRET=regcred
./push-and-apply.sh
```

## 4. `OpenZiti`

这条路线下，`OpenZiti` 仍然建议走官方在线 Helm chart 安装。

可选入口：

- `/home/wushuang/MicroSegX/openziti/deploy-openziti-k8s.sh`
- `/home/wushuang/MicroSegX/openziti/install-openziti-k8s.sh`
- `/home/wushuang/MicroSegX/openziti/README.md`

## 5. 验证

```bash
kubectl get pods -n microsegx
kubectl get pvc -n microsegx
kubectl get pods -n openziti
kubectl get pods -n port-audit
```

## 6. 这条路线的限制

- 依赖私有仓库网络可达
- 要维护仓库凭据
- 排障面比离线 `ctr` 导入更大

所以如果没有明确的仓库拉取需求，优先还是走：

- [K8S-CONTAINERD-DELIVERY-MANUAL.md](./K8S-CONTAINERD-DELIVERY-MANUAL.md)
