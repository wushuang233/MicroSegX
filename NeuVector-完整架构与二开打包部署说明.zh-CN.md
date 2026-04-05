# NeuVector 三仓完整架构与二次开发打包部署说明

本文基于当前本地工作区整理，时间点为 2026-04-04。目标不是解释每个参数，而是帮我们后续二改时快速回答 4 个问题：

1. 这个系统到底由哪些仓库组成。
2. 每一部分代码大概在什么地方。
3. 我们改完代码后，应该重打哪些镜像。
4. 怎么把这些镜像部署到你自己的 Kubernetes 集群里。

## 1. 先说结论

当前 `nv` 目录下的结构已经比较适合后续长期二开：

```text
nv/
├─ neuvector/        # controller + enforcer + 共享库 + upgrader
├─ manager/          # 管理界面 UI + manager 服务端
├─ scanner/          # 漏洞扫描器
└─ neuvector-helm/   # 官方 Helm Chart
```

可以把它理解成 4 个层次：

1. `neuvector/` 是核心控制面和节点执行面。
2. `manager/` 是管理后台和页面入口。
3. `scanner/` 是漏洞扫描能力。
4. `neuvector-helm/` 是把这些组件落到 K8s 的部署层。

后续二改时最重要的判断原则只有一句话：

- 改哪一层，就重打哪一层的镜像；如果改的是共享协议或共享类型，就把受影响的上下游一起重打。

## 2. 完整架构怎么理解

从运行关系上看，NeuVector 不是一个“前后端单仓项目”，而是一组协同工作的组件。

```text
浏览器
  |
  v
Manager(UI + Manager 服务)
  |
  v
Controller(REST API / 策略 / K8s 集成 / 集群协调)
  | \
  |  \
  |   +--> Scanner(镜像/漏洞扫描)
  |
  +------> Enforcer(每个节点上的执行与采集)

Helm Chart 负责把这些组件组合成 K8s 部署
Upgrader 负责内部证书轮换与升级辅助
```

再换成“功能视角”会更容易记：

| 组件 | 主要职责 | 部署形态 |
| --- | --- | --- |
| Controller | 系统核心控制面，提供 API、保存状态、分发策略、管理扫描、对接 K8s | `Deployment` |
| Enforcer | 每个节点上的执行面，负责运行时观察、策略执行、文件/进程/网络相关采集 | `DaemonSet` |
| Manager | 管理后台，既包含前端页面，也包含一个和 controller 对接的服务端 | `Deployment` |
| Scanner | 负责镜像和漏洞扫描，也会和 controller、enforcer 协同工作 | `Deployment` |
| Upgrader | 负责内部证书轮转、升级过程中的作业编排 | `Job` / `CronJob` 辅助 |
| Helm Chart | 负责把上述组件用一套 values 部署到 K8s | Helm |

## 3. 各仓库分别负责什么

### 3.1 `neuvector/`

这个仓库不是完整产品的全部源码，它主要承载：

- controller
- enforcer
- 共享 Go 包
- upgrader
- 打包脚本和镜像构建逻辑

如果你把它当成“后端主仓”是对的，但它并不包含真正的 Web 前端源码。

### 3.2 `manager/`

这个仓库不是纯前端仓，它其实是两层合在一起：

- Angular 前端页面
- Scala/Pekko 的 manager 服务端

也就是说，用户在浏览器里看到的页面来自这里，但页面背后还有一个 manager 服务负责转发、聚合和调用 controller 的 REST API。

### 3.3 `scanner/`

这个仓库负责漏洞扫描本身，包括：

- scanner 主进程
- 扫描服务 gRPC 处理
- CVE 数据相关逻辑
- 检测器和扫描工具链
- 独立扫描/任务模式

### 3.4 `neuvector-helm/`

这个仓库不是业务源码仓，而是部署仓。后续把你们自己的镜像部署到 K8s，最推荐的入口就是它，而不是手写一堆零散 YAML。

它的意义是：

- 统一声明 controller / enforcer / manager / scanner 怎么部署
- 统一设置镜像仓库、tag、Ingress、证书、运行时 socket、K8s 兼容参数
- 后续升级时可重复、可版本化

