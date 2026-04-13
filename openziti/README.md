# OpenZiti 部署说明

如果你要迁移到另一台普通 Kubernetes 服务器，并且走 `ctr/containerd` 离线导入，请优先看：

- `/home/wushuang/MicroSegX/docs/K8S-CONTAINERD-DELIVERY-MANUAL.md`
- `/home/wushuang/MicroSegX/openziti/build-openziti-offline-bundle.sh`

这份目录只做两件事：

- 还原你当前集群里的 `openziti` 是怎么部署出来的
- 给出一套普通 Kubernetes 集群可直接执行的部署命令

## 1. 当前集群实际跑的是什么

我在 `2026-04-08` 直接从当前集群里读到的结果是：

- namespace：`openziti`
- controller release：`ziti-controller`
- router release：`ziti-router`
- cert-manager release：`cert-manager`
- trust-manager release：`trust-manager`
- controller chart：`ziti-controller-3.1.1`
- router chart：`ziti-router-2.1.0`
- cert-manager chart：`cert-manager-v1.20.1`
- trust-manager chart：`trust-manager-v0.22.0`
- controller 镜像：`docker.io/openziti/ziti-controller:1.7.2`
- router 镜像：`docker.io/openziti/ziti-router:1.7.2`
- controller 对外地址：`192.168.198.128:31280`
- router 对外地址：`192.168.198.128:30222`
- controller PVC：`ziti-controller-db`
- router PVC：`ziti-router`
- trust-manager 的 trust namespace：`openziti`

这说明你这套 live 环境并不是“随便手工点出来的”，而是很像下面这条固定部署链：

1. 安装 `cert-manager`
2. 安装 `trust-manager`，并把 `app.trust.namespace` 设成 `openziti`
3. 创建 `openziti` namespace，并打上 `openziti.io/namespace=enabled`
4. 先准备 controller 的 PVC
5. Helm 安装 `ziti-controller`
6. 给 controller 的证书补上外部 IP 的 SAN
7. 进入 controller 容器，用 `ziti edge create edge-router ...` 生成 router enrollment JWT
8. 把 JWT 做成 secret：`ziti-router-enrollment`
9. Helm 安装 `ziti-router`

这是一个推断，但证据很强，因为它和仓库里的旧脚本
`k8s-node-surface/scripts/deploy-openziti-k3s.sh`
在 release 名、chart 版本、NodePort、PVC 名、trust namespace、router enrollment secret 名这些关键点上全部一致。

## 2. 当前集群的关键资源

你现在这套最关键的资源只有这些：

- `deployment/ziti-controller`
- `deployment/ziti-router`
- `service/ziti-controller-client`
- `service/ziti-router-edge`
- `service/ziti-router-transport`
- `pvc/ziti-controller-db`
- `secret/ziti-controller-admin-secret`
- `secret/ziti-router-enrollment`
- 一组 controller 证书
  - `ziti-controller-ctrl-plane-identity`
  - `ziti-controller-web-identity-cert`
  - 以及对应 root / signer / client identity 证书

所以你理解得基本对：

- 必须有 `ziti-controller`
- 必须有 `ziti-router`
- 必须有 `cert-manager + trust-manager`
- 必须有 controller 的持久化 PVC
- 必须有 controller 证书
- router 的 JWT enrollment secret 也必须有

## 3. 这套目录里的文件

- [deploy-openziti-k8s.sh](/home/wushuang/MicroSegX/openziti/deploy-openziti-k8s.sh)
- [ziti-controller-values.yaml](/home/wushuang/MicroSegX/openziti/ziti-controller-values.yaml)
- [ziti-router-values.yaml](/home/wushuang/MicroSegX/openziti/ziti-router-values.yaml)

这套脚本不是离线版，不做本地镜像导入，直接使用官方 Helm chart 和官方镜像仓库。

## 4. 最短部署方式

先准备几个变量：

```bash
export ZITI_PUBLIC_HOST=192.168.198.128
export ZITI_STORAGE_CLASS_NAME=local-path
export ZITI_CONTROLLER_NODEPORT=31280
export ZITI_ROUTER_NODEPORT=30222
```

然后直接执行：

```bash
bash /home/wushuang/MicroSegX/openziti/deploy-openziti-k8s.sh
```

这条脚本会自动完成：

- 安装或升级 `cert-manager`
- 安装或升级 `trust-manager`
- 创建 `openziti` namespace 和 controller PVC
- 安装 `ziti-controller`
- 如果 `ZITI_PUBLIC_HOST` 是 IP，就补 controller 证书的 `ipAddresses`
- 进 controller 容器登录 `ziti edge`
- 创建 `ziti-router` 的 enrollment JWT secret
- 安装 `ziti-router`
- 最后输出验收结果

## 5. 手工命令版

如果你不想跑脚本，按下面顺序执行。

### 5.1 Helm 仓库

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo add openziti https://docs.openziti.io/helm-charts/
helm repo update
```

### 5.2 安装 cert-manager

```bash
helm upgrade --install cert-manager jetstack/cert-manager \
  -n cert-manager \
  --create-namespace \
  --version 1.20.1 \
  --set crds.enabled=true
