# Kubernetes 交付与部署手册

## 1. 交付内容

发送到目标服务器的文件一共 3 个压缩包：

- `microsegx-release-${CORE_TAG}.tar.gz`
- `k8s-port-audit-registry-${PORT_AUDIT_VERSION}.tar.gz`
- `openziti-k8s.tar.gz`

`microsegx-release-${CORE_TAG}.tar.gz` 内包含：

- `images-${CORE_TAG}.tar.gz`
- `bundle/load-and-push.sh`
- `bundle/deploy-core.sh`
- `bundle/reset-microsegx.sh`
- `bundle/full-release.env`
- `bundle/charts/`

`k8s-port-audit-registry-${PORT_AUDIT_VERSION}.tar.gz` 内包含：

- `k8s-port-audit-${PORT_AUDIT_VERSION}.tar.gz`
- `k8s-port-audit.yaml`
- `k8s-port-audit-ziti-admin-secret.example.yaml`
- `push-and-apply.sh`
- `VERSION`

`openziti-k8s.tar.gz` 内包含：

- `deploy-openziti-k8s.sh`
- `ziti-controller-values.yaml`
- `ziti-router-values.yaml`

## 2. 需要的镜像

`MicroSegX core` 会打包并推送这些镜像：

- `${REGISTRY}/${IMAGE_NAMESPACE}/controller:${CORE_TAG}`
- `${REGISTRY}/${IMAGE_NAMESPACE}/enforcer:${CORE_TAG}`
- `${REGISTRY}/${IMAGE_NAMESPACE}/manager:${CORE_TAG}`
- `${REGISTRY}/${IMAGE_NAMESPACE}/scanner:${SCANNER_TAG}`
- `${REGISTRY}/${IMAGE_NAMESPACE}/updater:${UPDATER_TAG}`

`port-audit` 会打包并推送这个镜像：

- `${PORT_AUDIT_IMAGE}`

`OpenZiti` 不走本地镜像包，默认直接从官方仓库拉取：

- `openziti/ziti-controller`
- `openziti/ziti-router`
- `jetstack/cert-manager`
- `jetstack/trust-manager`

前提：

- 目标服务器能访问你的私有镜像仓库
- 目标服务器能访问 `https://charts.jetstack.io`
- 目标服务器能访问 `https://docs.openziti.io/helm-charts/`
- 目标服务器能从官方镜像仓库拉取 `OpenZiti/cert-manager/trust-manager` 镜像

## 3. 打包机执行

### 3.1 准备变量

```bash
export REGISTRY=harbor.example.com
export IMAGE_NAMESPACE=microsegx
export CORE_TAG=2026.04.09-r1
export SCANNER_TAG=2026.04.09-scanner-r1
export UPDATER_TAG=0.0.9
export BOOTSTRAP_PASSWORD='ChangeMe123!'
export MANAGER_NODE_PORT=30000
export CONTROLLER_STORAGE_CLASS=nfs-client
export IMAGE_PULL_SECRET=regcred
export REGISTRY_USERNAME='<registry-username>'
export REGISTRY_PASSWORD='<registry-password>'
export REGISTRY_EMAIL='devnull@example.com'

export ZITI_PUBLIC_HOST=10.10.10.20
export ZITI_STORAGE_CLASS_NAME=nfs-client
export ZITI_CONTROLLER_NODEPORT=31280
export ZITI_ROUTER_NODEPORT=30222

export PORT_AUDIT_VERSION="$(head -n 1 /home/wushuang/MicroSegX/k8s-node-surface/VERSION | tr -d '[:space:]')"
export PORT_AUDIT_IMAGE="${REGISTRY}/security/k8s-port-audit:${PORT_AUDIT_VERSION}"
```

### 3.2 生成 `full-release.env`

