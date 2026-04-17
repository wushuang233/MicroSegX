# 本机 `k3s` 导入与部署文档

这份文档只保留给本机 `k3s` 使用，定位是：

- 开发机联调
- 单机验证
- 本地离线排障

如果你最终目标是普通 Kubernetes 集群，请优先看：

- [K8S-CONTAINERD-DELIVERY-MANUAL.md](./K8S-CONTAINERD-DELIVERY-MANUAL.md)

## 1. 适用范围

这份文档只覆盖 `MicroSegX core`：

- `manager`
- `controller`
- `enforcer`
- `scanner`
- `updater`

不覆盖：

- 普通 Kubernetes 集群多节点交付
- 私有镜像仓库推送
- `OpenZiti + Port-Audit` 一体化安装

## 2. 部署前检查

### 2.1 看节点是否处于压力状态

```bash
df -h /
kubectl get node wushuang-vmware-virtual-platform -o jsonpath='{range .status.conditions[*]}{.type}={.status}:{.reason}{"\n"}{end}'
```

要求至少满足：

- `DiskPressure=False`
- 根分区还有足够空闲空间

### 2.2 确认持久化类存在

```bash
kubectl get storageclass
```

至少要知道你准备给 `controller` 用哪个 `StorageClass`。

### 2.3 确认 bootstrap 密码已经设置

```bash
grep '^BOOTSTRAP_PASSWORD=' /home/wushuang/MicroSegX/ops/full-release/full-release.env
```

如果为空，先补上。

### 2.4 reset 前先备份 `microsegx-store-secret`

```bash
kubectl get secret microsegx-store-secret -n microsegx -o yaml > microsegx-store-secret-backup.yaml
```

如果后续做了 reset、重装或数据库重建，这个 Secret 可能被覆盖或重新生成。

## 3. 需要重装时，先清理旧 release

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/reset-microsegx.sh ops/full-release/full-release.env
```

不要只删 namespace。
旧的 CRD、ClusterRole、ClusterRoleBinding 和 webhook 也要一起清掉。

## 4. 导入本地镜像

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/load-local-images.sh ops/full-release/full-release.env
```

这一步会把 `MicroSegX core` 镜像导入到当前 `k3s` 节点运行时。

## 5. 部署 `MicroSegX core`

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/deploy-core.sh ops/full-release/full-release.env
```

默认建议保持：

```text
CONTROLLER_HOST_NETWORK=false
ENFORCER_HOST_NETWORK=false
CONTROLLER_API_SERVICE_TYPE=ClusterIP
CONTROLLER_PVC_ENABLED=true
CONTROLLER_PVC_ACCESS_MODE=ReadWriteOnce
CONTROLLER_STRATEGY_TYPE=Recreate
```

## 6. 让本机 `k3s` 具备“重启后仍能找到镜像”的能力

部署完成后，执行：

```bash
cd /home/wushuang/MicroSegX
bash ops/microsegx-local/setup-k3s-offline-auto-import.sh
```

这一步会做两件事：

- 把当前实际在用的镜像归档写入 `/var/lib/rancher/k3s/agent/images`
- 立刻把这些镜像重新导入到当前 `k3s/containerd`

它是本机离线模式防止重启后再次出现 `ErrImageNeverPull` 的关键步骤。

## 7. 部署完成后的验证

### 7.1 Pod

```bash
kubectl get pods -n microsegx -o wide
```

期待至少看到：

- `microsegx-controller-pod` `Running`
- `microsegx-manager-pod` `Running`
- `microsegx-enforcer-pod` `Running`
- `microsegx-scanner-pod` `Running`

### 7.2 PVC

```bash
kubectl get pvc -n microsegx -o wide
```

期待：

- `microsegx-data` 为 `Bound`

### 7.3 controller 持久化关键项

```bash
kubectl describe pod -n microsegx -l app=microsegx-controller-pod
```

重点看：

- `CTRL_PERSIST_CONFIG=1`
- `/var/microsegx`
- `ClaimName: microsegx-data`

### 7.4 本机自动导入目录

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: k3s-images-check
  namespace: default
spec:
  restartPolicy: Never
  containers:
    - name: checker
      image: busybox:1.36
      command: ["sh", "-lc", "ls -lh /hostfs/var/lib/rancher/k3s/agent/images && sleep 5"]
      securityContext:
        privileged: true
      volumeMounts:
        - name: host-root
          mountPath: /hostfs
  volumes:
    - name: host-root
      hostPath:
        path: /
        type: Directory
EOF
kubectl logs -n default pod/k3s-images-check
kubectl delete pod k3s-images-check -n default --ignore-not-found
```

## 8. 本机 `k3s` 的磁盘驱逐阈值参考

如果你希望这台机器在磁盘剩余 `5%` 才开始因磁盘压力驱逐 Pod，可以把 `k3s` 配成：

```yaml
resolv-conf: "/etc/rancher/k3s/resolv.conf"
kubelet-arg:
  - "eviction-hard=nodefs.available<5%,imagefs.available<5%"
```

文件位置：

```text
/etc/rancher/k3s/config.yaml
```

改完后需要重启 `k3s`：

```bash
sudo systemctl restart k3s
```

## 9. 本机 `k3s` 最常见的排障点

### 9.1 重启后 `ErrImageNeverPull`

优先检查：

- `/var/lib/rancher/k3s/agent/images` 是否存在
- 有没有执行过 `setup-k3s-offline-auto-import.sh`

### 9.2 controller / enforcer 明明导入过镜像却起不来

通常不是“完全没导入”，而是：

- 当前 Deployment/DaemonSet 用的是新的精确 tag
- 但自动导入目录里还是旧 bundle 自带的 tag

先看实际镜像：

```bash
kubectl get deploy microsegx-controller-pod -n microsegx -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
kubectl get ds microsegx-enforcer-pod -n microsegx -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

再重新执行：

```bash
bash ops/microsegx-local/setup-k3s-offline-auto-import.sh
```

### 9.3 历史坏 Pod 太多

这些历史壳子可以直接清：

```bash
kubectl get pods -A | awk 'NR>1 && ($4=="Evicted" || $4=="Error" || $4=="Completed" || $4=="ContainerStatusUnknown" || $4=="Init:ContainerStatusUnknown") {print "kubectl delete pod -n "$1" "$2}' | sh
```
