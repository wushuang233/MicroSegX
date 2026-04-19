# MicroSegX

面向 Kubernetes 环境的主动微隔离与暴露面治理工程仓库。

本仓库包含 `MicroSegX` 控制面、`manager` 管理端、`scanner` 漏洞扫描、`port-audit` 端口暴露面能力，以及 `OpenZiti` 零信任接入相关的构建、打包、离线导入与部署脚本。

## 简介

`MicroSegX` 用于在 Kubernetes 环境中统一承载以下能力：

- 工作负载与节点侧的微隔离控制
- 端口暴露面发现、展示与治理
- 漏洞扫描与基础风险评估
- 零信任接入与服务发布

当前仓库采用单仓组织方式，覆盖源码、Helm chart、离线交付包、部署脚本以及本地联调流程。

## 主要目录

```text
.
├── docs/
├── k8s-node-surface/
├── manager/
├── microsegx/
├── microsegx-helm/
├── openziti/
├── ops/
│   ├── full-release/
│   └── microsegx-local/
├── scanner/
└── artifacts/
```

目录说明：

- `manager`
  管理页面与 manager 后端代码。

- `microsegx`
  controller / enforcer 相关核心代码。

- `scanner`
  漏洞扫描代码与漏洞库准备逻辑。

- `microsegx-helm`
  core 组件的 Helm chart 模板。

- `k8s-node-surface`
  `port-audit` 服务、镜像和交付脚本。

- `openziti`
  OpenZiti 部署文件与离线包脚本。

- `ops/full-release`
  正式打包、离线导入、部署相关脚本。

- `ops/microsegx-local`
  本地单节点 `k3s` 联调与离线辅助脚本。

- `docs`
  项目文档入口、打包手册、部署手册、前端改动手册。

## 组件关系

本仓库中的核心组件包括：

- `manager`
  提供管理界面与统一入口。

- `controller`
  提供核心控制面与状态管理能力。

- `enforcer`
  负责节点侧执行与策略落地。

- `scanner`
  负责漏洞库加载与扫描结果生成。

- `port-audit`
  负责端口暴露面采集、展示与治理接口。

- `OpenZiti`
  提供零信任 Fabric、身份、服务、路由器与接入策略能力。

## 文档导航

文档主入口：

- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

常用文档：

- [docs/PACKAGING.md](./docs/PACKAGING.md)
  打包与产物说明。

- [docs/K8S-CONTAINERD-DELIVERY-MANUAL.md](./docs/K8S-CONTAINERD-DELIVERY-MANUAL.md)
  普通 Kubernetes 集群离线 `ctr/containerd` 交付主手册。

- [docs/MINIMAL-TRANSFER-DEPLOY-K8S.md](./docs/MINIMAL-TRANSFER-DEPLOY-K8S.md)
  普通 Kubernetes 集群最简交付文档。

- [docs/K8S-DELIVERY-MANUAL.md](./docs/K8S-DELIVERY-MANUAL.md)
  私有镜像仓库拉取模式的补充手册。

- [docs/IMPORT-DEPLOYMENT.md](./docs/IMPORT-DEPLOYMENT.md)
  本地 `k3s` 联调与排障文档。

- [docs/FRONTEND-CHANGE-WORKFLOW.zh-CN.md](./docs/FRONTEND-CHANGE-WORKFLOW.zh-CN.md)
  `manager` 前端页面修改与重部署流程。

- [docs/AUTO-NETWORK-POLICY-SYSTEM-DESIGN.zh-CN.md](./docs/AUTO-NETWORK-POLICY-SYSTEM-DESIGN.zh-CN.md)
  全自动网络策略系统设计文档。

- [docs/AUTO-NETWORK-POLICY-SYSTEM-AGENT-EXECUTION.zh-CN.md](./docs/AUTO-NETWORK-POLICY-SYSTEM-AGENT-EXECUTION.zh-CN.md)
  全自动网络策略系统执行手册。

## 推荐交付路径

当前推荐的正式交付路径为：

1. 在构建机生成普通 Kubernetes 集群离线总包
2. 将总包发送到目标环境
3. 在目标集群节点上使用 `ctr/containerd` 导入镜像
4. 部署 `MicroSegX + OpenZiti + Port-Audit`

对应脚本入口：

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

本地 `k3s` 相关脚本仅作为联调、验证与排障辅助流程保留，不作为最终交付主线。

## 常用命令

生成普通 Kubernetes 集群离线总包：

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

只构建 `MicroSegX core` release：

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-and-package.sh ops/full-release/full-release.env
```

本地 `k3s` 一体化部署：

```bash
cd /home/wushuang/MicroSegX
bash ops/microsegx-local/deploy-local.sh
```

将本地离线镜像写入 `k3s` 自动导入目录：

```bash
cd /home/wushuang/MicroSegX
bash ops/microsegx-local/setup-k3s-offline-auto-import.sh
```

## 已验证环境

当前已完成实际验证的环境包括：

- 单机 `k3s`
  用于本地联调、前端验证、离线镜像恢复与问题复现。

- 普通 Kubernetes 集群
  作为最终交付目标，采用离线 `ctr/containerd` 导入路径。

## 已知限制

- `controller` 持久化为必选项。
  需要同时保证 `PVC + /var/microsegx + CTRL_PERSIST_CONFIG=1`。

- 本地 `k3s` 离线模式需要额外执行镜像归档写入步骤，否则虚拟机重启后仍可能出现 `ErrImageNeverPull`。

- 单独重打 `manager / controller / enforcer` 后，历史离线交付包不会自动同步更新。
  重新迁移前需要重新生成交付包，或将当前精确 tag 重新导入目标节点。

- 当前策略能力仍以人工配置为主，自动生成与自动收敛能力不足。

## 运维说明

reset 或重装前，建议先备份：

```bash
kubectl get secret microsegx-store-secret -n microsegx -o yaml > microsegx-store-secret-backup.yaml
```

本地 `k3s` 离线部署完成后，建议执行：

```bash
bash ops/microsegx-local/setup-k3s-offline-auto-import.sh
```

## Roadmap

当前后续重点不是新增单页功能，而是完善策略能力，主要包括：

- 基于现网流量、端口暴露面、工作负载标签自动生成初始策略
- 基于 `port-audit` 结果生成更合理的端口治理建议
- 基于 `OpenZiti` 的 host / dial / identity / service 关系生成零信任接入建议
- 在策略生成前增加冲突检查、影响面分析和模拟预览
- 形成“观察模式 -> 推荐策略 -> 人工确认 -> 灰度生效”的闭环

这部分仍是当前仓库后续演进的主要方向。
