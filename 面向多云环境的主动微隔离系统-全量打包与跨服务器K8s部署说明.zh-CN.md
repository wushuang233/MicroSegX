# 面向多云环境的主动微隔离系统：全量打包与跨服务器 K8s 部署说明

## 1. 这次交付的目标

这次不是继续做本地预览，而是把当前代码状态收拢成一套可以正式交付的发布链路，方便后续在另一台服务器上重新打包、导入镜像并部署到 Kubernetes 集群。

我把交付物放在：

- [ops/full-release/full-release.env.example](d:/vscode/nv/ops/full-release/full-release.env.example)
- [ops/full-release/build-and-package.sh](d:/vscode/nv/ops/full-release/build-and-package.sh)
- [ops/full-release/load-and-push.sh](d:/vscode/nv/ops/full-release/load-and-push.sh)
- [ops/full-release/deploy-core.sh](d:/vscode/nv/ops/full-release/deploy-core.sh)

这套脚本按“构建服务器”和“部署服务器”分工：

- 构建服务器负责把代码打成镜像，并导出离线包
- 部署服务器负责把离线包导入、推到你的私有镜像仓库，然后用 Helm 部署到集群

现在还支持另一种模式：

- 没有私有仓库时，直接把镜像导入 K8s 节点本地运行时，然后本地部署

## 2. 这套系统实际需要哪些镜像

### 2.1 我们当前可以自己从源码构建的镜像

这四个镜像已经有源码仓，可以自己重打：

- `controller`
- `enforcer`
- `manager`
- `scanner`

对应源码位置：

- [neuvector/package/Dockerfile.controller](d:/vscode/nv/neuvector/package/Dockerfile.controller)
- [neuvector/package/Dockerfile.enforcer](d:/vscode/nv/neuvector/package/Dockerfile.enforcer)
- [manager/package/Dockerfile](d:/vscode/nv/manager/package/Dockerfile)
- [scanner/package/Dockerfile](d:/vscode/nv/scanner/package/Dockerfile)

### 2.2 Helm 默认还会额外用到的镜像

如果你按 `core` chart 的默认能力部署，至少还会碰到：

- `updater`

如果后面你启用了附加能力，还会碰到：

- `registry-adapter`
- `compliance-config`

这里有个很关键的现实情况：

- 这三个镜像的源码不在当前 `nv` 四个仓里
- 所以我给脚本的处理方式是“镜像镜像化”，也就是从官方镜像拉下来，再改标签推到你自己的仓库

换句话说，当前工作区可以做到：

- `controller / enforcer / manager / scanner` 自己编译
- `updater / registry-adapter / compliance-config` 自己镜像仓托管，但不是自己编译源码

## 3. 推荐的正式发布方式

推荐你用下面这条链路，不建议直接把本地 Docker 镜像只导入某一台机器就结束：

1. 在一台 Linux 构建服务器上构建和整理镜像
2. 把镜像打成离线包
3. 把离线包拷到部署服务器
4. 在部署服务器上导入镜像并推送到你的私有仓库
5. 用 Helm 安装 `crd` chart 和 `core` chart

这样做的原因很简单：

- K8s 集群通常不是单节点
- 只把镜像导入某一台机器的本地 Docker，不足以让所有节点都能拉到镜像
- 用私有仓库最稳，升级和回滚也更可控

## 4. 脚本分别做什么

### 4.1 `build-and-package.sh`

作用：

- 构建 `controller / enforcer / manager / scanner`
- 按需镜像化 `updater / registry-adapter / compliance-config`
- 导出 `images-*.tar.gz`
- 生成镜像清单
- 把 Helm chart 和部署脚本一起打进 bundle 目录

产物默认会放到：

- `artifacts/full-release/<CORE_TAG>/`

### 4.2 `load-and-push.sh`

作用：

- 在部署服务器上 `docker load` 离线包
- 按镜像清单逐个 `docker push` 到你的私有镜像仓库

### 4.3 `load-local-images.sh`

作用：

- 没有私有仓库时，把离线包直接导入到目标节点的本地运行时
- 支持 `docker / containerd / nerdctl`
- 如果你的集群有多个节点，需要在每个节点都执行一次