```bash
cat >/home/wushuang/MicroSegX/ops/full-release/full-release.env <<EOF
RELEASE_NAME=microsegx
NAMESPACE=microsegx

DEPLOY_MODE=registry
REGISTRY=${REGISTRY}
IMAGE_NAMESPACE=${IMAGE_NAMESPACE}

LOCAL_IMAGE_REGISTRY=local.microsegx
LOCAL_RUNTIME=k3s
CONTAINERD_NAMESPACE=k8s.io

CORE_TAG=${CORE_TAG}
SCANNER_TAG=${SCANNER_TAG}
UPDATER_TAG=${UPDATER_TAG}
REGISTRY_ADAPTER_TAG=0.2.4
COMPLIANCE_CONFIG_TAG=1.0.11

TARGET_PLATFORM=linux/amd64
ARTIFACT_DIR=
USE_LOCAL_DOCKERFILES=true
BUILD_FROM_SOURCE=true

IMAGE_PULL_SECRET=${IMAGE_PULL_SECRET}
REGISTRY_USERNAME=${REGISTRY_USERNAME}
REGISTRY_PASSWORD=${REGISTRY_PASSWORD}
REGISTRY_EMAIL=${REGISTRY_EMAIL}

MANAGER_HOST=
INGRESS_CLASS=nginx
MANAGER_TLS=false
MANAGER_TLS_SECRET=
MANAGER_SERVICE_TYPE=NodePort
MANAGER_NODE_PORT=${MANAGER_NODE_PORT}

CONTROLLER_REPLICAS=1
SCANNER_REPLICAS=1

CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP

CONTROLLER_PVC_ENABLED=true
CONTROLLER_PVC_EXISTING_CLAIM=
CONTROLLER_PVC_ACCESS_MODE=ReadWriteOnce
CONTROLLER_PVC_STORAGE_CLASS=${CONTROLLER_STORAGE_CLASS}
CONTROLLER_PVC_CAPACITY=2Gi
CONTROLLER_STRATEGY_TYPE=Recreate

RUNTIME_PATH=

AUTO_GENERATE_CERT=true
INTERNAL_AUTO_ROTATE_CERT=true
BOOTSTRAP_PASSWORD=${BOOTSTRAP_PASSWORD}

BUILD_UPDATER_FROM_SOURCE=true
MIRROR_UPDATER=true
MIRROR_REGISTRY_ADAPTER=false
MIRROR_COMPLIANCE_CONFIG=false
ENABLE_REGISTRY_ADAPTER=false
ENABLE_CONTROLLER_PRIME=false
K3S_IMPORT_HELPER_NODE_NAME=
K3S_IMPORT_HELPER_NODE_IP=

UPSTREAM_UPDATER_IMAGE=microsegx/updater:0.0.9
UPSTREAM_REGISTRY_ADAPTER_IMAGE=microsegx/registry-adapter:0.2.4
UPSTREAM_COMPLIANCE_CONFIG_IMAGE=microsegx/compliance-config:1.0.11

KUBECONFIG=
EOF
```

### 3.3 打包 `MicroSegX core`

```bash
bash /home/wushuang/MicroSegX/ops/full-release/build-and-package.sh /home/wushuang/MicroSegX/ops/full-release/full-release.env
```

```bash
tar -C /home/wushuang/MicroSegX/artifacts/full-release -czf /home/wushuang/MicroSegX/artifacts/full-release/microsegx-release-${CORE_TAG}.tar.gz ${CORE_TAG}
```

### 3.4 打包 `port-audit`

```bash
bash /home/wushuang/MicroSegX/k8s-node-surface/scripts/build-registry-bundle.sh
```

```bash
tar -C /home/wushuang/MicroSegX/k8s-node-surface/dist -czf /home/wushuang/MicroSegX/k8s-node-surface/dist/k8s-port-audit-registry-${PORT_AUDIT_VERSION}.tar.gz k8s-port-audit-registry-${PORT_AUDIT_VERSION}
```

### 3.5 打包 `OpenZiti` 部署目录

