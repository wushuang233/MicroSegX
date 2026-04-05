# NeuVector 项目结构、镜像构建与 Kubernetes 部署说明

这份文档的目标不是把所有参数抄一遍，而是先帮我们建立一张清晰的“地图”：

- 这个仓库里到底有什么
- 前端、后端、scanner 分别在哪
- 改代码时应该先看哪些目录
- 改完后镜像是怎么打出来的
- 最后是怎么落到 Kubernetes 里的

如果后面你让我改代码，这份文档可以直接当作导航用。

## 1. 一句话先说结论

这个仓库不是“整个 NeuVector 的全部源码”，它主要承载的是：

- `controller`：控制面后端
- `enforcer`：节点侧执行与防护逻辑，代码主要在 `agent/` 和 `dp/`
- `upgrader`：Kubernetes 中证书轮转与升级辅助逻辑
- `monitor`：容器内的进程拉起与监管程序
- `share/`：controller 和 enforcer 共用的基础库

但下面两个重要组件不在本仓库里：

- Web 前端管理界面 `manager` 不在这里，而是在单独仓库 `https://github.com/neuvector/manager`
- 漏洞扫描器 `scanner` 也在单独仓库 `https://github.com/neuvector/scanner`

这点非常关键，因为后面如果你说“改前端”，大概率不是改这个仓库，而是要去 `manager` 仓库。

## 2. 这个仓库的职责边界

从 `CONTRIBUTING.md` 可以直接看到官方拆分方式：

- `neuvector/neuvector`：controller 和 enforcer 源码
- `neuvector/manager`：管理界面 UI
- `neuvector/scanner`：漏洞扫描器

所以更准确地说：

- 这个仓库主要是“后端控制面 + 节点执行面”
- Web UI 只是被部署时一起配套使用，但源码不在这里
- scanner 会和 controller 协同工作，但源码也不在这里

## 3. 项目结构怎么读

### 3.1 顶层目录含义

最重要的目录可以先这样理解：

| 目录 | 作用 |
| --- | --- |
| `controller/` | 控制器主程序，REST API、K8s 集成、策略与扫描编排都在这里 |
| `agent/` | enforcer 的 Go 侧逻辑，负责探测、联动、上报、调用 datapath |
| `dp/` | datapath，偏底层，C/C++ 为主 |
| `monitor/` | 容器入口程序，负责把 controller、agent、dp、opa、scanner 等进程拉起来 |
| `upgrader/` | K8s 里的升级辅助程序，主要负责内部证书轮转、升级 Job |
| `share/` | 共用库，包含 cluster、healthz、migration、system、scan 等公共能力 |
| `db/` | 与漏洞资产、查询统计等相关的数据层代码 |
| `tools/` | 一些配套二进制工具，比如 `nstools` |
| `scripts/` | 容器启动/收尾脚本，例如 `configure.sh`、`teardown.sh` |
| `package/` | 当前主要在用的镜像构建方式，包含新的 Dockerfile 和构建脚本 |
| `build/` | 较旧的 Dockerfile 和辅助文件，也保留了 all-in-one / swagger 相关内容 |
| `templates/` | 模板资源，目前最显眼的是 `podTemplate.json` |

### 3.2 后端从哪里进

后端主入口很清楚：

- `controller/controller.go`
- `agent/agent.go`
- `upgrader/main.go`

其中：

- `controller/controller.go` 是 controller 进程入口
- `agent/agent.go` 是 enforcer/agent 进程入口
- `upgrader/main.go` 是证书升级与 hook 工具入口

### 3.3 controller 目录怎么理解

后面如果我们改控制面后端，大概率会集中在这些目录：

