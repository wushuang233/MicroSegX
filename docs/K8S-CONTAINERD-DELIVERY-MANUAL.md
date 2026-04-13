# Kubernetes `containerd/ctr` 迁移手册

这份手册是当前最新版，适用于：

- 普通 Kubernetes 集群
- 不使用私有镜像仓库
- 在每个节点上用 `ctr` 导入镜像
- 部署 `MicroSegX + OpenZiti + Port-Audit`

## 1. 打包机生成总交付包

打包机执行：

```bash
bash /home/wushuang/MicroSegX/ops/full-release/build-k8s-containerd-suite.sh \
  /home/wushuang/MicroSegX/ops/full-release/full-release.k8s-delivery.env
```

当前默认版本文件：

- `/home/wushuang/MicroSegX/ops/full-release/full-release.k8s-delivery.env`

打包前只需要确认这些值：

```text
CORE_TAG=2026.04.13-k8s-ctr-r1
SCANNER_TAG=2026.04.13-k8s-ctr-scanner-r1
UPDATER_TAG=2026.04.13-k8s-ctr-updater-r1
LOCAL_IMAGE_REGISTRY=local.microsegx
DEPLOY_MODE=local
LOCAL_RUNTIME=containerd
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
CONTROLLER_PVC_ENABLED=true
CONTROLLER_PVC_STORAGE_CLASS=<你的 StorageClass>
OPENZITI_BUNDLE_TAG=2026.04.13-k8s-ctr-r1
```

生成后的总交付包：

```text
/home/wushuang/MicroSegX/artifacts/k8s-delivery/microsegx-suite-2026.04.13-k8s-ctr-r1.tar.gz
```

## 2. 发送到新服务器的文件

只发这 1 个总包：

```text
microsegx-suite-2026.04.13-k8s-ctr-r1.tar.gz
```

它里面已经包含：

- `microsegx-release-2026.04.13-k8s-ctr-r1.tar.gz`
- `k8s-port-audit-containerd-0.2.2.tar.gz`
- `openziti-k8s-offline-2026.04.13-k8s-ctr-r1.tar.gz`
- `DEPLOY.md`

## 3. 新服务器解压

```bash
export CORE_TAG=2026.04.13-k8s-ctr-r1
export PORT_AUDIT_VERSION=0.2.2
```

```bash
sudo mkdir -p /opt/microsegx-delivery
sudo chown "$(id -u)":"$(id -g)" /opt/microsegx-delivery
cd /opt/microsegx-delivery
```

```bash
tar -xzf microsegx-suite-${CORE_TAG}.tar.gz
cd microsegx-suite-${CORE_TAG}

tar -xzf microsegx-release-${CORE_TAG}.tar.gz
tar -xzf k8s-port-audit-containerd-${PORT_AUDIT_VERSION}.tar.gz
tar -xzf openziti-k8s-offline-${CORE_TAG}.tar.gz
```

## 4. 必须填写的文件

### 4.1 MicroSegX

```bash
cp ./${CORE_TAG}/bundle/full-release.containerd.env.example ./${CORE_TAG}/bundle/full-release.containerd.env
vi ./${CORE_TAG}/bundle/full-release.containerd.env
```

必须填写：

```text
BOOTSTRAP_PASSWORD=<首次登录密码>
CONTROLLER_PVC_STORAGE_CLASS=<你的 StorageClass>
```

按需修改：

```text
MANAGER_NODE_PORT=30000
KUBECONFIG=<kubectl 所在机器的 kubeconfig 路径>
```

默认安全配置不要改掉：

```text
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
```

### 4.2 OpenZiti

```bash
cp ./openziti-k8s-offline-${CORE_TAG}/openziti.k8s.env.example ./openziti-k8s-offline-${CORE_TAG}/openziti.k8s.env
vi ./openziti-k8s-offline-${CORE_TAG}/openziti.k8s.env
```

必须填写：

```text
ZITI_PUBLIC_HOST=<外部可访问的 IP 或 DNS>
ZITI_STORAGE_CLASS_NAME=<你的 StorageClass>
```

按需修改：

```text
ZITI_CONTROLLER_NODEPORT=31280
ZITI_ROUTER_NODEPORT=30222
```

## 5. 每个 Kubernetes 节点都要导入镜像

在每个可能调度这些 Pod 的节点上执行。

### 5.1 导入 MicroSegX 镜像

```bash
sudo bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/${CORE_TAG}/bundle/import-core-images-containerd.sh \
  /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/${CORE_TAG}/bundle/full-release.containerd.env
```

### 5.2 导入 OpenZiti 镜像

```bash
sudo bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/openziti-k8s-offline-${CORE_TAG}/import-openziti-images-containerd.sh
```

### 5.3 导入 Port-Audit 镜像

```bash
sudo bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/k8s-port-audit-containerd-${PORT_AUDIT_VERSION}/import-port-audit-images-containerd.sh
```

## 6. 在有 `kubectl/helm` 权限的机器部署

### 6.1 部署 MicroSegX

```bash
bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/${CORE_TAG}/bundle/apply-core-containerd.sh \
  /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/${CORE_TAG}/bundle/full-release.containerd.env
```

### 6.2 部署 OpenZiti

```bash
bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/openziti-k8s-offline-${CORE_TAG}/install-openziti-k8s.sh \
  /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/openziti-k8s-offline-${CORE_TAG}/openziti.k8s.env
```

### 6.3 给 Port-Audit 写入 OpenZiti 管理员 Secret

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

### 6.4 部署 Port-Audit

```bash
bash /opt/microsegx-delivery/microsegx-suite-${CORE_TAG}/k8s-port-audit-containerd-${PORT_AUDIT_VERSION}/apply-port-audit-containerd.sh
```

## 7. 验证

### 7.1 MicroSegX

```bash
kubectl get pods -n microsegx -o wide
kubectl get pvc -n microsegx
kubectl get svc -n microsegx
```

### 7.2 OpenZiti

```bash
kubectl get pods,svc,pvc,certificate -n openziti -o wide
kubectl get pods -n cert-manager
kubectl exec -n openziti deploy/ziti-controller -- sh -lc 'zitiLogin >/dev/null && ziti edge list edge-routers'
```

### 7.3 Port-Audit

```bash
kubectl get pods,svc -n port-audit -o wide
kubectl -n port-audit rollout status deployment/k8s-port-audit --timeout=180s
```

## 8. 默认访问地址

```text
MicroSegX Manager: https://<任一集群节点IP>:30000
OpenZiti Controller: https://<ZITI_PUBLIC_HOST>:31280
OpenZiti Router Edge: tls://<ZITI_PUBLIC_HOST>:30222
Port-Audit: http://<port-audit-service-or-nodeport>
```
