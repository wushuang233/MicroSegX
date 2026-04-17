# 普通 Kubernetes 集群 `ctr/containerd` 离线交付主手册

这是当前主手册，适用于：

- 普通 Kubernetes 集群
- 不使用私有镜像仓库
- 在目标节点上用 `ctr/containerd` 导入镜像
- 交付 `MicroSegX + OpenZiti + Port-Audit`

如果你只想要最短命令版，直接看：

- [MINIMAL-TRANSFER-DEPLOY-K8S.md](./MINIMAL-TRANSFER-DEPLOY-K8S.md)

## 1. 打包机生成总交付包

先确认环境文件：

```bash
sed -n '1,240p' /home/wushuang/MicroSegX/ops/full-release/full-release.k8s-delivery.env
```

至少确认这些值：

```text
DEPLOY_MODE=local
LOCAL_RUNTIME=containerd
LOCAL_IMAGE_REGISTRY=local.microsegx
CORE_TAG=<你的 core tag>
SCANNER_TAG=<你的 scanner tag>
UPDATER_TAG=<你的 updater tag>
BOOTSTRAP_PASSWORD=<首次登录密码>
CONTROLLER_PVC_ENABLED=true
CONTROLLER_PVC_STORAGE_CLASS=<目标集群 StorageClass>
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
OPENZITI_BUNDLE_TAG=<通常跟 CORE_TAG 一致>
```

执行：

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

生成后的总包：

```text
artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
```

## 2. 发送到目标服务器的文件

建议一起发送：

- `microsegx-suite-${CORE_TAG}.tar.gz`
- `microsegx-suite-${CORE_TAG}.tar.gz.sha256`

总包内已经包含：

- `microsegx-release-${CORE_TAG}.tar.gz`
- `k8s-port-audit-containerd-${PORT_AUDIT_VERSION}.tar.gz`
- `openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}.tar.gz`
- `DEPLOY.md`

## 3. 目标服务器解压

```bash
sudo mkdir -p /opt/microsegx-delivery
sudo chown "$(id -u)":"$(id -g)" /opt/microsegx-delivery
cd /opt/microsegx-delivery
```

```bash
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

## 4. 必填文件

### 4.1 `MicroSegX`

```bash
cp ./${CORE_TAG}/bundle/full-release.containerd.env.example ./${CORE_TAG}/bundle/full-release.containerd.env
vi ./${CORE_TAG}/bundle/full-release.containerd.env
```

必须填写：

```text
BOOTSTRAP_PASSWORD=<首次登录密码>
CONTROLLER_PVC_STORAGE_CLASS=<目标集群 StorageClass>
```

按需修改：

```text
MANAGER_NODE_PORT=30000
KUBECONFIG=<kubectl 所在机器的 kubeconfig 路径>
```

默认安全基线建议保留：

```text
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
CONTROLLER_PVC_ENABLED=true
```

### 4.2 `OpenZiti`

```bash
cp ./openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/openziti.k8s.env.example ./openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/openziti.k8s.env
vi ./openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/openziti.k8s.env
```

必须填写：

```text
ZITI_PUBLIC_HOST=<外部可访问的 IP 或 DNS>
ZITI_STORAGE_CLASS_NAME=<目标集群 StorageClass>
```

按需修改：

```text
ZITI_CONTROLLER_NODEPORT=31280
ZITI_ROUTER_NODEPORT=30222
```

## 5. 每个目标节点都要导入镜像

只要这个节点上可能调度 `MicroSegX/OpenZiti/Port-Audit` Pod，就要先导入镜像。

### 5.1 `MicroSegX core`

```bash
sudo bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/${CORE_TAG}/bundle/import-core-images-containerd.sh \
  /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/${CORE_TAG}/bundle/full-release.containerd.env
```

### 5.2 `OpenZiti`

```bash
sudo bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/import-openziti-images-containerd.sh
```

### 5.3 `Port-Audit`

```bash
sudo bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/k8s-port-audit-containerd-${PORT_AUDIT_VERSION}/import-port-audit-images-containerd.sh
```

## 6. 在有 `kubectl/helm` 权限的机器执行部署

### 6.1 部署 `MicroSegX`

```bash
bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/${CORE_TAG}/bundle/apply-core-containerd.sh \
  /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/${CORE_TAG}/bundle/full-release.containerd.env
```

### 6.2 部署 `OpenZiti`

```bash
bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/install-openziti-k8s.sh \
  /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/openziti-k8s-offline-${OPENZITI_BUNDLE_TAG}/openziti.k8s.env
```

### 6.3 写入 `Port-Audit` 的 OpenZiti 管理员 Secret

```bash
kubectl create namespace port-audit --dry-run=client -o yaml | kubectl apply -f -
```

```bash
export ZITI_PUBLIC_HOST='<填你的 OpenZiti 外部地址>'
export ZITI_CONTROLLER_NODEPORT=31280
export ZITI_DEFAULT_CONTROLLER_URL="https://${ZITI_PUBLIC_HOST}:${ZITI_CONTROLLER_NODEPORT}"
export ZITI_DEFAULT_USERNAME="$(kubectl get secret ziti-controller-admin-secret -n openziti -o jsonpath='{.data.admin-user}' | base64 -d)"
export ZITI_DEFAULT_PASSWORD="$(kubectl get secret ziti-controller-admin-secret -n openziti -o jsonpath='{.data.admin-password}' | base64 -d)"
```

```bash
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

### 6.4 部署 `Port-Audit`

```bash
bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/k8s-port-audit-containerd-${PORT_AUDIT_VERSION}/apply-port-audit-containerd.sh
```

## 7. 最小验收

### 7.1 `MicroSegX`

```bash
kubectl get pods -n microsegx -o wide
kubectl get pvc -n microsegx -o wide
kubectl get svc -n microsegx
```

期待至少看到：

- `microsegx-controller-pod` `Running`
- `microsegx-manager-pod` `Running`
- `microsegx-enforcer-pod` `Running`
- `microsegx-scanner-pod` `Running`
- `microsegx-data` 为 `Bound`

### 7.2 `OpenZiti`

```bash
kubectl get pods,svc,pvc,certificate -n openziti -o wide
kubectl get pods -n cert-manager
```

### 7.3 `Port-Audit`

```bash
kubectl get pods,svc -n port-audit -o wide
kubectl -n port-audit rollout status deployment/k8s-port-audit --timeout=180s
```

## 8. 后续增量更新要注意的事

- 如果你后续又单独重打了 `manager`、`controller`、`enforcer` 或 `scanner`，不要只在当前机器上改 Deployment。
  对最终集群交付，要么重新生成总包，要么把“当前精确 tag”的镜像重新导入到每个目标节点。

- 普通 Kubernetes 集群不像本机 `k3s` 那样有自动导入目录。
  节点重装、节点替换、或容器运行时清空后，需要重新执行第 5 节的导入脚本。

- `controller` 持久化不要关闭。
  如果你把 `PVC` 去掉，后续 controller Pod 重建时用户配置和密码会一起丢。