```

### 5.3 创建 openziti namespace 和 controller PVC

```bash
kubectl create namespace openziti --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace openziti openziti.io/namespace=enabled --overwrite
```

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ziti-controller-db
  namespace: openziti
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 2Gi
  storageClassName: local-path
EOF
```

如果你的集群不是 `local-path`，把 `storageClassName` 改成你自己的存储类。

### 5.4 安装 trust-manager

```bash
helm upgrade --install trust-manager jetstack/trust-manager \
  -n cert-manager \
  --version 0.22.0 \
  --set app.trust.namespace=openziti
```

### 5.5 安装 controller

```bash
helm upgrade --install ziti-controller openziti/ziti-controller \
  -n openziti \
  --version 3.1.1 \
  --server-side=false \
  -f /home/wushuang/MicroSegX/openziti/ziti-controller-values.yaml \
  --set persistence.existingClaim=ziti-controller-db \
  --set clientApi.advertisedHost=192.168.198.128 \
  --set clientApi.advertisedPort=31280
```

如果外部地址是 IP，还要补 controller 证书的 IP SAN：

```bash
kubectl patch certificate -n openziti ziti-controller-ctrl-plane-identity \
  --type=merge \
  -p '{"spec":{"ipAddresses":["127.0.0.1","::1","192.168.198.128"]}}'

kubectl patch certificate -n openziti ziti-controller-web-identity-cert \
  --type=merge \
  -p '{"spec":{"ipAddresses":["127.0.0.1","::1","192.168.198.128"]}}'
```

然后等证书 ready，再重启 controller：

```bash
kubectl wait certificate.cert-manager.io/ziti-controller-ctrl-plane-identity -n openziti --for=condition=Ready=true --timeout=180s
kubectl wait certificate.cert-manager.io/ziti-controller-web-identity-cert -n openziti --for=condition=Ready=true --timeout=180s
kubectl rollout restart deployment/ziti-controller -n openziti
kubectl rollout status deployment/ziti-controller -n openziti --timeout=180s
```

### 5.6 生成 router enrollment JWT

如果是全新安装，可以直接创建：

```bash
kubectl exec -n openziti deploy/ziti-controller -- sh -lc '
  zitiLogin >/dev/null &&
  ziti edge create edge-router "ziti-router" \
    --role-attributes "public-router" \
    --jwt-output-file /tmp/ziti-router.jwt >/dev/null &&
  cat /tmp/ziti-router.jwt
'
```

把输出保存成变量，再创建 secret：

```bash
ROUTER_JWT='<上一步输出的整段 jwt>'

kubectl delete secret ziti-router-enrollment -n openziti --ignore-not-found=true
kubectl create secret generic ziti-router-enrollment \
  -n openziti \
  --from-literal=enrollmentJwt="${ROUTER_JWT}"
```

### 5.7 安装 router

```bash
helm upgrade --install ziti-router openziti/ziti-router \
  -n openziti \
  --version 2.1.0 \
  --server-side=false \
  -f /home/wushuang/MicroSegX/openziti/ziti-router-values.yaml \
  --set enrollmentJwtSecretName=ziti-router-enrollment \
  --set ctrl.endpoint=192.168.198.128:31280 \
  --set edge.advertisedHost=192.168.198.128 \
  --set edge.advertisedPort=30222 \
  --set csr.sans.ip[1]=192.168.198.128
```

然后等待 router ready：

```bash
kubectl rollout status deployment/ziti-router -n openziti --timeout=180s
```

## 6. 验收命令

看基础资源：

```bash
kubectl get pods,svc,pvc,certificate -n openziti -o wide
kubectl get pods -n cert-manager
```

进 controller 验证 router 是否在线：

```bash
kubectl exec -n openziti deploy/ziti-controller -- sh -lc '
  zitiLogin >/dev/null &&
  ziti edge list edge-routers
'
```

你当前集群的健康结果就是这样：

```text
ID         NAME        ONLINE  ALLOW TRANSIT  COST  ATTRIBUTES
mtpD7p68qQ ziti-router true    true           0     public-router
```

## 7. 当前管理员账号怎么查

用户名现在可以直接这样看：

```bash
kubectl get secret ziti-controller-admin-secret -n openziti -o jsonpath='{.data.admin-user}' | base64 -d && echo
```

密码也在同一个 secret 里：

```bash
kubectl get secret ziti-controller-admin-secret -n openziti -o jsonpath='{.data.admin-password}' | base64 -d && echo
```

## 8. 几个很容易踩的坑

- `trust-manager` 只认一个 trust namespace。你现在 live 集群用的是 `openziti`，后面不要把 controller 换到别的 namespace，又忘了改 `trust-manager`
- controller 一定要有 PVC，否则重启后数据库会丢
- 如果 `advertisedHost` 是 IP，只改 Helm values 不够，controller 证书还要补 `ipAddresses`
- router 不是“装个 chart 就能连上”，中间必须先从 controller 生成 enrollment JWT secret
- 这套脚本为了复现当前集群的行为，默认使用 `NodePort + 外部 IP`，不是 `LoadBalancer` 或 `Ingress`
- 重新跑部署脚本会重建 router enrollment，并重装 router；对正在使用的 router 会有短暂影响