```bash
tar -C /home/wushuang/MicroSegX -czf /home/wushuang/MicroSegX/openziti-k8s.tar.gz openziti
```

### 3.6 校验文件

```bash
sha256sum /home/wushuang/MicroSegX/artifacts/full-release/microsegx-release-${CORE_TAG}.tar.gz
sha256sum /home/wushuang/MicroSegX/k8s-node-surface/dist/k8s-port-audit-registry-${PORT_AUDIT_VERSION}.tar.gz
sha256sum /home/wushuang/MicroSegX/openziti-k8s.tar.gz
```

## 4. 目标服务器准备

目标服务器需要这些命令：

- `docker`
- `kubectl`
- `helm`
- `jq`
- `tar`
- `gzip`

创建工作目录：

```bash
sudo mkdir -p /opt/microsegx-delivery
sudo chown "$(id -u)":"$(id -g)" /opt/microsegx-delivery
cd /opt/microsegx-delivery
```

设置版本变量：

```bash
export CORE_TAG=2026.04.09-r1
export PORT_AUDIT_VERSION=0.2.2
```

把这 3 个文件传到目标服务器：

- `microsegx-release-${CORE_TAG}.tar.gz`
- `k8s-port-audit-registry-${PORT_AUDIT_VERSION}.tar.gz`
- `openziti-k8s.tar.gz`

解压：

```bash
tar -xzf microsegx-release-${CORE_TAG}.tar.gz
tar -xzf k8s-port-audit-registry-${PORT_AUDIT_VERSION}.tar.gz
tar -xzf openziti-k8s.tar.gz
```

## 5. 部署 `MicroSegX core`

### 5.1 检查环境文件

```bash
sed -n '1,240p' /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

必须确认这些值：

- `DEPLOY_MODE=registry`
- `REGISTRY=<你的私有镜像仓库>`
- `IMAGE_NAMESPACE=<你的镜像命名空间>`
- `BOOTSTRAP_PASSWORD=<首次登录密码>`
- `CONTROLLER_HOST_NETWORK=false`
- `ENFORCER_HOST_NETWORK=false`
- `CONTROLLER_API_SERVICE_TYPE=ClusterIP`
- `MANAGER_SERVICE_TYPE=NodePort`
- `MANAGER_NODE_PORT=30000`
- `CONTROLLER_PVC_ENABLED=true`
- `CONTROLLER_PVC_ACCESS_MODE=ReadWriteOnce`
- `CONTROLLER_PVC_STORAGE_CLASS=<你的 StorageClass>`
- `CONTROLLER_STRATEGY_TYPE=Recreate`

如果要改：

```bash
vi /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

### 5.2 如需重装，先清理旧版本

```bash
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/reset-microsegx.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

### 5.3 推送 `MicroSegX` 镜像到私有仓库

```bash
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/load-and-push.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

### 5.4 部署 `MicroSegX`