| 目录 | 作用 |
| --- | --- |
| `controller/rest/` | 对外 REST API，最像“业务接口层” |
| `controller/api/` | API 数据结构和 OpenAPI 文档，`apis.yaml` 很关键 |
| `controller/cache/` | controller 内存态缓存、事件同步、状态聚合 |
| `controller/kv/` | 与集群 KV 存储的交互，项目里实际使用的是 Consul |
| `controller/resource/` | K8s 资源感知与对象抽象 |
| `controller/scan/` | 扫描编排，和 scanner 组件协作 |
| `controller/rpc/` | controller 与 scanner / enforcer 的 RPC 交互 |
| `controller/nvk8sapi/` | CRD、webhook、K8s API 相关逻辑 |
| `controller/opa/` | OPA 相关逻辑 |
| `controller/access/` | 权限控制 |

如果是典型的“改一个后端功能”，通常排查顺序会是：

1. `controller/rest/` 看入口 API
2. `controller/cache/` 或 `controller/kv/` 看状态落点
3. `controller/resource/` 看它是否跟 K8s 资源联动
4. `controller/api/apis.yaml` 看接口契约是否也要更新

### 3.4 agent / enforcer 部分怎么理解

enforcer 不是一个单一二进制，而是多部分协作：

- Go 侧主逻辑在 `agent/`
- 底层 datapath 在 `dp/`
- 容器启动协调在 `monitor/`

`agent/` 里常见的重要子目录：

| 目录 | 作用 |
| --- | --- |
| `agent/probe/` | 主机与容器探测 |
| `agent/policy/` | 策略执行相关 |
| `agent/resource/` | 平台资源抽象 |
| `agent/workerlet/` | 一些异步任务执行能力，比如 `pathWalker` |
| `agent/dp/` | Go 侧与 datapath 的衔接 |
| `agent/nvbench/` | 各类 benchmark / CIS 检查模板与脚本 |

如果后面你说“改节点侧行为、流量控制、运行时防护、主机探测”，大概率要看这里。

### 3.5 monitor 在整个系统里的位置

`monitor/monitor.c` 很重要，因为它不是普通工具，而是镜像真正的入口程序之一。

几个事实很关键：

- controller 镜像的入口是 `monitor -c`
- enforcer 镜像的入口是 `monitor -r`
- all-in-one 镜像里 `supervisord` 会再拉起 manager 和 monitor

也就是说，容器启动后并不是直接跑 `controller` 或 `agent`，而是先经过 `monitor`，由它负责：

- 起进程
- 监控进程
- 调整启动顺序
- 处理 consul 离群与清理动作

这意味着以后如果我们改启动参数、进程关系、容器启动行为，不能只看 Go 代码，也要看 `monitor/monitor.c`。

## 4. “前端和后端”这件事在这个仓库里怎么落地

### 4.1 后端在这个仓库里

是的，控制面后端基本都在这里，尤其是：

- REST API：`controller/rest/`
- API 契约：`controller/api/apis.yaml`
- 与 enforcer/scanner 的协同：`controller/grpc.go`、`controller/rpc/`

### 4.2 Web 前端不在这个仓库里

这个仓库里没有常见的前端工程目录，比如：

- `src/`
- `web/`
- `ui/`
- `package.json`
- React / Vue / Angular 源码目录

相反，仓库里只保留了 manager 的引用和打包痕迹，例如旧 Makefile 中的 `copy_mgr`，以及 `CONTRIBUTING.md` 对 `manager` 独立仓库的说明。

因此后面如果你让我改“页面、按钮、前端交互、前端布局”，先要判断：

- 是 controller 返回的数据要变，还是
- 真正的 UI 页面要变

如果是后者，基本上需要切到 `manager` 仓库。

### 4.3 这里仍然有一个“前端相关接口面”

虽然没有 UI 源码，但这个仓库仍然有“前端会依赖的后端接口层”：

- `controller/rest/`
- `controller/api/`

所以很多“前端需求”其实会先落到这里，比如：

- 新接口
- 字段补充
- 权限检查
- 返回结构调整

## 5. 运行时架构可以怎么理解

把它看成下面这条链就够了：

1. `manager` UI 通过 HTTPS 调 controller 的 REST API
2. controller 负责：
   - 管理配置
   - 策略编排
   - 与 Kubernetes 集成
   - 与 scanner / enforcer 协作
