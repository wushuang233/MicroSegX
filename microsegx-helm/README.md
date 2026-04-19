# microsegx-helm

`microsegx-helm` 目录保存 `MicroSegX` 相关 Helm Chart 模板，供本仓库的离线打包和集群部署流程使用。

## 目录说明

- `charts/core`
  核心组件 chart，覆盖 `manager`、`controller`、`enforcer`、`scanner` 等主要工作负载。

- `charts/crd`
  先行安装的 CRD chart。

- `charts/monitor`
  监控相关 chart。

- `values-local.yaml`
  本地或特定环境覆盖值示例。

- `scripts`
  版本和 chart 维护脚本。

- `test`
  chart 渲染与行为测试。

## 常用流程

渲染 core chart：

```bash
helm template microsegx charts/core -n microsegx -f values-local.yaml
```

安装或升级 core chart：

```bash
helm upgrade --install microsegx charts/core -n microsegx --create-namespace -f values-local.yaml
```

单独安装 CRD：

```bash
helm upgrade --install microsegx-crd charts/crd -n microsegx --create-namespace
```

## 说明

- 这里的 chart 是当前仓库源码和离线交付流程的一部分，不再按上游公开 Helm 仓库说明维护。
- 最终交付仍以仓库根目录 `ops/full-release` 脚本和 `../docs/` 文档为准。
- 如果是普通 Kubernetes 集群离线 `ctr/containerd` 交付，请优先看 `../docs/K8S-CONTAINERD-DELIVERY-MANUAL.md`。