## 4. 代码位置导航

这一节是后面二改时最有用的部分。

### 4.1 `neuvector/` 里的关键目录

| 位置 | 作用 |
| --- | --- |
| `controller/` | controller 主体代码 |
| `controller/rest/` | REST API 入口和接口处理 |
| `controller/api/apis.yaml` | 对外 API 说明 |
| `controller/cache/` | controller 内部缓存与状态组织 |
| `controller/kv/` | 集群状态、KV、持久化相关 |
| `controller/resource/` | K8s 资源相关逻辑 |
| `controller/scan/` | 扫描编排相关 |
| `controller/rpc/` | 和其他组件的 RPC/gRPC 协同 |
| `controller/nvk8sapi/` | NeuVector 自定义 K8s API / CRD 相关 |
| `controller/opa/` | OPA 相关逻辑 |
| `agent/` | enforcer 主体代码 |
| `agent/probe/` | 进程、网络、系统观察相关 |
| `agent/policy/` | 执行和下发后的策略逻辑 |
| `agent/resource/` | 节点/容器资源处理 |
| `agent/workerlet/` | workerlet、辅助任务 |
| `dp/` | 数据面和底层 C/C++ 相关模块 |
| `share/` | controller / enforcer / scanner 共享的类型和工具 |
| `upgrader/` | 内部证书升级与轮换 |
| `monitor/` | 多个镜像里的启动包装器 |
| `package/` | 当前主构建链路和 Dockerfile |
| `scripts/` `templates/` | 容器运行辅助脚本、模板文件 |

这部分可以再进一步理解成：

- 想改 controller 的业务接口或后端逻辑，优先看 `controller/`
- 想改节点侧行为，优先看 `agent/` 和 `dp/`
- 想改共享协议、共享结构、公共工具，优先看 `share/`
- 想改打包方式，优先看 `package/`

### 4.2 `manager/` 里的关键目录

| 位置 | 作用 |
| --- | --- |
| `admin/webapp/websrc/` | Angular 页面源码，前端页面主要在这里改 |
| `admin/src/main/scala/com/neu/api/` | manager 自己暴露的 API 层 |
| `admin/src/main/scala/com/neu/service/` | manager 业务服务层 |
| `admin/src/main/scala/com/neu/client/` | manager 调 controller 的客户端 |
| `admin/src/main/scala/com/neu/web/` | 静态资源和 Web 路由处理 |
| `admin/src/main/scala/com/neu/core/` | manager 启动和 HTTP/HTTPS 服务 |
| `common/` | manager 公共模块 |
| `cli/` | CLI 与脚本工具 |
| `package/` | manager 镜像构建逻辑 |

对 manager 可以直接这样理解：

- 改页面、交互、前端组件：`admin/webapp/websrc/`
- 改 manager 到 controller 的接口适配：`admin/src/main/scala/com/neu/client/`
- 改 manager 服务端业务：`admin/src/main/scala/com/neu/service/`
- 改 manager 对外接口：`admin/src/main/scala/com/neu/api/`

### 4.3 `scanner/` 里的关键目录

| 位置 | 作用 |
| --- | --- |
| `scanner.go` | scanner 主入口 |
| `server.go` | gRPC 扫描服务，和 controller / enforcer 协同 |
| `standalone.go` | 独立扫描模式 |
| `task/` | scannerTask 辅助任务 |
| `cvetools/` | 扫描核心工具链 |
| `detectors/` | 特征检测、组件识别 |
| `common/` | scanner 公共逻辑 |
| `data/` | CVE 数据文件 |
| `monitor/` | scanner 启动包装器 |
| `package/` | scanner 镜像构建逻辑 |

对 scanner 最实用的判断是：

- 改扫描能力本身，看 `cvetools/`、`detectors/`
- 改 scanner 与 controller/enforcer 的协作，看 `scanner.go`、`server.go`
- 改扫描任务模式，看 `task/`

### 4.4 `neuvector-helm/` 里的关键目录