3. enforcer 跑在节点上，负责探测、执行和防护
4. scanner 负责漏洞扫描
5. upgrader 负责在 K8s 环境下处理内部证书和升级辅助逻辑

### 5.1 controller 侧

controller 本身至少包含这几类能力：

- REST API
- gRPC 服务
- Consul 集群 / KV
- OPA
- 健康检查接口

从源码和镜像内容可以看出：

- `controller/controller.go` 会启动 controller 主逻辑
- `controller/grpc.go` 提供 controller 与其他组件的 gRPC 能力
- controller 镜像里额外安装了 `consul` 和 `opa`
- `share/healthz` 提供 `/healthz` 接口，端口是 `18500`

### 5.2 enforcer 侧

enforcer 镜像里会组合这些内容：

- `agent`
- `dp`
- `pathWalker`
- `monitor`
- `consul`

这说明 enforcer 不是“单个 Go 程序”，而是：

- Go 控制逻辑
- C/C++ datapath
- 启动监管层

一起组成的。

### 5.3 Consul 在这里很核心

这个项目不是把所有共享状态都塞进 Kubernetes API，而是大量通过 Consul 做集群状态与 KV 存储。

相关证据很多：

- `share/cluster/consul.go`
- `controller/kv/`
- `monitor/monitor.c` 中直接处理 consul
- controller / agent 镜像都会安装 `consul`

所以后面如果改：

- 集群状态同步
- controller 之间的一致性
- 配置分发
- leader 选举相关逻辑

就不能只盯着 K8s，还要看 Consul 这条线。

## 6. 镜像是怎么构建出来的

这个仓库里同时存在“旧构建链路”和“当前主链路”。

### 6.1 当前主链路：`package/` + 新 Makefile

目前更应该关注的是根目录 `Makefile` 里后半段这些目标：

- `build-controller-image`
- `push-controller-image`
- `build-enforcer-image`
- `push-enforcer-image`

对应的 Dockerfile 是：

- `package/Dockerfile.controller`
- `package/Dockerfile.enforcer`

这套链路的特点是：

- 使用多阶段构建
- 用 `docker buildx`
- 支持多架构
- controller / enforcer 分开构建

### 6.2 controller 镜像构建流程

`package/Dockerfile.controller` 的核心流程可以概括成：

1. 用 `registry.suse.com/bci/golang:1.25` 作为 builder
2. 把 `agent/`、`controller/`、`monitor/`、`upgrader/`、`share/` 等源码拷进 `/src`
3. 把 `controller/version.go` 中的版本占位符替换掉
4. 执行 `package/build_controller.sh`
5. 再用精简运行时镜像把 `stage/` 目录内容复制进去
6. 最终入口是 `/usr/local/bin/monitor -c`

`package/build_controller.sh` 做的事情也很清楚：

- 在 `x86_64` 上先跑 Go 单测
- 编译 `monitor`
- 优先复用 `controller/controller-amd64` 或 `controller/controller-arm64`
- 如果没有现成二进制，再回退到源码编译 `controller`
- 编译 `upgrader`
- 组装 `stage/` 目录
- 把脚本、模板、benchmark 资源也一起打包进去

### 6.3 enforcer 镜像构建流程

`package/Dockerfile.enforcer` 比 controller 更重，因为它要带底层依赖。

它大致做这些事：

1. 安装 gcc、libpcap、pcre、netfilter、jemalloc、vectorscan 等编译依赖
2. 拷贝整个源码树到 `/src`
3. 替换 `agent/version.go` 里的版本占位符
4. 执行 `package/build_enforcer.sh`
5. 在运行时镜像里安装 enforcer 所需依赖
6. 最终入口是 `/usr/local/bin/monitor -r`

`package/build_enforcer.sh` 会编译：

- `monitor`
- `dp`
- `tools/nstools`
- `agent`
- `agent/workerlet/pathWalker`

然后再把脚本、模板、CIS 检查资源等打进 `stage/`。

