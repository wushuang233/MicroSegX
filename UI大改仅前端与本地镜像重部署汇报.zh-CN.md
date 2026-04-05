# UI 大改仅前端场景与本地镜像重部署汇报

本文单独回答你现在最关心的 3 件事：

1. 如果后续要大改 UI，但暂时只改前端，不动后端，应该怎么改。
2. 改完以后，要重新部署到你自己的 Kubernetes 集群，整个项目要做什么操作。
3. 如果需要打成本地镜像、导入集群再重部署，能不能有一套脚本把流程拉直。

结论先说在前面：

- 如果只是大改 UI，主战场在 `manager` 仓，不在 `microsegx` 仓。
- 只改前端并不等于只重打前端静态资源，最终还是要重打整个 `manager` 镜像。
- 重新部署到 K8s 时，最稳妥的入口仍然是 Helm Chart。
- 我已经在 `nv/ops/ui-only/` 下补了一套脚本，用来做“只改 UI 时的镜像重打、同步、导入和 Helm 升级”。

## 1. 如果只大改 UI，不动后端，应该怎么改

### 1.1 改动边界

如果这次真的只是“UI 大改”，原则上只动 `manager` 仓即可，优先看这些位置：

| 位置 | 适合做什么 |
| --- | --- |
| `manager/admin/webapp/websrc/app/routes/` | 页面路由、页面级模块、主要业务页面 |
| `manager/admin/webapp/websrc/app/frame/` | 页面框架、整体布局、导航、壳层 |
| `manager/admin/webapp/websrc/app/common/` | 公共组件、通用 UI 片段 |
| `manager/admin/webapp/websrc/assets/img/` | 图片资源、图标资源 |
| `manager/admin/webapp/websrc/assets/i18n/` | 国际化文案 |
| `manager/admin/webapp/websrc/styles.scss` | 全局样式 |
| `manager/admin/webapp/websrc/material-theme.scss` | 主题层样式 |
| `manager/admin/webapp/websrc/index.html` | 页面壳和全局入口 |

如果你做的是下面这类需求，通常可以坚持“不动后端”：

- 页面重新设计
- 色彩体系、字号体系、间距体系调整
- 菜单、导航、表格、卡片、详情页重新排版
- 图标、图片、文案替换
- 前端交互优化

### 1.2 哪些地方尽量别碰

如果目标是“只改前端”，那这些地方尽量先别碰：

| 位置 | 原因 |
| --- | --- |
| `manager/admin/src/main/scala/com/neu/api/` | manager 服务端 API 层 |
| `manager/admin/src/main/scala/com/neu/service/` | manager 服务端业务逻辑 |
| `manager/admin/src/main/scala/com/neu/client/` | manager 到 controller 的接口适配 |
| `microsegx/controller/` | controller 后端 |
| `scanner/` | 扫描器逻辑 |

也就是说，如果你后续的大改 UI 只是“换皮、重做交互、重排布局”，那我们应该尽量把改动压在：

- Angular 页面
- 全局样式
- 资源文件

而不是顺手把 manager 服务端或 controller 一起改了。

### 1.3 本地开发时怎么理解它

这个项目里的“前端”不是独立产物，它最后会被打进 `manager` 的构建链里：

1. Angular 前端在 `manager/admin/webapp/` 下构建。
2. 然后 `manager/package/build_manager.sh` 会把前端构建结果和 Scala/SBT 产物一起打包。
3. 最终产物是 `manager` 镜像，不是一个单独的 Nginx 静态站点镜像。

这点特别重要，因为它直接决定了后续部署方式：

- 你虽然只改了前端
- 但上线时仍然是替换整个 `manager` 镜像

## 2. 如果只改 UI，后续重新部署到 K8s 要做什么

### 2.1 最小闭环

如果 API 契约完全不变，那么最小闭环是：

1. 在 `manager` 仓修改 UI。
2. 重新构建 `manager` 镜像。
3. 用 Helm 升级你的集群部署。
4. 只让 `manager` 这条链路变化，其他组件尽量保持不动。

### 2.2 这里有一个 Helm 层面的隐藏点

官方 chart 当前的镜像规则不是完全独立的：

- `controller`
- `enforcer`
- `manager`

这三个组件默认共用全局 `tag`。

