# MicroSegX 文档入口

文档基线更新时间：`2026-04-17`

从现在开始，文档主线按“最终交付到普通 Kubernetes 集群”来组织。本机 `k3s` 只作为打包、联调和排障环境，不再作为主交付路径。

## 1. 推荐阅读顺序

### 1.1 最终要部署到普通 Kubernetes 集群

先读：

- [打包文档](./PACKAGING.md)
- [Kubernetes `ctr/containerd` 离线交付主手册](./K8S-CONTAINERD-DELIVERY-MANUAL.md)

如果你是负责持续改代码并重新出包的本地 agent，再补读：

- [打包执行手册（给本地 Agent）](./PACKAGING-AGENT-EXECUTION.zh-CN.md)

如果你只想看最短命令版，再看：

- [普通 Kubernetes 集群最简交付文档](./MINIMAL-TRANSFER-DEPLOY-K8S.md)

### 1.2 目标集群走私有镜像仓库

这条路径仍然可用，但现在只作为补充方案：

- [Kubernetes 仓库拉取交付手册](./K8S-DELIVERY-MANUAL.md)

### 1.3 只是在本机 `k3s` 上联调或排障

- [本机 `k3s` 导入与部署文档](./IMPORT-DEPLOYMENT.md)
- [本机 `k3s` 最简交付文档](./MINIMAL-TRANSFER-DEPLOY.md)

### 1.4 只改 `manager` 前端页面

- [前端页面修改与重部署手册](./FRONTEND-CHANGE-WORKFLOW.zh-CN.md)

## 2. 当前文档的几个统一结论

- `controller` 持久化必须开启。
  至少要保证 `PVC + /var/microsegx + CTRL_PERSIST_CONFIG=1` 同时存在。

- 重新安装或 reset 前，先备份 `microsegx-store-secret`。
  推荐命令：

```bash
kubectl get secret microsegx-store-secret -n microsegx -o yaml > microsegx-store-secret-backup.yaml
```

- 如果你在本机 `k3s` 使用本地离线镜像，部署完成后要执行：

```bash
bash ops/microsegx-local/setup-k3s-offline-auto-import.sh
```

这一步的作用是把当前实际在用的镜像归档落到 `/var/lib/rancher/k3s/agent/images`，避免虚拟机重启后再次出现 `ErrImageNeverPull`。

- 如果你后续又单独重打了 `manager`、`controller` 或 `enforcer` 的镜像，不要只更新 Deployment。
  对最终要交付到 Kubernetes 集群的环境，应该重新生成离线交付包，或者至少把“当前精确 tag”的镜像重新导入到每个目标节点。

## 3. 文档边界

- `PACKAGING.md`
  只讲如何从源码树产出交付包。

- `K8S-CONTAINERD-DELIVERY-MANUAL.md`
  是当前“普通 Kubernetes 集群离线交付”的主手册。

- `MINIMAL-TRANSFER-DEPLOY-K8S.md`
  是主手册的最短命令版。

- `IMPORT-DEPLOYMENT.md`
  只保留给本机 `k3s` 参考，不再作为最终生产交付手册。

- `K8S-DELIVERY-MANUAL.md`
  只保留给“节点从私有仓库拉镜像”的场景。