### 6.4 旧链路仍然存在，但更像兼容保留

旧链路主要体现在：

- 根目录 `Makefile` 前半段
- `build/Dockerfile.controller`
- `build/Dockerfile.enforcer`
- `build/Dockerfile.all`

这套方式更像：

- 先本地把二进制和资源收集到 `stage/`
- 再基于 base image 进行 `COPY stage /`

它对理解历史包袱很有价值，但如果后面我们自己重打镜像，更建议优先看 `package/` 这套。

### 6.5 all-in-one 镜像是什么

`build/Dockerfile.all` 和 `build/supervisord.all.conf` 说明项目曾支持 all-in-one 形态。

这个模式下会同时拉起：

- manager
- monitor

而 `monitor` 再去带起 controller / enforcer 等其他进程。

这更像开发、演示或特殊部署场景，不是现在最值得优先研究的主路径。

### 6.6 Swagger API 镜像是什么

`build/Dockerfile.api` 只是把 `controller/api/apis.yaml` 打进 `swaggerapi/swagger-ui` 镜像，用来展示 API 文档。

它不是业务主镜像。

## 7. 发布流程怎么理解

GitHub Actions 的 `release.yml` 很值得看，因为它能告诉我们“官方是怎么发版的”。

### 7.1 当前发布重点就是两个镜像

发布工作流里只明确发布：

- controller
- enforcer

也就是说，这个仓库自己的核心产物，就是这两个镜像。

### 7.2 发布使用 buildx，多架构推送

工作流里会调用：

- `push-controller-image`
- `push-enforcer-image`

目标平台是：

- `linux/amd64`
- `linux/arm64`

### 7.3 controller 官方发布有一层额外处理

`release.yml` 里会先从私有 release 资产下载：

- `controller-amd64`
- `controller-arm64`

然后校验 sha256，再参与最终镜像发布。

这说明两件事：

1. 本地开发时，我们仍然可以从源码编译 controller
2. 本地如果事先放好了 `controller/controller-amd64` 或 `controller/controller-arm64`，构建脚本也会优先复用它们
3. 官方 release 流水线里，controller 二进制确实经过了额外的私有制品流程

这对“本地重打一个可用测试镜像”影响不大，但对“完全复刻官方发版”有影响。

## 8. Kubernetes 里是怎么部署的

这里有一个非常重要的现实情况：

这个仓库里没有完整 Helm Chart 源码，但从 `upgrader/testdata/` 可以清楚看出它最终在 K8s 上的落地形态，而且这些测试数据明显是围绕 Helm 安装结果构建的。

换句话说：

- Chart 很可能在别的仓库或发布系统里维护
- 但这个仓库仍然保留了足够多的部署“运行证据”

### 8.1 可以确认它是 Helm 风格部署

从测试数据里可以看到典型标记：

- `heritage: Helm`
- `chart: core-x.y.z`
- `release: release-name`

所以后续真正部署到 K8s，大概率不是手写一堆 `kubectl apply`，而是通过 Helm 或 Rancher 的包装 Chart。

### 8.2 主要工作负载有哪些

从 `upgrader/testdata/04-upgrade-internal-certs/01-deployments.yaml` 可以整理出典型组件：

| 组件 | K8s 类型 | 作用 |
| --- | --- | --- |
| `neuvector-controller-pod` | `Deployment` | controller 控制面 |
| `neuvector-enforcer-pod` | `DaemonSet` | 每节点一个 enforcer |
| `neuvector-manager-pod` | `Deployment` | UI 管理界面 |
| `neuvector-scanner-pod` | `Deployment` | scanner |
| `neuvector-registry-adapter-pod` | `Deployment` | registry 适配组件 |
| `neuvector-cert-upgrader-pod` | `CronJob` | 证书升级任务模板 |
| `neuvector-cert-upgrader-job` | `Job` | 实际触发的证书升级作业 |

### 8.3 controller 为什么是 Deployment

controller 需要多副本、高可用、leader 选举，因此它被部署成 `Deployment` 很合理。

