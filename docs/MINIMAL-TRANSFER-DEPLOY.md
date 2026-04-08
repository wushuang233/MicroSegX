# 最简交付文档

这份文档只写三件事：

- 哪些目录要打成 `tar.gz`
- 发到新服务器后怎么解压
- 运行哪些命令把 `microsegx + port-audit` 装起来

适用场景：

- 单机 `k3s`
- 目标机本地导入镜像
- `port-audit` 侧使用完整 `OpenZiti + port-audit` 离线包

## 1. 需要发送到新服务器的两个压缩包

### 1.1 MicroSegX 核心包

先在打包机上生成 release 目录：

```bash
bash ops/full-release/build-and-package.sh ops/full-release/full-release.env
```

打包前先确认：

- `ops/full-release/full-release.env` 里已经设置 `BOOTSTRAP_PASSWORD`

然后把整个 release 目录打成一个包：

```bash
CORE_TAG=<你的 release tag>
tar -C /home/wushuang/MicroSegX/artifacts/full-release -czf microsegx-release-${CORE_TAG}.tar.gz ${CORE_TAG}
```

这个包里已经包含：

- `images-${CORE_TAG}.tar.gz`
- `bundle/load-local-images.sh`
- `bundle/deploy-core.sh`
- `bundle/reset-microsegx.sh`
- `bundle/full-release.env`

### 1.2 Port-Audit 全量包

把完整 `OpenZiti + port-audit` 离线目录打成一个包：

```bash
tar -C /home/wushuang/MicroSegX/k8s-node-surface/dist -czf k8s-port-audit-stack-local-0.2.2.tar.gz k8s-port-audit-stack-local-0.2.2
```

这个包里已经包含：

- `k8s-port-audit-stack-0.2.2.tar`
- `openziti-stack-installer-local.yaml`

## 2. 发到新服务器后解压

```bash
mkdir -p /opt/microsegx-delivery
cd /opt/microsegx-delivery

tar -xzf microsegx-release-${CORE_TAG}.tar.gz
tar -xzf k8s-port-audit-stack-local-0.2.2.tar.gz
```

## 3. 安装 MicroSegX

如果新服务器上装过旧版 `microsegx`，先清理：

```bash
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/reset-microsegx.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

然后导入镜像并安装：

```bash
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/load-local-images.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
bash /opt/microsegx-delivery/${CORE_TAG}/bundle/deploy-core.sh /opt/microsegx-delivery/${CORE_TAG}/bundle/full-release.env
```

## 4. 安装 Port-Audit + OpenZiti

```bash
cd /opt/microsegx-delivery/k8s-port-audit-stack-local-0.2.2

sudo k3s ctr -n k8s.io images import ./k8s-port-audit-stack-0.2.2.tar
kubectl apply -f ./openziti-stack-installer-local.yaml
kubectl logs -n openziti-installer job/openziti-stack-installer -f
```

## 5. 最小验证

```bash
kubectl get pods -n microsegx
kubectl get pods -n port-audit
kubectl get pods -n openziti
```

访问 `port-audit`：

```bash
kubectl -n port-audit port-forward svc/k8s-port-audit 8080:8080
```

打开：

```text
http://127.0.0.1:8080
http://127.0.0.1:8080/ziti/
```