这意味着如果你只重打 `manager:5.5.0-ui.1`，但 Helm 里把全局 `tag` 改成 `5.5.0-ui.1`，那么：

- controller 也会去找 `controller:5.5.0-ui.1`
- enforcer 也会去找 `enforcer:5.5.0-ui.1`

如果这两个镜像没有准备好，升级就会出问题。

所以“只改 UI”的部署，推荐两种做法：

### 2.3 做法 A：最稳妥

只重建 manager，但给整套 release 准备统一 tag。

举例：

- 你新建一个 tag：`5.5.0-ui.1`
- `manager:5.5.0-ui.1` 是你新构建的
- `controller:5.5.0-ui.1` 和 `enforcer:5.5.0-ui.1` 可以是从原来的稳定版本复制/重标记过来的

这个做法的好处是：

- 最符合官方 chart 当前结构
- Helm 升级最简单
- 后续回滚最直接

### 2.4 做法 B：只在私有仓库里单独钉住 manager

如果你走私有仓库，而且愿意额外精细化 chart 值，也可以只替换 manager 的 digest 或额外改 chart。

但这条路不适合你现在这个阶段，因为它会把部署复杂度抬高。

所以我这次给你的脚本，默认走的是做法 A：

- manager 真构建
- controller / enforcer / scanner / updater 走同步或重标记
- 然后统一 Helm 升级

## 3. 重新部署到你自己的 K8s，推荐路径

### 3.1 如果集群能访问你的私有镜像仓库

推荐路径是：

1. 构建新的 manager 镜像。
2. 把未修改的 controller / enforcer 同步成同一 tag。
3. 按需要同步 scanner / updater。
4. Helm upgrade。

这个模式最适合：

- 正式测试环境
- 准生产环境
- 后续长期持续二开

### 3.2 如果集群不方便直接拉私有仓库，或者你要本地导入

推荐路径是：

1. 本地构建 manager 镜像。
2. 本地准备和 Helm 引用一致的 controller / enforcer / scanner / updater 镜像名。
3. 导出 tar 包或直接导入本地集群运行时。
4. Helm upgrade。

这个模式最适合：

- kind
- k3d
- minikube
- 局部离线测试

## 4. 为什么脚本不只管 manager

这是这次脚本设计里最重要的一点。

如果只改 UI，业务上当然只有 manager 变化，但部署上不等于只处理 manager。原因有 3 个：

1. `manager/controller/enforcer` 默认共用全局 `tag`。
2. `scanner` 在 chart 里有单独 tag，默认 `imagePullPolicy` 还是 `Always`，本地导入时必须改。
3. `updater` 默认是启用的，如果你把全局 registry 改成自己的本地命名空间，它的镜像引用也要一起考虑。

所以脚本才会补齐这几个动作：

- 真正构建 manager
- 同步 controller / enforcer
- 同步 scanner / updater
- 生成一份只用于这次 UI 发布的 Helm overlay values

## 5. 我已经准备好的脚本

脚本放在这里：

- [redeploy-ui-only.sh](d:/vscode/nv/ops/ui-only/redeploy-ui-only.sh)
- [import-images.sh](d:/vscode/nv/ops/ui-only/import-images.sh)
- [ui-only.env.example](d:/vscode/nv/ops/ui-only/ui-only.env.example)

### 5.1 `redeploy-ui-only.sh` 做什么

它负责：

1. 构建新的 `manager` 镜像。
2. 从现有稳定版本同步 `controller`、`enforcer`、`scanner`、`updater`。
3. 生成一份本次发布专用的 Helm overlay values。
4. 根据模式选择：
   - 推到私有仓库并 Helm 升级
   - 导出本地 tar 包并导入集群，再 Helm 升级
   - 只导出 tar 包，不执行部署

### 5.2 `import-images.sh` 做什么

它负责把镜像导入本地集群运行时，目前支持：

- `kind`
- `k3d`
- `minikube`

### 5.3 `ui-only.env.example` 做什么

它是一份环境变量模板，你后面只需要复制一份，填上：

- 你的源镜像版本
- 你的目标仓库地址
- 你的目标 tag
- 你的 namespace 和 release 名
- 你的基础 values 文件路径

## 6. 推荐使用方式

### 6.1 私有仓库模式

适合你的集群可以直接拉镜像仓库。

先复制环境文件，例如：