测试数据里常见的形态是：

- 3 个副本
- Pod 反亲和
- readiness 依赖 `/tmp/ready`
- 启动时会带一个 init container

### 8.4 enforcer 为什么是 DaemonSet

enforcer 需要进入每个节点，做节点级探测和防护，所以它天然适合 `DaemonSet`。

从测试数据看，它还有这些典型特征：

- `hostPID: true`
- `privileged: true`
- 挂载 `/lib/modules`
- 可能挂载运行时 socket、`/proc`、`/sys/fs/cgroup`

这说明它对宿主机权限依赖很强，后续如果我们改 enforcer，必须始终记住它不是普通无权限 Pod。

### 8.5 manager、scanner、registry-adapter 都是附属组件

它们不是这个仓库的核心源码产物，但在 K8s 部署里是完整平台的一部分：

- manager 给人用
- scanner 负责漏洞扫描
- registry-adapter 负责和镜像仓库能力协同

### 8.6 controller 与其他组件怎么通信

从部署数据可以看到典型环境变量：

- `CLUSTER_JOIN_ADDR=neuvector-svc-controller.neuvector`
- `CTRL_SERVER_IP=neuvector-svc-controller.neuvector`

这意味着：

- controller 暴露了一个集群内稳定服务名
- enforcer / scanner / manager 通过这个服务名去接 controller

### 8.7 升级和证书轮转不是“顺手做”，而是专门设计过

`upgrader/` 不是摆设，它在 Helm / K8s 安装流程里是重要角色。

可以这样理解：

- controller Pod 启动时会先跑一个 init container
- 这个 init container 会触发 upgrader 逻辑
- upgrader 会根据 `CronJob` 模板生成实际的 `Job`
- `Job` 再负责内部证书生成、替换、轮转和滚动升级协调

源码里可以看到：

- `upgrader/presync.go` 负责创建升级 Job
- `upgrader/postsync.go` 负责等待各组件证书版本追平
- `share/healthz` 的 `18500/healthz` 会被用来检查 `cert.revision`

这意味着以后如果我们改：

- controller / enforcer 启动逻辑
- 证书挂载路径
- readiness / healthz
- Pod 模板里的 volume

就可能影响整个升级流程，不能只看“服务能不能启动”。

## 9. 这套项目从源码到 K8s 的完整路径

把它简化成下面这条链就最容易理解：

### 第 1 步：改源码

最常见的改动入口：

- 改 controller 后端：`controller/`
- 改节点/enforcer 行为：`agent/`、`dp/`
- 改公共能力：`share/`
- 改证书/升级逻辑：`upgrader/`

### 第 2 步：在 Linux 环境重打镜像

最实用的命令是：

```bash
make build-controller-image
make build-enforcer-image
```

如果要指定仓库和 tag，可以理解成：

```bash
make build-controller-image REPO=<你的镜像仓库> TAG=<你的标签>
make build-enforcer-image REPO=<你的镜像仓库> TAG=<你的标签>
```

### 第 3 步：推送镜像

如果已经配置好 registry，可以继续：

```bash
make push-controller-image REPO=<你的镜像仓库> TAG=<你的标签>
make push-enforcer-image REPO=<你的镜像仓库> TAG=<你的标签>
```

### 第 4 步：更新 Helm Chart 或部署仓库中的镜像版本

因为 Chart 不在这个仓库里，实际落地时通常会在另一个地方修改：

- controller image tag
- enforcer image tag
- 如果涉及 UI 或 scanner，还要同步改 manager / scanner 的镜像版本

### 第 5 步：执行 Helm 升级

通常会是类似下面的动作：

- `helm upgrade ...`
- 或通过 Rancher / Fleet / 内部发布系统升级

这里不写一长串参数，是因为真正参数取决于你们后面使用的 Chart 仓库和环境。

### 第 6 步：验证升级结果

最关键的是确认：

