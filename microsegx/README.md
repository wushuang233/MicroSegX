# microsegx

`microsegx` 目录保存核心控制面和节点执行面的源码，是 `controller`、`enforcer`、数据面和公共运行库的主要实现位置。

## 目录说明

- `controller`
  控制面核心逻辑，包括缓存、策略、资源同步、REST/RPC、Kubernetes 资源处理等。

- `agent`
  节点侧代理代码，对应 `enforcer` 运行时行为、策略执行和主机侧采集。

- `dp`
  数据面与包处理相关代码。

- `share`
  公共包、模型、集群通信和工具库。

- `monitor`
  监控辅助进程代码。

- `upgrader`
  升级相关组件代码。

- `scripts`
  运行时脚本和系统配置脚本。

- `templates`
  控制面生成资源时用到的模板文件。

- `package`
  controller / enforcer 镜像 Dockerfile 和打包文件。

## 常用流程

构建核心二进制：

```bash
make fleet
```

构建 controller 镜像：

```bash
make build-controller-image TAG=<tag> REPO=<repo>
```

构建 enforcer 镜像：

```bash
make build-enforcer-image TAG=<tag> REPO=<repo>
```

兼容旧流程时，也可以继续使用：

```bash
make ctrl_image
make enf_image
```

## 说明

- `controller` 的持久化不是可选项，部署时需要同时保证 PVC、持久化目录和相关配置一致。
- 该目录主要负责控制面与执行面源码，最终交付流程请以仓库根目录 `docs/` 下文档为准。
- 自动策略系统的设计与执行手册在：
  - `../docs/AUTO-NETWORK-POLICY-SYSTEM-DESIGN.zh-CN.md`
  - `../docs/AUTO-NETWORK-POLICY-SYSTEM-AGENT-EXECUTION.zh-CN.md`
