# 普通 Kubernetes 集群最简交付文档

这份文档只保留最短主线，默认场景是：

- 最终目标是普通 Kubernetes 集群
- 不使用私有镜像仓库
- 每个目标节点用 `ctr/containerd` 导入镜像
- 交付 `MicroSegX + OpenZiti + Port-Audit`

更详细说明看：

- [K8S-CONTAINERD-DELIVERY-MANUAL.md](./K8S-CONTAINERD-DELIVERY-MANUAL.md)

## 1. 打包机

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

生成：

```text
artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
```

## 2. 发到目标服务器

只发这一份：

```text
microsegx-suite-${CORE_TAG}.tar.gz
```

## 3. 目标服务器解压

```bash
sudo mkdir -p /opt/microsegx-delivery
sudo chown "$(id -u)":"$(id -g)" /opt/microsegx-delivery
cd /opt/microsegx-delivery
tar -xzf microsegx-suite-<CORE_TAG>.tar.gz
cd microsegx-suite-<CORE_TAG>
```

```bash
export CORE_TAG="$(basename "$(pwd)" | sed 's/^microsegx-suite-//')"
export PORT_AUDIT_VERSION="$(find . -maxdepth 1 -type f -name 'k8s-port-audit-containerd-*.tar.gz' | sed -E 's#.*k8s-port-audit-containerd-(.*)\\.tar\\.gz#\\1#')"
export OPENZITI_BUNDLE_TAG="$(find . -maxdepth 1 -type f -name 'openziti-k8s-offline-*.tar.gz' | sed -E 's#.*openziti-k8s-offline-(.*)\\.tar\\.gz#\\1#')"
```

```bash
tar -xzf microsegx-release-${CORE_TAG}.tar.gz
tar -xzf k8s-port-audit-containerd-${PORT_AUDIT_VERSION}.tar.gz
tar -xzf openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}.tar.gz
```

## 4. 填两个 env 文件

### 4.1 `MicroSegX`

```bash
cp ./${CORE_TAG}/bundle/full-release.containerd.env.example ./${CORE_TAG}/bundle/full-release.containerd.env
vi ./${CORE_TAG}/bundle/full-release.containerd.env
```

至少填：

```text
BOOTSTRAP_PASSWORD=<首次登录密码>
CONTROLLER_PVC_STORAGE_CLASS=<StorageClass>
```

### 4.2 `OpenZiti`

```bash
cp ./openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/openziti.k8s.env.example ./openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/openziti.k8s.env
vi ./openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/openziti.k8s.env
```

至少填：

```text
ZITI_PUBLIC_HOST=<外部可访问 IP 或 DNS>
ZITI_STORAGE_CLASS_NAME=<StorageClass>
```

## 5. 每个目标节点导入镜像

```bash
sudo bash ./${CORE_TAG}/bundle/import-core-images-containerd.sh ./${CORE_TAG}/bundle/full-release.containerd.env
sudo bash ./openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/import-openziti-images-containerd.sh
sudo bash ./k8s-port-audit-containerd-${PORT_AUDIT_VERSION}/import-port-audit-images-containerd.sh
```

## 6. 在有 `kubectl/helm` 权限的机器部署

```bash
bash ./${CORE_TAG}/bundle/apply-core-containerd.sh ./${CORE_TAG}/bundle/full-release.containerd.env
```

```bash
bash ./openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/install-openziti-k8s.sh ./openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/openziti.k8s.env
```

```bash
kubectl create namespace port-audit --dry-run=client -o yaml | kubectl apply -f -
export ZITI_PUBLIC_HOST='<填你的 OpenZiti 外部地址>'
export ZITI_CONTROLLER_NODEPORT=31280
export ZITI_DEFAULT_CONTROLLER_URL="https://${ZITI_PUBLIC_HOST}:${ZITI_CONTROLLER_NODEPORT}"
export ZITI_DEFAULT_USERNAME="$(kubectl get secret ziti-controller-admin-secret -n openziti -o jsonpath='{.data.admin-user}' | base64 -d)"
export ZITI_DEFAULT_PASSWORD="$(kubectl get secret ziti-controller-admin-secret -n openziti -o jsonpath='{.data.admin-password}' | base64 -d)"
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: k8s-port-audit-ziti-admin
  namespace: port-audit
type: Opaque
stringData:
  ZITI_DEFAULT_CONTROLLER_URL: ${ZITI_DEFAULT_CONTROLLER_URL}
  ZITI_DEFAULT_USERNAME: ${ZITI_DEFAULT_USERNAME}
  ZITI_DEFAULT_PASSWORD: ${ZITI_DEFAULT_PASSWORD}
EOF
```

```bash
bash ./k8s-port-audit-containerd-${PORT_AUDIT_VERSION}/apply-port-audit-containerd.sh
```

## 7. 验证

```bash
kubectl get pods -n microsegx
kubectl get pvc -n microsegx
kubectl get pods -n openziti
kubectl get pods -n port-audit
```

如果你只需要一个判断标准：

- `microsegx` 四个核心 Pod 都是 `Running`
- `microsegx-data` 是 `Bound`
- `openziti` controller/router 都是 `Running`
- `port-audit` 是 `Running`