- controller Deployment 滚动完成
- enforcer DaemonSet 全部更新
- manager 能正常连 controller
- scanner 正常注册
- 如果涉及证书轮转，upgrader Job 正常完成

## 10. 为什么当前 Windows 环境不适合真实重打

虽然现在可以把结构研究清楚，但要在这个 Windows 环境里“真的把整个项目打出来”，阻力会很大，原因很现实：

- `monitor/`、`dp/` 明显依赖 Linux 编译环境
- 构建脚本是 bash + make + zypper 体系
- 镜像运行依赖宿主机 Linux 能力，比如 `/proc`、`/sys/fs/cgroup`、`/lib/modules`
- enforcer 在 K8s 里要求 `privileged + hostPID + hostPath`

所以更可行的方式是：

- 现在先把结构和流程研究清楚
- 真正打包时切到 Linux、WSL2，或者 CI 环境

## 11. 后面改代码时，最推荐的定位方式

### 11.1 如果要改 controller 后端

优先看：

- `controller/rest/`
- `controller/cache/`
- `controller/kv/`
- `controller/resource/`
- `controller/api/apis.yaml`

### 11.2 如果要改节点防护逻辑

优先看：

- `agent/`
- `agent/probe/`
- `agent/policy/`
- `dp/`
- `monitor/`

### 11.3 如果要改 Web 前端

先停一下，不要直接在这个仓库里找 UI 目录。

更应该先确认是不是要去：

- `https://github.com/neuvector/manager`

### 11.4 如果要改漏洞扫描

先判断改动属于哪类：

- 如果是 controller 对 scanner 的调用与编排，先看这个仓库里的 `controller/scan/` 和 `controller/rpc/`
- 如果是 scanner 自身扫描行为，通常要去 scanner 独立仓库

## 12. 对我们后续协作最有用的几个结论

### 结论 1

这个仓库不是完整的“前后端单仓”，它更像“控制面后端 + 节点执行面”。

### 结论 2

后端主入口清晰，controller 和 enforcer 的源码都在这里，后续改业务逻辑是完全可行的。

### 结论 3

前端 UI 源码不在这里，后面如果要改页面，先确认是不是要切到 `manager` 仓库。

### 结论 4

当前真正值得依赖的镜像构建链路是 `package/` 下的新 Dockerfile 和根 `Makefile` 的 buildx 目标。

### 结论 5

Kubernetes 部署明显是 Helm 风格，controller 是 `Deployment`，enforcer 是 `DaemonSet`，证书轮转由 `upgrader` 协调。

### 结论 6

后面只要我们改动涉及：

- 启动流程
- 证书路径
- readiness / healthz
- controller 与 enforcer 的通信

就必须连同升级流程和 K8s 滚动行为一起考虑。

## 13. 后面建议的工作方式

如果你后续让我继续深入，我建议按下面顺序推进：

1. 先明确改动目标属于 controller、enforcer、manager 还是 scanner
2. 如果是这个仓库内的改动，我先锁定具体目录和入口文件
3. 改完后优先给出“需要重打哪些镜像”
4. 再给出“Chart/部署侧需要改哪些镜像 tag 或 values”

这样效率会最高，也最不容易改错仓库。

## 14. 这份文档对应的关键源码位置

后面快速回看时，优先看这些文件：

- `CONTRIBUTING.md`
- `Makefile`
- `package/Dockerfile.controller`
- `package/Dockerfile.enforcer`
- `package/build_controller.sh`
- `package/build_enforcer.sh`
- `controller/controller.go`
- `agent/agent.go`
- `upgrader/main.go`
- `upgrader/presync.go`
- `upgrader/postsync.go`
- `monitor/monitor.c`
- `controller/api/apis.yaml`
- `upgrader/testdata/04-upgrade-internal-certs/01-deployments.yaml`

---

如果后面你要我继续做第二层文档，我建议下一份就写成更实战的版本：

- “controller 后端改动导航”
- “enforcer 改动导航”
- “重打镜像与 Helm 升级操作清单”

这样会比继续泛泛阅读整个仓库更直接。