| 位置 | 作用 |
| --- | --- |
| `charts/core/values.yaml` | 主要部署参数入口 |
| `charts/core/templates/controller-deployment.yaml` | controller 部署模板 |
| `charts/core/templates/enforcer-daemonset.yaml` | enforcer 部署模板 |
| `charts/core/templates/manager-deployment.yaml` | manager 部署模板 |
| `charts/core/templates/scanner-deployment.yaml` | scanner 部署模板 |

如果后续你问我“某个部署参数该改哪”，通常答案都会从 `charts/core/values.yaml` 开始找。

## 5. 运行时关系怎么串起来

### 5.1 浏览器访问管理后台

流程是：

1. 浏览器访问 manager。
2. manager 返回页面资源。
3. manager 服务端再去调用 controller 的 REST API。

所以很多“前端功能”实际上会横跨两层：

- 页面在 `manager/admin/webapp/websrc/`
- 页面背后的服务适配在 `manager/admin/src/main/scala/com/neu/`
- 真正的系统数据和策略能力在 `neuvector/controller/`

### 5.2 策略与配置下发

流程通常是：

1. 用户在 manager 操作。
2. manager 调 controller。
3. controller 计算和保存策略。
4. controller 下发给 enforcer。
5. enforcer 在节点侧执行。

所以“页面上改了一个策略功能”，经常不只是改前端，而是要同时改：

- manager 页面
- manager 接口适配
- controller API
- controller 内部业务逻辑
- 必要时 enforcer 执行逻辑

### 5.3 镜像或仓库扫描

流程通常是：

1. controller 发起扫描任务。
2. scanner 执行扫描。
3. 扫描结果回到 controller。
4. manager 再把结果展示出来。

所以“漏洞列表展示不对”和“扫描结果本身不对”是两类不同问题：

- 展示不对，多半落在 manager 或 controller 返回格式
- 结果本身不对，多半落在 scanner

### 5.4 运行中容器扫描

这一条非常关键，因为它不是 scanner 单独完成的：

1. controller 请求 scanner 扫描运行中的对象。
2. scanner 再调用 enforcer 获取运行时文件或容器数据。
3. scanner 做分析。
4. 结果返回 controller。

所以运行时扫描如果出问题，可能同时涉及：

- controller
- scanner
- enforcer

### 5.5 集群内部证书和升级

`upgrader/` 不是可有可无的小工具，它是内部证书轮换链路的一部分。Helm Chart 也会通过它来创建辅助 job，并在 rollout 时检查组件健康状态。

这意味着：

- 如果只是正常二改业务逻辑，通常不用改 `upgrader/`
- 如果后续碰到内部证书、滚动升级、升级后互联失败，就要重点排查 `upgrader/` 和 Helm 模板

## 6. 后续二改时，应该先改哪个仓库

可以直接按下面这张表判断：

| 需求类型 | 优先改哪里 |
| --- | --- |
| 页面布局、表格、交互、前端路由 | `manager/admin/webapp/websrc/` |
| manager 服务端接口、登录流程、中间转发 | `manager/admin/src/main/scala/com/neu/` |
| controller API、权限、策略、K8s 资源同步、扫描编排 | `neuvector/controller/` |
| 节点侧行为、运行时防护、进程/文件/网络采集 | `neuvector/agent/` 和 `neuvector/dp/` |
| 扫描引擎、漏洞识别、scanner 服务能力 | `scanner/` |
| 部署副本数、Ingress、镜像地址、运行时 socket、K8s 适配参数 | `neuvector-helm/` |
| 共享结构、共享 RPC 类型、公共工具 | `neuvector/share/`，并同步评估 controller / enforcer / scanner 是否都要重打 |

这里有一个后续很容易踩坑的点：

- `manager` 和 `controller` 主要是接口契约耦合
- `scanner` 对 `neuvector` 不只是“接口耦合”，它在 `go.mod` 里直接依赖 `github.com/neuvector/neuvector`

这意味着：

- 如果你改的是 `neuvector/share/` 或 controller/scanner 共用的 Go 类型，scanner 不能只改源码不处理依赖版本
- 更稳妥的方式是把你修改后的 `neuvector` 提交到自己的 fork/tag，再让 `scanner` 指向你自己的版本

## 7. 改完代码以后，应该重打哪些镜像

