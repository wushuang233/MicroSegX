# MicroSegX 本地 K8s 一体化部署说明

这份文档描述的是当前仓库里 `manager + k8s-node-surface(port-audit + Ziti)` 的一体化落地方式。

当前整体形态不是把所有能力硬塞进一个进程里，而是拆成两层：

- `manager`
  作为主控制台，承载统一导航、首页统计、`Port Exposure` 页面与 `Ziti Fabric` 页面。
- `k8s-node-surface`
  作为端口暴露与 OpenZiti 的业务后端，继续提供真实扫描、Service 暴露治理、Ziti controller/router/identity/policy 管理等能力。

现在 manager 已经通过后端代理把这套能力统一到以下入口：

- `/#/microsegx/port-exposure`
- `/#/microsegx/ziti`

同时 manager 后端会代理：

- `/microsegx/overview`
- `/microsegx/api/*`
- `/microsegx/ui/port-exposure/*`
- `/microsegx/ui/ziti/*`

## 0. 一层总入口

如果你不想手工记两套流程，现在仓库里已经补了 `MicroSegX` 总装配脚本：

- 打包：`ops/microsegx-local/build-and-package.sh`
- 本地集群部署：`ops/microsegx-local/deploy-local.sh`
- 变量示例：`ops/microsegx-local/microsegx-local.env.example`

推荐用法：

```bash
cd /home/wushuang/MicroSegX
FULL_RELEASE_ENV=/abs/path/to/ops/full-release/full-release.env \
  bash ops/microsegx-local/build-and-package.sh

FULL_RELEASE_ENV=/abs/path/to/ops/full-release/full-release.env \
  bash ops/microsegx-local/deploy-local.sh
```

这两条会把：

- manager/core 的 full-release
- port-audit + OpenZiti 的 stack bundle

收拢成一条 `MicroSegX` 交付链。

`build-and-package.sh` 还会把本次构建实际使用的 `full-release.env` 一起放进交付包里的 `core/bundle/full-release.env`，所以后续在交付目录里直接执行 `deploy-local.sh` 时，不需要再额外手抄一份 manager/core 环境变量文件。

## 1. 架构关系

本地 K8s 集群里，建议保持这几个组件：

- MicroSegX / manager 核心组件
- `k8s-port-audit` 服务
- `openziti` 相关 controller / router / cert-manager / trust-manager

manager 不直接内嵌 `port-audit` 代码，而是通过环境变量把目标后端地址指向：

```text
MICROSEGX_PORT_AUDIT_BASE_URL=http://k8s-port-audit.port-audit.svc.cluster.local:8080
```

这样做的好处是：

- manager 负责统一入口与运营视角
- port-audit 继续独立演进业务逻辑
- Ziti 的 controller/router/identity/policy 管理能力不需要在 manager 里再重复实现一套

## 2. 从空集群开始的推荐顺序

如果你的本地集群是空的，建议按下面顺序走：

1. 先部署 MicroSegX / manager 核心组件
2. 再部署 `k8s-node-surface` 的整套 `port-audit + openziti`
3. 最后给 manager 注入 `MICROSEGX_PORT_AUDIT_BASE_URL`

这样 manager 一起来就能直接接到 `Port Exposure` 与 `Ziti Fabric`

## 3. 部署 manager / core

### 3.1 只更新 manager UI 的场景

如果你已经有现成的 core 集群，只是重发 manager：

使用已有脚本：

```bash
cd /home/wushuang/MicroSegX
ENV_FILE=/abs/path/to/ui-only.env bash ops/ui-only/redeploy-ui-only.sh
```

这条链路会走：

- 构建 manager 镜像
- 同步 controller / enforcer / scanner / updater 镜像引用
- 执行 Helm upgrade

### 3.2 从空集群部署 core 的场景

如果你需要从头部署 manager/core：

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-and-package.sh /abs/path/to/full-release.env
```

然后把产物导入目标环境，再执行：

```bash
bash ops/full-release/deploy-core.sh /abs/path/to/full-release.env
```

这条链路会构建并部署：

- controller
- enforcer
- manager
- scanner

## 4. 给 manager 注入 MicroSegX 后端地址

Helm chart 已经支持 `manager.env.envs`，所以只需要额外加一个 overlay values。

示例文件见：

- [manager-microsegx.overlay.yaml.example](/home/wushuang/MicroSegX/ops/microsegx-local/manager-microsegx.overlay.yaml.example)

最小内容是：

```yaml
manager:
  env:
    envs:
      - name: MICROSEGX_PORT_AUDIT_BASE_URL
        value: http://k8s-port-audit.port-audit.svc.cluster.local:8080
```

如果你是 Helm upgrade，可以叠加这个 values：

```bash
helm upgrade --install microsegx microsegx-helm/charts/core \
  -n microsegx \
  -f /path/to/your/base-values.yaml \
  -f ops/microsegx-local/manager-microsegx.overlay.yaml.example