### 4.4 `deploy-core.sh`

作用：

- 生成一份适配你环境的 `values.generated.yaml`
- 先装 `crd` chart
- 再装 `core` chart
- 最后输出 namespace 里的 Pod 状态

## 5. 你需要改的核心配置

先把 [ops/full-release/full-release.env.example](d:/vscode/nv/ops/full-release/full-release.env.example) 复制成 `full-release.env`，重点改这些值：

- `REGISTRY`
  你的私有仓库地址，例如 `harbor.example.com`
- `DEPLOY_MODE`
  有仓库时用 `registry`，没有仓库时改成 `local`
- `IMAGE_NAMESPACE`
  你的镜像命名空间，例如 `nv`
- `CORE_TAG`
  `controller / manager / enforcer` 统一版本号
- `SCANNER_TAG`
  `scanner` 的单独版本号
- `MANAGER_HOST`
  你访问 UI 的域名
- `INGRESS_CLASS`
  你的 ingress class，例如 `nginx`
- `MANAGER_SERVICE_TYPE`
  如果没有 ingress，可以改成 `NodePort` 或 `LoadBalancer`
- `BOOTSTRAP_PASSWORD`
  首次管理员密码
- `CONTROLLER_REPLICAS`
  实验环境建议先用 `1`
- `SCANNER_REPLICAS`
  实验环境建议先用 `1`
- `IMAGE_PULL_SECRET`
  如果私有仓库需要拉取密钥，填 secret 名称
- `LOCAL_RUNTIME`
  本地导入模式下使用的运行时，常见是 `containerd`
- `CONTAINERD_NAMESPACE`
  本地导入模式下 containerd 的 namespace，通常是 `k8s.io`

如果你的容器运行时 socket 不在默认位置，再填：

- `RUNTIME_PATH`

## 6. 一次完整发布怎么做

### 6.1 在构建服务器上

要求：

- Linux
- Docker / buildx
- 能访问外网下载基础镜像和依赖

执行顺序：

```bash
cd /path/to/nv/ops/full-release
cp full-release.env.example full-release.env
vi full-release.env
bash build-and-package.sh full-release.env
```

完成后你会拿到：

- `images-<CORE_TAG>.tar.gz`
- `bundle/image-list.txt`
- `bundle/charts/core`
- `bundle/charts/crd`
- `bundle/deploy-core.sh`
- `bundle/load-and-push.sh`

### 6.2 拷到部署服务器

把整个发布目录拷过去，例如：

```bash
scp -r /path/to/nv/artifacts/full-release/2026.04.05-r1 user@deploy-host:/srv/nv-release/
```

### 6.3 在部署服务器上导入并推仓

如果你有私有仓库：

要求：

- Docker
- 能访问你的私有镜像仓库

执行：

```bash
cd /srv/nv-release/2026.04.05-r1/bundle
cp full-release.env.example full-release.env
vi full-release.env
bash load-and-push.sh full-release.env
```

如果你没有私有仓库，改成：

```bash
cd /srv/nv-release/2026.04.05-r1/bundle
cp full-release.env.example full-release.env
vi full-release.env
# 把 DEPLOY_MODE 改成 local
# 把 LOCAL_RUNTIME 改成 docker / containerd / nerdctl 中实际值
# 保持 MIRROR_UPDATER=true
bash load-local-images.sh full-release.env
```

如果集群是多节点：

- 需要把同一个离线包拷到每个节点
- 在每个节点都执行一次 `load-local-images.sh`

如果集群是单节点：

- 只需要在那一台服务器执行一次

### 6.4 在部署服务器上 Helm 部署

要求：

- `kubectl`
- `helm`
- 能访问目标 K8s 集群

执行：

```bash
cd /srv/nv-release/2026.04.05-r1/bundle
bash deploy-core.sh full-release.env
```

本地模式下，`deploy-core.sh` 会自动把相关组件的 `imagePullPolicy` 改成 `Never`，避免 Kubernetes 去拉一个根本不存在的远端仓库。

## 7. 这套 Helm 部署里几个最重要的约束