最简单的记法如下：

| 你改了什么 | 需要重打的镜像 |
| --- | --- |
| `neuvector/controller/*` | `controller` |
| `neuvector/agent/*` 或 `neuvector/dp/*` | `enforcer` |
| `neuvector/share/*` | 至少重打 `controller` 和 `enforcer`，必要时连 `scanner` 一起重打 |
| `manager/admin/webapp/*` 或 `manager/admin/src/*` | `manager` |
| `scanner/*` | `scanner` |
| `neuvector-helm/*` | 不需要重打镜像，只需要重新 Helm 升级 |

更接近实际的建议是：

1. 改 controller 逻辑，默认重打 `controller`。
2. 改 enforcer 逻辑，默认重打 `enforcer`。
3. 改 manager 页面或 manager 服务端，重打 `manager`。
4. 改 scanner，重打 `scanner`。
5. 改共享协议、共享类型、共享证书交互时，把相关上下游都一起重打，不要赌兼容性。

## 8. 当前各镜像是怎么构建出来的

这一节只保留真正有用的结论。

### 8.1 `controller` 镜像

来自 `neuvector/package/Dockerfile.controller`，构建时会把这些东西打进去：

- `controller`
- `monitor`
- `upgrader`
- 脚本、模板、CIS 资源

也就是说，controller 镜像不只是 controller 二进制本身，它还带着 monitor 和 upgrader 相关内容。

### 8.2 `enforcer` 镜像

来自 `neuvector/package/Dockerfile.enforcer`，构建时会把这些东西打进去：

- `agent`
- `dp`
- `pathWalker`
- `monitor`
- `nstools`
- 脚本、模板、CIS 资源

所以 enforcer 的构建比 controller 更重，也更依赖 Linux 下的底层编译环境。

### 8.3 `manager` 镜像

来自 `manager/package/Dockerfile`，构建过程本质上是：

1. 先编 Angular 前端。
2. 再用 Scala/SBT 打 manager 的 jar。
3. 最后打进运行镜像。

所以哪怕你只是改了一点前端页面，最后也还是要重打整个 `manager` 镜像。

### 8.4 `scanner` 镜像

来自 `scanner/package/Dockerfile`，构建时会打进去：

- `scanner`
- `scannerTask`
- `monitor`
- `sigstore-interface`
- CVE 数据文件

所以 scanner 不是只有一个单文件程序，它会把扫描所需的多个辅助组件一起打进去。

## 9. 二改后的镜像构建建议

### 9.1 构建环境建议

当前你这台机器是 Windows，但真正构建这些镜像时，我不建议直接把 Windows 当主构建环境。原因很简单：

- `enforcer` 明显依赖 Linux 下的编译工具链和底层库
- `manager` 依赖 Node、Angular、Scala、SBT、Java
- `scanner` 依赖 Go 和扫描相关构建链
- Helm 部署虽然可以在很多环境执行，但镜像构建本身更适合 Linux

最稳妥的做法是：

1. 用 Linux 主机。
2. 或者用 WSL2 / Linux 虚拟机。
3. 或者后面直接上 CI 做统一构建。

### 9.2 镜像 tag 的建议

建议从一开始就用自己的 tag 规则，不要混着用 `latest`。

推荐格式示例：

```text
5.5.0-myteam.1
5.5.0-myteam.2
2026.04.04-dev1
```

这样后面排查问题时最省事。

### 9.3 推荐的镜像仓库命名

如果你的私有仓库地址是：

```text
registry.example.com/nv
```

那么最顺手的命名方式就是：

- `registry.example.com/nv/controller:<tag>`
- `registry.example.com/nv/enforcer:<tag>`
- `registry.example.com/nv/manager:<tag>`
- `registry.example.com/nv/scanner:<tag>`

这样和当前 Makefile 的习惯也最一致。

## 10. 实际构建命令怎么走

下面只保留后续真正会用到的最小命令。

先约定：

```text
REPO=registry.example.com/nv
TAG=5.5.0-myteam.1
```

### 10.1 构建 `controller` 和 `enforcer`

在 Linux 环境进入 `neuvector/`：