```bash
cp ./ops/ui-only/ui-only.env.example ./ops/ui-only/ui-only.env
```

然后调整其中这些值：

```text
DEPLOY_MODE=registry
TARGET_REGISTRY=registry.example.com
TARGET_REPO_PREFIX=nv
TARGET_TAG=5.5.0-ui.1
SOURCE_TAG=5.5.0
BASE_VALUES_FILE=/path/to/your/cluster-values.yaml
IMAGE_PULL_SECRET=regsecret
```

再执行：

```bash
ENV_FILE=/abs/path/to/ui-only.env ./ops/ui-only/redeploy-ui-only.sh
```

脚本会完成：

- 构建 `manager`
- 同步 `controller/enforcer/scanner/updater`
- 生成 overlay values
- `helm upgrade --install`

### 6.2 本地导入模式

适合 kind / k3d / minikube。

例如：

```text
DEPLOY_MODE=local-import
TARGET_REGISTRY=local
TARGET_REPO_PREFIX=nv
TARGET_TAG=5.5.0-ui.1
CLUSTER_TYPE=kind
KIND_CLUSTER_NAME=kind
BASE_VALUES_FILE=/path/to/your/cluster-values.yaml
```

执行同一条命令：

```bash
ENV_FILE=/abs/path/to/ui-only.env ./ops/ui-only/redeploy-ui-only.sh
```

脚本会额外做两件事：

- 导出镜像 tar 包到 `ops/ui-only/artifacts/<tag>/`
- 导入本地集群运行时

### 6.3 只导出镜像模式

如果你只是想先把镜像打好并导出归档，不马上部署：

```text
DEPLOY_MODE=export-only
```

这时脚本只会：

- 构建和同步镜像
- 导出 tar 包
- 不做 Helm 升级

## 7. 脚本生成的 Helm overlay 会帮你处理什么

脚本会自动生成一份这次 UI 发布专用的 Helm 覆盖文件，重点处理这些麻烦点：

- 全局 `registry`
- 全局 `tag`
- `controller/enforcer/manager` 的镜像路径
- `scanner/updater` 的镜像路径和 tag
- 本地导入模式下的 `imagePullPolicy: IfNotPresent`
- 容器运行时类型
- 可选 `runtimePath`

这意味着你不用每次手工改一堆 values。

## 8. 这套脚本的适用边界

它适合：

- 只改 UI，不改 API 契约
- 已经有稳定运行版本，想快速做一轮 UI 迭代部署
- 本地测试集群或可访问私有仓库的环境

它不直接覆盖这些场景：

- 你要同时改 manager 前端、manager 服务端、controller API
- 你要做全离线首次安装
- 你要做多架构正式产线发布

这些场景不是不能做，而是流程要再扩展一层。

## 9. 如果后续真的只改 UI，我建议的执行顺序

最实用的顺序是：

1. 先只在 `manager/admin/webapp/websrc/` 内做 UI 设计和页面调整。
2. 不要在第一轮就碰 Scala 服务端或 controller。
3. 用一版新的统一 tag，例如 `5.5.0-ui.1`。
4. 用脚本生成一套“UI 发布包”。
5. 先部署到测试集群验证页面。
6. 页面确认稳定后，再决定要不要继续动 manager 服务端或 controller。

这样做的最大好处是：

- 风险收敛
- 问题定位更清楚
- 回滚更容易

## 10. 当前最值得记住的结论

最后把最重要的话压成 5 条：

1. 大改 UI 但不动后端，主战场是 `manager/admin/webapp/websrc/`。
2. 只改前端，最终上线时仍然要重打整个 `manager` 镜像。
3. Helm 当前会让 `manager/controller/enforcer` 共用全局 `tag`，所以部署时不能只盯着 manager。
4. 本地导入模式下，`scanner` 的 `imagePullPolicy` 必须一并处理，否则它会继续尝试远端拉取。
5. 这次我已经把脚本放好了，后面你要开始真的改 UI 时，我们只需要把环境变量填好，再按你的集群类型跑一遍就行。

后续如果你愿意，我下一步可以继续把这件事再往前推一步，补一份更偏设计施工的文档：

- 哪些前端页面模块最适合先下手
- 页面级改造时怎么尽量不碰后端契约
- UI 改造后的验证清单应该怎么列
