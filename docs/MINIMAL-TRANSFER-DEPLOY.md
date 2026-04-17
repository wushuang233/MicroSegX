# 本机 `k3s` 最简交付文档

这份文档只保留给本机 `k3s` 参考。

如果你最终是为了普通 Kubernetes 集群服务，请把它当成：

- 本地联调
- 单机演示
- 本机离线验证

最终交付主线还是：

- [K8S-CONTAINERD-DELIVERY-MANUAL.md](./K8S-CONTAINERD-DELIVERY-MANUAL.md)

## 1. 在打包机生成一体化目录

```bash
cd /home/wushuang/MicroSegX
bash ops/microsegx-local/build-and-package.sh ops/full-release/full-release.env
```

打包目录在：

```text
artifacts/microsegx-local/${CORE_TAG}
```

把它打成一个包：

```bash
export CORE_TAG=<你的 core tag>
tar -C /home/wushuang/MicroSegX/artifacts/microsegx-local -czf microsegx-local-${CORE_TAG}.tar.gz ${CORE_TAG}
```

## 2. 发到目标机器后解压

```bash
mkdir -p /opt/microsegx-local
cd /opt/microsegx-local
tar -xzf microsegx-local-<CORE_TAG>.tar.gz
cd <CORE_TAG>
```

## 3. 先改 `MicroSegX` 的 core env

```bash
vi ./core/bundle/full-release.env
```

至少确认：

```text
BOOTSTRAP_PASSWORD=<首次登录密码>
CONTROLLER_PVC_ENABLED=true
CONTROLLER_PVC_STORAGE_CLASS=<本机 StorageClass>
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
```

## 4. 执行一体化部署

最直接的方式是显式传环境变量，不依赖模板文件里的占位绝对路径：

```bash
export FULL_RELEASE_ENV="$(pwd)/core/bundle/full-release.env"
export MICROSEGX_PORT_AUDIT_BASE_URL="http://k8s-port-audit.port-audit.svc.cluster.local:8080"
export STACK_LOCAL_RUNTIME=k3s
export STACK_CONTAINERD_NAMESPACE=k8s.io
```

```bash
bash ./deploy-local.sh
```

## 5. 让本机重启后仍然能找到当前镜像

这一步不要省：

```bash
bash ./setup-k3s-offline-auto-import.sh
```

## 6. 验证

```bash
kubectl get pods -n microsegx
kubectl get pods -n openziti
kubectl get pods -n port-audit
kubectl get pvc -n microsegx
```

如果只看最小结果：

- `microsegx` 四个核心 Pod 是 `Running`
- `openziti` controller/router 是 `Running`
- `port-audit` 是 `Running`
- `microsegx-data` 是 `Bound`