```bash
make build-controller-image REPO=$REPO TAG=$TAG
make build-enforcer-image REPO=$REPO TAG=$TAG
```

如果要直接推送：

```bash
make push-controller-image REPO=$REPO TAG=$TAG
make push-enforcer-image REPO=$REPO TAG=$TAG
```

### 10.2 构建 `manager`

在 `manager/`：

```bash
make build-image REPO=$REPO TAG=$TAG
```

如果要直接推送：

```bash
make push-image REPO=$REPO TAG=$TAG
```

### 10.3 构建 `scanner`

在 `scanner/`：

```bash
make build-image REPO=$REPO TAG=$TAG
```

如果要直接推送：

```bash
make push-image REPO=$REPO TAG=$TAG
```

## 11. 如果改到了共享代码，scanner 要特别注意

这是后续二开里最值得提前写清楚的一点。

`scanner/go.mod` 直接依赖 `github.com/neuvector/neuvector`。这意味着如果你改了：

- `neuvector/share/`
- controller 和 scanner 共用的类型
- controller / scanner 通信协议相关代码

那么 scanner 不能只靠“本地目录也改了”就自动生效，因为 scanner 是独立 Go module。

更稳妥的做法有两种：

1. 正式做法：把修改后的 `neuvector` 提交到你自己的 fork，并给出明确 tag 或 commit，再让 `scanner` 更新依赖到这个版本。
2. 临时做法：为了本地联调，临时做本地 replace，但最终仍建议回到 fork/tag 的正式方式。

如果只是改 manager 或 controller 的 REST 展示层，而没有碰 scanner 依赖的共享 Go 包，就不用额外处理 scanner 依赖。

## 12. 部署到你自己的 Kubernetes，推荐怎么做

最推荐的方式是：

- 用 `neuvector-helm/charts/core`
- 用你自己的 `values` 文件覆盖镜像地址和少量部署参数
- 用 `helm upgrade --install` 做统一部署和升级

不推荐的方式是：

- 一开始就手写很多零散 Deployment/Service/YAML

原因很现实：

- controller / enforcer / manager / scanner 之间的部署关系比较多
- enforcer 对运行时 socket、hostPID、权限要求特殊
- 内部证书轮转和 upgrader 链路不太适合手工拼

## 13. 一个够用的 Helm 覆盖文件长什么样

下面这份 values 只保留后续最常用的部分：

```yaml
registry: registry.example.com
tag: 5.5.0-myteam.1
imagePullSecrets: regsecret

controller:
  image:
    repository: nv/controller

enforcer:
  image:
    repository: nv/enforcer

manager:
  image:
    repository: nv/manager

cve:
  scanner:
    image:
      repository: nv/scanner
      tag: 5.5.0-myteam.1

containerd:
  enabled: true
```

这份配置表达的意思其实很简单：

- controller / enforcer / manager 都走同一个全局 `tag`
- scanner 单独显式指定仓库和 tag
- 镜像从你的私有仓库拉取
- 集群运行时按 containerd 处理

这里有两个很重要的提醒：

1. chart 里的 scanner tag 默认不是跟全局 `tag` 完全绑定的，所以你自己重打 scanner 后，记得显式改 `cve.scanner.image.tag`。
2. 如果你的镜像路径不是 `registry.example.com/nv/...` 这种结构，就把各组件的 `repository` 改成你自己的实际路径。

## 14. 部署步骤建议

### 14.1 准备命名空间

如果你的集群启用了 Pod Security Admission，建议给命名空间打上 privileged 标签，因为 enforcer 这类组件需要较高权限。

```bash
kubectl create namespace neuvector
kubectl label namespace neuvector pod-security.kubernetes.io/enforce=privileged --overwrite
```

### 14.2 准备镜像拉取密钥

如果你的私有仓库需要认证，先创建 `imagePullSecret`：

```bash
kubectl create secret docker-registry regsecret \
  -n neuvector \
  --docker-server=registry.example.com \
  --docker-username=<username> \
  --docker-password=<password>
```

### 14.3 安装或升级 Helm Release

在 `nv/` 目录附近执行最方便：