```

如果你用的是现有 `ops/full-release/deploy-core.sh`，就把这段内容并入你自己的 values 覆盖文件里。

## 5. 部署 port-audit + OpenZiti 整套

这一部分直接复用 `k8s-node-surface` 现成的 stack bundle。

### 5.1 重新生成 stack bundle

```bash
cd /home/wushuang/MicroSegX/k8s-node-surface
bash scripts/build-stack-image-bundle.sh
```

### 5.2 校验产物

```bash
cd /home/wushuang/MicroSegX/k8s-node-surface/dist/k8s-port-audit-stack-local-0.2.2
sha256sum -c SHA256SUMS
```

### 5.3 导入本地集群镜像

如果你是单机 `k3s`：

```bash
bash ops/microsegx-local/deploy-local.sh
```

如果你是普通 `containerd`：

```bash
sudo ctr -n k8s.io images import /home/wushuang/MicroSegX/k8s-node-surface/dist/k8s-port-audit-stack-local-0.2.2/k8s-port-audit-stack-0.2.2.tar
```

说明：

- 对当前这台本地 `k3s`，`MicroSegX` 的总装配脚本已经内置了一个一次性 `k3s-import-helper` Pod，会替代手工 `sudo k3s ctr` 把本地镜像导进 k3s 的 containerd。
- 所以在这台机器上，推荐直接使用 `ops/microsegx-local/deploy-local.sh`，不需要额外手工导 manager/core 或 port-audit stack 镜像。

### 5.4 安装整套 stack

```bash
kubectl apply -f /home/wushuang/MicroSegX/k8s-node-surface/dist/k8s-port-audit-stack-local-0.2.2/openziti-stack-installer-local.yaml
kubectl logs -n openziti-installer job/openziti-stack-installer -f
```

这一步会装：

- `cert-manager`
- `trust-manager`
- `ziti-controller`
- `ziti-router`
- `k8s-port-audit`
- `port-audit-ziti-host`

## 6. 验收

### 6.1 检查 port-audit / openziti

```bash
kubectl get pods -n openziti
kubectl get pods -n port-audit
```

### 6.2 检查 router 是否在线

```bash
kubectl -n openziti exec deploy/ziti-controller -- sh -lc '
  ziti edge login 127.0.0.1:1280 --yes \
    -u "$ZITI_ADMIN_USER" \
    -p "$ZITI_ADMIN_PASSWORD" \
    --ca "$ZITI_CTRL_PLANE_CA/ctrl-plane-cas.crt" >/dev/null &&
  ziti edge list edge-routers
'
```

验收标准至少包含：

- `ziti-controller` 为 `Running`
- `ziti-router` 为 `Running`
- `ziti edge list edge-routers` 能看到 `ONLINE true`

### 6.3 检查 manager 到 port-audit 的联动

manager 部署完成后，进入 Web 页面，确认：

- 侧栏出现 `MicroSegX`
- 子菜单出现 `Port Exposure`
- 子菜单出现 `Ziti Fabric`
- 首页 dashboard 出现 `Open ports` 卡片
- 首页 dashboard 出现 `Ziti fabric` 卡片
- `/#/microsegx/port-exposure` 能正常加载嵌入页
- `/#/microsegx/ziti` 能正常加载嵌入页

## 7. 访问路径建议

如果 manager 对外入口已经暴露：

- `/#/dashboard`
- `/#/microsegx/port-exposure`
- `/#/microsegx/ziti`

如果只是本机临时看 `k8s-port-audit` 原始页，也可以继续：

```bash
kubectl -n port-audit port-forward svc/k8s-port-audit 8080:8080
```

然后访问：

- `http://127.0.0.1:8080/`
- `http://127.0.0.1:8080/ziti/`

## 8. 关键环境变量

manager 侧新增：

- `MICROSEGX_PORT_AUDIT_BASE_URL`
  默认值是 `http://k8s-port-audit.port-audit.svc.cluster.local:8080`

port-audit 侧原有：

- `ZITI_DEFAULT_CONTROLLER_URL`
- `ZITI_DEFAULT_USERNAME`
- `ZITI_DEFAULT_PASSWORD`

如果 `port-audit` 已经预设了默认 Ziti controller 凭据，那么 manager 首页和 `Ziti Fabric` 页面就能显示更完整的 Fabric 摘要。

## 9. 现在这套的边界

当前一体化方式的设计目标是：

- 统一入口在 manager
- 业务能力继续由 `k8s-node-surface` 提供
- 打包和部署沿用现有成熟链路，不重造第三套镜像流程

所以现在的“完整 MicroSegX 本地 k8s 部署”，本质上是两段现有能力的组合：

- `manager/core` 用 `ops/full-release` 或 `ops/ui-only`
- `port-audit + openziti` 用 `k8s-node-surface/scripts/build-stack-image-bundle.sh`

这是当前最稳、最容易复现、也最不容易引入新坑的方案。
