# MicroSegX 导入与部署文档

这份文档覆盖这几件事：

- 如何彻底清理旧的 `microsegx` release
- 如何把镜像导入 k3s
- 如何部署 `manager / controller / enforcer / scanner / updater`
- 如何验证 controller 持久化真的生效

默认约定：

- 首次部署前必须在 env 文件里显式设置 `BOOTSTRAP_PASSWORD`
- 不要依赖 controller 的默认 `admin/admin` 回退路径
- 现在的 `deploy-core.sh` 会在 fresh install 且未设置 `BOOTSTRAP_PASSWORD` 时直接拒绝部署

## 1. 先记住持久化结论

`controller` 持久化不是可选优化，而是必须项。

原因很简单：

- 用户信息
- 管理员密码
- 系统配置
- 一部分策略与恢复数据

都要靠 `/var/microsegx` 挂载到持久化卷之后才能在 Pod 重建后恢复。

正确状态必须同时满足：

- `PVC` 已经 `Bound`
- `controller` 容器内有 `/var/microsegx`
- 环境变量 `CTRL_PERSIST_CONFIG=1`

如果这三件事缺一件，重启后重新要求设密码基本就是必然现象，不是偶发。

## 2. 首次部署前预检查

### 2.1 检查节点磁盘

单机 k3s 上一定要先看：

```bash
df -h /
kubectl describe node
```

如果节点有：

- `DiskPressure=True`
- `node.kubernetes.io/disk-pressure:NoSchedule`

先清磁盘再部署。

这次实测里，k3s 的 image GC 阈值是：

- `highThreshold=85`
- `lowThreshold=80`

根分区最好压到 `80%` 以下再导入和部署。

### 2.2 检查 `local-path` 是否存在

单机 k3s 默认持久化方案依赖：

```bash
kubectl get storageclass local-path
```

### 2.3 检查 bundle 是否完整

```bash
find artifacts/full-release/${CORE_TAG}/bundle -maxdepth 1 -type f | sort
```

至少应该看到：

- `images-${CORE_TAG}.tar.gz`
- `deploy-core.sh`
- `load-local-images.sh`
- `reset-microsegx.sh`
- `full-release.env`

### 2.4 检查初始密码是否已设置

```bash
grep '^BOOTSTRAP_PASSWORD=' artifacts/full-release/${CORE_TAG}/bundle/full-release.env
```

要求：

- 不能是空值
- 这是 fresh install 时 controller 初始管理员密码的唯一安全入口

## 3. 重装前不要只删 namespace

只删：

```bash
kubectl delete namespace microsegx
```

不够。

原因是旧 release 还会留下 cluster-scoped 资源：

- CRD
- ClusterRole
- ClusterRoleBinding
- Webhook 配置

这些资源会在下一次 Helm 安装时触发 ownership 冲突。

正确做法是直接运行：

```bash
bash artifacts/full-release/${CORE_TAG}/bundle/reset-microsegx.sh artifacts/full-release/${CORE_TAG}/bundle/full-release.env
```

源码目录下也有同名脚本：

```bash
bash ops/full-release/reset-microsegx.sh ops/full-release/full-release.env
```

## 4. 本地 k3s 导入镜像

```bash
cd /home/wushuang/MicroSegX
bash artifacts/full-release/${CORE_TAG}/bundle/load-local-images.sh artifacts/full-release/${CORE_TAG}/bundle/full-release.env
```

现在的导入脚本有两个重要改动：

- 如果脚本是从 `bundle/` 目录执行，会自动到上一层 release 根目录找 `images-*.tar.gz`
- 如果旧的 `k3s-import-helper` 已经是 `Completed/Failed`，会先删掉再重建
- helper Pod 会自动固定到当前节点，避免多节点时漂到别的节点上读不到本地镜像包

如果自动匹配不到当前节点，可以在 env 文件里显式指定：

```bash
K3S_IMPORT_HELPER_NODE_NAME=<node-name>
```

或者：

```bash
K3S_IMPORT_HELPER_NODE_IP=<node-internal-ip>
```

## 5. 部署

```bash
cd /home/wushuang/MicroSegX
bash artifacts/full-release/${CORE_TAG}/bundle/deploy-core.sh artifacts/full-release/${CORE_TAG}/bundle/full-release.env
```

对于单机 k3s，脚本现在会自动渲染出这组 controller 持久化参数：

- `controller.pvc.enabled=true`
- `controller.pvc.accessModes=ReadWriteOnce`
- `controller.pvc.storageClass=local-path`
- `controller.strategy.type=Recreate`

这组组合是单机 k3s 下验证通过的正确配置。

## 6. 首次登录

如果你在 env 文件里设置了 `BOOTSTRAP_PASSWORD`，可以这样取回 bootstrap 密码：

```bash
kubectl get secret -n microsegx microsegx-bootstrap-secret -o go-template='{{.data.bootstrapPassword|base64decode}}{{"\n"}}'
```

注意三件事：

1. 首次登录通常会要求你立刻改密码
2. `microsegx-bootstrap-secret` 只代表“初始密码”，不是后续的真实密码源
3. 如果 fresh install 时没有设置 `BOOTSTRAP_PASSWORD`，现在脚本会直接拦住部署，不再允许走到 controller fail-close

也就是说：

- 你改过 admin 密码以后，真正生效的是持久化在 controller PVC 里的用户配置
- 重启后应该继续使用你改过的新密码
- secret 里的 bootstrap 值不会跟着更新