```bash
helm upgrade --install neuvector ./neuvector-helm/charts/core \
  -n neuvector \
  -f ./values.mycluster.yaml
```

如果后续只是镜像变了、tag 变了，通常还是这条命令，只是 values 文件里的 tag 改一下即可。

## 15. 部署时最需要关注的几个参数

这几个参数是后面最常遇到的，不需要一下子记全，但知道它们大概干嘛就够了。

| 参数方向 | 含义 |
| --- | --- |
| `registry` | 全局镜像仓库域名 |
| `tag` | controller / enforcer / manager 默认 tag |
| `controller.image.repository` | controller 镜像路径 |
| `enforcer.image.repository` | enforcer 镜像路径 |
| `manager.image.repository` | manager 镜像路径 |
| `cve.scanner.image.repository` | scanner 镜像路径 |
| `cve.scanner.image.tag` | scanner tag |
| `imagePullSecrets` | 拉取私有镜像所用 secret |
| `containerd.enabled` / `crio.enabled` | 指定容器运行时 |
| `runtimePath` | 运行时 socket 非默认位置时使用 |
| `manager.ingress.*` 或 `manager.svc.*` | manager 的对外访问方式 |
| `controller.ingress.*` / `controller.apisvc.*` | controller API 的暴露方式 |

## 16. 哪些组件可以先沿用官方镜像

如果后续我们主要二改的是 controller、enforcer、manager、scanner，那么其他组件通常可以先不动：

- `updater`
- `registry-adapter`

也就是说，你完全可以：

- 核心四个组件用你自己的镜像
- 其他未修改组件先沿用官方 chart 默认值

这样可以显著降低第一轮落地复杂度。

## 17. 一套适合我们后续协作的日常流程

后面如果我们进入持续二开，建议按下面顺序做：

1. 先判断需求落在哪个仓库。
2. 只改必要的仓库和必要的文件。
3. 本地或 CI 重打对应镜像。
4. 推到你的私有仓库。
5. 更新 Helm values 里的镜像路径和 tag。
6. `helm upgrade --install` 升级到你的 K8s。
7. 用 `kubectl get pods`、`kubectl logs`、页面功能和扫描结果做回归验证。

这个流程的优点是：

- 责任边界清楚
- 改动和镜像能一一对应
- 出问题时比较容易回滚

## 18. 当前最需要记住的坑

最后把最重要的坑单独列出来，后面真的会省很多时间。

### 18.1 不要把 `neuvector/` 当成完整前后端单仓

真正的前端页面在 `manager/`，不在 `neuvector/`。

### 18.2 manager 不是纯前端

manager 既有 Angular 页面，也有 Scala 服务端，所以页面改动最后还是要重打整个 manager 镜像。

### 18.3 scanner 和 neuvector 有真实代码依赖

如果改到了共享 Go 包，scanner 依赖要同步处理。

### 18.4 scanner 的 tag 需要单独留意

Helm 里 scanner 的 image tag 不是简单地永远跟全局 `tag` 走，后续自己重打 scanner 时必须显式核对。

### 18.5 enforcer 的部署权限要求高

它是 `DaemonSet`，而且要碰节点侧运行时和宿主机资源，所以部署环境的权限、Pod Security、运行时 socket 都要提前确认。

### 18.6 真正打镜像时优先用 Linux

Windows 适合阅读、梳理和准备工作，但真正构建这些镜像时，Linux 环境会稳定很多。

## 19. 最后的落地建议

如果要把后续工作排优先级，我建议这样推进：

1. 以后每次需求先判断属于 manager、controller、enforcer、scanner 中的哪一层。
2. 先保持 Helm Chart 作为统一部署入口，不要散落成很多手写 YAML。
3. 尽早确定你自己的镜像仓库地址和 tag 规则。
4. 如果后续会频繁二改，尽早准备一个 Linux 构建环境或 CI。

这样做的结果是：

- 架构上能看清
- 改动时能定位
- 打包时不混乱
- 部署时能重复执行

后面如果你要我继续往下做，我最适合接着补两类文档：

1. “manager/controller 联动二开导航”
2. “controller/enforcer/scanner 联动二开导航”

这两份会更偏向真正开始改代码前的实战视角。