```bash
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/deploy-core.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

### 5.5 默认安全配置验收

必须保持下面三个结果：

- `controller` 不使用 `hostNetwork`
- `enforcer` 不使用 `hostNetwork`
- `microsegx-svc-controller-api` 保持 `ClusterIP`

验证命令：

```bash
kubectl -n microsegx get deploy microsegx-controller-pod -o jsonpath='{.spec.template.spec.hostNetwork}{"\n"}'
kubectl -n microsegx get ds microsegx-enforcer-pod -o jsonpath='{.spec.template.spec.hostNetwork}{"\n"}'
kubectl -n microsegx get svc microsegx-svc-controller-api -o jsonpath='{.spec.type}{"\n"}'
```

预期结果：

- controller 输出空值或 `false`
- enforcer 输出空值或 `false`
- service 输出 `ClusterIP`

以下端口只应存在于 Pod 网络，不应监听在宿主机：

- controller: `10443` `20443` `30443`
- enforcer: `18311` `18401` `18500`

如果你登录的是承载 `microsegx-controller-pod` 或 `microsegx-enforcer-pod` 的节点，再执行：

```bash
ss -lntup | rg ':(10443|20443|30443|18311|18401|18500)\b' || true
```

预期输出为空。

### 5.6 验证 `MicroSegX`

```bash
kubectl get pods -n microsegx -o wide
kubectl get pvc -n microsegx
kubectl get svc -n microsegx
```

访问 manager：

```text
https://<任一集群节点IP>:30000
```

## 6. 部署 `OpenZiti`

### 6.1 设置变量

```bash
export ZITI_NAMESPACE=openziti
export CERT_MANAGER_NAMESPACE=cert-manager
export ZITI_PUBLIC_HOST=10.10.10.20
export ZITI_STORAGE_CLASS_NAME=nfs-client
export ZITI_CONTROLLER_NODEPORT=31280
export ZITI_ROUTER_NODEPORT=30222
```

### 6.2 部署

```bash
bash /opt/microsegx-delivery/openziti/deploy-openziti-k8s.sh
```

### 6.3 验证

```bash
kubectl get pods,svc,pvc,certificate -n openziti -o wide
kubectl get pods -n cert-manager
kubectl exec -n openziti deploy/ziti-controller -- sh -lc 'zitiLogin >/dev/null && ziti edge list edge-routers'
```

### 6.4 获取 `OpenZiti` 管理员账号

```bash
kubectl get secret ziti-controller-admin-secret -n openziti -o jsonpath='{.data.admin-user}' | base64 -d && echo
kubectl get secret ziti-controller-admin-secret -n openziti -o jsonpath='{.data.admin-password}' | base64 -d && echo
```

## 7. 部署 `port-audit`

### 7.1 进入交付目录

```bash
cd /opt/microsegx-delivery/k8s-port-audit-registry-${PORT_AUDIT_VERSION}
```

### 7.2 创建 `OpenZiti` 管理员 secret

```bash
kubectl create namespace port-audit --dry-run=client -o yaml | kubectl apply -f -
```

```bash
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

### 7.3 推送镜像并部署

```bash
export PORT_AUDIT_IMAGE=harbor.example.com/security/k8s-port-audit:${PORT_AUDIT_VERSION}
export REGISTRY_USERNAME='<registry-username>'
export REGISTRY_PASSWORD='<registry-password>'
export REGISTRY_EMAIL='devnull@example.com'
export IMAGE_PULL_SECRET=regcred
```

```bash
./push-and-apply.sh
```

### 7.4 验证

```bash
kubectl get pods -n port-audit -o wide
kubectl get svc -n port-audit
kubectl -n port-audit rollout status deployment/k8s-port-audit --timeout=180s
```

访问 `port-audit`：

```bash
kubectl -n port-audit port-forward svc/k8s-port-audit 8080:8080
```

```text
http://127.0.0.1:8080
```

## 8. 最终验收

```bash
kubectl get pods -n microsegx
kubectl get pvc -n microsegx
kubectl get pods -n openziti
kubectl get pods -n cert-manager
kubectl get pods -n port-audit
```

应至少看到：

- `microsegx-controller-pod` `Running`
- `microsegx-manager-pod` `Running`
- `microsegx-enforcer-pod` `Running`
- `microsegx-scanner-pod` `Running`
- `microsegx-data` `Bound`
- `ziti-controller` `Running`
- `ziti-router` `Running`
- `k8s-port-audit` `Running`

## 9. 重装命令

仅重装 `MicroSegX core`：

```bash
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/reset-microsegx.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/load-and-push.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/deploy-core.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

重装 `OpenZiti`：

```bash
bash /opt/microsegx-delivery/openziti/deploy-openziti-k8s.sh
```

重装 `port-audit`：

```bash
cd /opt/microsegx-delivery/k8s-port-audit-registry-${PORT_AUDIT_VERSION}
./push-and-apply.sh
```