如果你重启后又只能用 bootstrap 密码，基本就说明 controller 持久化没有生效。

## 7. 部署完成后的最小验证集

### 7.1 看 Pod

```bash
kubectl get pods -n microsegx -o wide
```

期待结果：

- `controller` 1/1 Running
- `manager` 1/1 Running
- `enforcer` 1/1 Running
- `scanner` 全部 Running

### 7.2 看 PVC

```bash
kubectl get pvc,pv -n microsegx -o wide
```

期待结果：

- `microsegx-data` 为 `Bound`
- `accessModes` 为 `RWO`
- `storageClass` 为 `local-path`

### 7.3 看 controller 持久化开关

```bash
kubectl describe pod -n microsegx -l app=microsegx-controller-pod
```

重点看：

- `CTRL_PERSIST_CONFIG=1`
- `/var/microsegx`
- `ClaimName: microsegx-data`

### 7.4 看 enforcer 是否真正入群

```bash
kubectl exec -n microsegx ds/microsegx-enforcer-pod -- consul members -http-addr=127.0.0.1:8501
```

期待结果里至少有：

- `...-server`
- `...-client`

### 7.5 看 scanner 是否加载真实漏洞库

```bash
kubectl logs deployment/microsegx-scanner-pod -n microsegx --tail=120
```

期待看到：

- `common.LoadCveDb: Expand new DB`

## 8. 持久化回归验证

推荐每次新环境都做一次：

### 8.1 先改一次 admin 密码

controller REST 入口是：

```bash
https://<controller-host-or-ip>:10443/v1/auth
```

首次改密可以直接用：

```json
{
  "password": {
    "username": "admin",
    "password": "<bootstrap-password>",
    "new_password": "<new-password>"
  }
}
```

### 8.2 看备份文件是否落盘

```bash
kubectl exec -n microsegx deploy/microsegx-controller-pod -- ls /var/microsegx/config/backup
kubectl exec -n microsegx deploy/microsegx-controller-pod -- stat /var/microsegx/config/backup/user.backup
```

### 8.3 删除 controller Pod

```bash
kubectl delete pod -n microsegx -l app=microsegx-controller-pod
kubectl get pods -n microsegx -l app=microsegx-controller-pod -w
```

### 8.4 看恢复日志

```bash
kubectl logs deployment/microsegx-controller-pod -n microsegx --tail=120
```

这次实测里，重启后出现了关键标志：

- `defAdminRestored=true`

这说明管理员状态是从持久化数据恢复的，不是重新初始化。

### 8.5 用新旧密码分别验证

预期应该是：

- 新密码登录成功
- 旧 bootstrap 密码返回 401

如果是这样，controller 持久化就算验证通过了。

### 8.6 看 enforcer 是否自动恢复入群

controller 重启后，不需要手工 `consul join`，但要对单机 `Recreate` 的表现有正确预期。

执行：

```bash
kubectl logs daemonset/microsegx-enforcer-pod -n microsegx --tail=120
kubectl exec -n microsegx ds/microsegx-enforcer-pod -- consul members -http-addr=127.0.0.1:8501
```

预期应该是：

- 如果 controller 停机窗口较短，enforcer 会在一个检查周期内自动恢复
- 默认检查周期约 `20s`
- 如果 controller 停机窗口较长，enforcer 可能会被 kubelet 拉起一次，然后在 controller 恢复后自动重新入群
- `consul members` 里能再次看到 `...-server` 和 `...-client`
- 恢复后不应该再持续刷 `No known Consul servers`

这里要注意区分：

- “需要手工 `consul join`” 说明自动恢复逻辑坏了
- “controller 单副本重启期间 enforcer 短暂重启一次” 说明 control-plane 空窗较长，但恢复链路仍然是自动的

## 9. 这次实测确认过的坑

### 9.1 只删 namespace 会留下 CRD/RBAC 残留

现象：

- Helm 安装 `microsegx-crd` 报 ownership 冲突

处理：

- 用 `reset-microsegx.sh`

### 9.2 k3s 节点 `DiskPressure`

现象：

- `k3s-import-helper` 长时间 Pending
- 新 Pod 无法调度

处理：

- 先释放磁盘
- 再确认 node taint 清掉

### 9.3 scanner 数据库是 LFS 指针

现象：

- scanner 启动失败
- CVE DB 解析报错

处理：

- 先跑 `prepare-scanner-db.sh`

### 9.4 controller 不持久化时的典型症状

现象：

- controller 重建后重新要求改 admin 密码
- `/var/microsegx/config/backup` 没内容
- Pod 里没有 `CTRL_PERSIST_CONFIG=1`

处理：

- 开 PVC
- 单机 k3s 用 `ReadWriteOnce + local-path + Recreate`

## 10. 当前已验证的单机 k3s 事实

在 2026-04-08 的这次实测里，下面这些已经实际验证通过：

- `manager / controller / enforcer / scanner` 全部成功启动
- `enforcer` 已加入 controller 的 Consul server
- controller 重启后，enforcer 不再需要手工 `consul join`
- 单 controller 的 `Recreate` 重启窗口里，enforcer 可能短暂重启一次后自动恢复
- `scanner` 已成功加载真实 CVE DB
- `microsegx-data` PVC 已 `Bound`
- `controller` 已挂载 `/var/microsegx`
- admin 改密后，删除 controller Pod，再次启动仍能用新密码登录
- 旧 bootstrap 密码在 controller 重启后返回 `401 Authentication failed`