### 7.1 `controller / manager / enforcer` 共用全局 `tag`

这不是我的约定，而是 chart 本身的设计。相关模板在：

- [manager-deployment.yaml](d:/vscode/nv/neuvector-helm/charts/core/templates/manager-deployment.yaml)
- [enforcer-daemonset.yaml](d:/vscode/nv/neuvector-helm/charts/core/templates/enforcer-daemonset.yaml)
- [controller-deployment.yaml](d:/vscode/nv/neuvector-helm/charts/core/templates/controller-deployment.yaml)

所以你后续只改了 UI，也最好仍然给这三个镜像出同一个 `CORE_TAG`。

### 7.2 `scanner` 单独用自己的 tag

`scanner` 不是走全局 `tag`，而是走 `cve.scanner.image.tag`。模板在：

- [scanner-deployment.yaml](d:/vscode/nv/neuvector-helm/charts/core/templates/scanner-deployment.yaml)

所以脚本里我把它单独拆成了 `SCANNER_TAG`。

### 7.3 `updater` 默认启用

即使你没有改 `updater` 源码，正式部署时也最好把它一起镜像化到你的私有仓库，否则线上还是会依赖外部仓库。模板在：

- [updater-cronjob.yaml](d:/vscode/nv/neuvector-helm/charts/core/templates/updater-cronjob.yaml)

这套脚本也考虑了两种情况：

- `MIRROR_UPDATER=true`
  `updater` 也进你的私有仓库，这是推荐方式
- `MIRROR_UPDATER=false`
  `updater` 继续从官方仓库拉取，但这意味着你的集群仍然依赖外网

### 7.4 `enforcer` 是特权组件

它不是普通 Deployment，而是 `DaemonSet`，而且默认需要特权能力、主机 PID 和宿主机挂载。模板在：

- [enforcer-daemonset.yaml](d:/vscode/nv/neuvector-helm/charts/core/templates/enforcer-daemonset.yaml)

所以如果你的集群有很严格的 Pod Security 或安全策略，需要提前确认允许它运行。

## 8. 关于 CRD chart

我在 `deploy-core.sh` 里先安装 `crd` chart，再安装 `core` chart，同时在生成的 values 里把：

- `crdwebhook.enabled: false`

这样做是为了避免重复下发 CRD 定义。CRD chart 位置在：

- [neuvector-helm/charts/crd](d:/vscode/nv/neuvector-helm/charts/crd)

核心 chart 位置在：

- [neuvector-helm/charts/core](d:/vscode/nv/neuvector-helm/charts/core)

## 9. 你后续二开之后怎么重复发版

后续每一轮代码改动，建议固定走这个节奏：

1. 改代码
2. 更新 `CORE_TAG` 和需要单独更新的 `SCANNER_TAG`
3. 重新跑 `build-and-package.sh`
4. 把新包发到部署服务器
5. 重新跑 `load-and-push.sh`
6. 再跑 `deploy-core.sh`

这样你后面做：

- UI 大改
- 控制器逻辑改动
- scanner 规则或扫描逻辑改动

都会有统一出口，不会每次重新手拼命令。

## 10. 这次我已经替你踩清楚的边界

- 你当前工作区能自己编译的，是 `controller / enforcer / manager / scanner`
- `updater / registry-adapter / compliance-config` 需要走镜像镜像化，不是从当前工作区源码编译
- 当前 Windows 环境不适合真实跑完整 Linux 镜像链，但脚本已经按 Linux 发布服务器的实际流程写好了
- 这套脚本默认走“私有仓库 + Helm”的正规路径，不走只导入单机 Docker 的临时路径
- 如果你没有私有仓库，这套脚本现在也支持“本地导入 + 本地部署”

## 11. 最后给你的建议

如果你的目标是“能稳定部署到另一台服务器上的 K8s 集群”，最稳的顺序是：

1. 先用一台 Linux 机器专门做构建
2. 私有仓库地址先定下来
3. 先按实验规格部署一版
4. 等你确认 UI 和功能改动稳定，再把 `controller` 副本数、scanner 副本数、证书和资源限制往生产标准收

这样后面的每轮二开都会轻很多。
