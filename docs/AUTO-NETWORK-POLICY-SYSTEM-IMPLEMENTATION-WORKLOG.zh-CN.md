# MicroSegX 自动网络策略系统实现工作日志

本文档记录本轮自动网络策略系统改造中的实际实现路径、偏差决策、调试结论与后续注意事项。

## 2026-04-22

### 已确认的仓库接入点

- 连接入口：`microsegx/controller/cache/connect.go`
- learned 主链：`microsegx/controller/cache/learn.go`
- 策略编译：`microsegx/controller/cache/policy.go`
- watcher 分发：`microsegx/controller/cache/object.go`
- 初始化顺序：`microsegx/controller/cache/cache.go`
- 通用策略 REST：`microsegx/controller/rest/policy.go`

### 第一批实现约定

- 自动规则本体继续复用 `CLUSPolicyRule`
- 自动规则分类继续使用独立 metadata
- `AUTO_POLICY_MODE` 仍以环境变量为准，不做运行时热切换
- `auto metadata` 先通过独立 KV key 持久化，再由 watcher 回填 cache

### 当前实现偏差记录

- `FQDN` 已在观测事件中保留，但第一版不会把它编码进 `CLUSPolicyRule`
  - 原因：现有规则本体与编译链没有对应字段
  - 处理：仅用于状态展示和异常判定扩展，不进入规则匹配条件

- 第一版的 port 型 feature 先以 `group pair + proto` 维度聚合端口集合
  - 原因：需要优先保证窗口聚合、评分、生命周期和 KV/编译闭环稳定
  - 处理：规则输出阶段做端口范围归并，避免旧 `learnAppPort()` 的 `any` 退化路径
  - 影响：粒度比设计文档中的最细版本更保守，但仍显著优于旧即时学习链路

### 本轮已落地模块

- `share/clus_apis.go`
  - 新增 `CFGEndpointAutoPolicy`
  - 新增 auto policy metadata key 与类型定义

- `controller/cache`
  - 新增 auto policy 类型、store、observer、engine、periodic、anomaly、compile、status、test
  - `cache.Init()` 已提前执行 `autoPolicyInit()`
  - `UpdateConnections()` 已接入 `observeAutoPolicyEvent()`
  - `learnAppPort()/unlearnAppPort()` 在 `shadow/enforce` 下已停用即时学习
  - `SyncLearnedPolicyFromCluster()` / graph hot-sync 已加入 auto rule 过滤
  - `calculateIPPolicyFromCache()` 已按 `federal -> ground -> auto anomaly -> user -> auto periodic -> auto baseline -> legacy learned` 分桶编译

- `controller/rest`
  - 新增 `/v1/policy/auto/status`
  - 新增 `/v1/policy/auto/rule`
  - 新增 `/v1/policy/auto/rule/:id`
  - 已阻止通用 `/v1/policy/rule*` 修改或删除 auto rule

### 第二轮补强内容

- 状态接口已从“只返回计数”扩展为“返回候选特征明细”
  - `GET /v1/policy/auto/status` 现在会附带 `candidates`
  - 每个 candidate 包含：
    - `from / to / ip_proto / application`
    - `ports / fqdns`
    - `class / confidence / reason_codes`
    - `distinct_days / consecutive_windows / total_windows`
    - `baseline_score / periodic_score / anomaly_score`

- `FQDN` 不再只停留在观测事件切片中
  - 已同步保存在 feature state
  - 可通过状态接口看到某个候选流量关联过的 `FQDN` 集合
  - 仍然不进入 `CLUSPolicyRule` 本体，避免破坏现有编译链

- 新增本地演示脚本：
  - `microsegx/tools/auto_policy_status.sh`
  - 作用：
    - 拉取 `/v1/policy/auto/status`
    - 拉取 `/v1/policy/auto/rule`
    - 在有 `jq` 时输出更适合答辩和实验记录的摘要视图
  - 相关环境变量：
    - `AUTO_POLICY_API_BASE`
    - `AUTO_POLICY_TOKEN`
    - `AUTO_POLICY_INSECURE`

### 已验证结果

- `go test ./controller/cache ./controller/rest` 通过
- `go test ./controller/...` 通过
- `go test ./...` 通过
- 第二轮补强后再次执行：
  - `bash -n microsegx/tools/auto_policy_status.sh` 通过
  - `go test ./controller/cache ./controller/rest` 通过
  - `go test ./...` 通过

## 2026-04-23

### 前端接入完成情况

- 管理台新增自动策略工作台：
  - 路径：`/microsegx/auto-policy`
  - 位置：`manager/admin/webapp/websrc/app/routes/microsegx-auto-policy/`
- 首页 Dashboard 已增加 auto-policy 卡片
- `network-rules` 已增加 auto rule 来源/分类/详情联动
- `network-activities` 已增加 auto-policy inspector
- i18n 已补齐中英文文案

### 后端契约补齐情况

- 新增：
  - `GET /v1/policy/auto/feature`
  - `GET /v1/policy/auto/event`
- `status/rule/:id` 已补充更多前端展示所需字段：
  - pending promotion 计数
  - compile state
  - ttl remaining seconds
  - periodic slot summary
  - score 与候选阶段信息

### 打包与部署阶段新增修正

- `ops/full-release/deploy-core.sh`
  - 已接入 `AUTO_POLICY_*` 环境变量到 controller deployment
  - 已增加 Helm 4 `--force-conflicts`
  - 原因：
    - 当前集群里部分对象曾被 `kubectl set` / `upgrader` 修改过 managed fields
    - 直接 `helm upgrade` 会因 server-side apply 冲突失败

- `k8s-node-surface` stack installer
  - 发现问题：
    - installer Job 在已有 `OpenZiti + port-audit` 环境中仍默认强制重装
    - 在线 Helm repo 在 Job 容器里不可达时会直接失败
  - 已修正：
    - `run-stack-installer-image.sh` 默认 `PORT_AUDIT_APPLY_MANIFEST=auto`
    - `deploy-port-audit-ziti-stack.sh` 新增“复用现有 OpenZiti 部署”逻辑
    - installer manifest 默认值改为 `auto`
  - 结果：
    - 本地 `k3s` 重新执行 installer 时会优先复用现有 `ziti-controller / ziti-router / k8s-port-audit`
    - 仅补齐 `port-audit-ziti-host`、Ziti identity、terminator 等接入资源

### 本次真实交付产物

- 本地 bundle 目录：
  - `artifacts/microsegx-local/2026.04.05-microsegx-r1`
- 本地 bundle 压缩包：
  - `artifacts/microsegx-local/microsegx-local-2026.04.05-microsegx-r1.tar.gz`
- 当前压缩包 SHA256：
  - `b07af3afe51a1bf87d2805f1c5c2b7f57db88c88865db0c23f60bfaad47fadc5`

### 本次真实部署结果

- `microsegx` 新 Pod 已切到：
  - `local.microsegx/nv/controller:2026.04.05-microsegx-r1`
  - `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
  - `local.microsegx/nv/enforcer:2026.04.05-microsegx-r1`
  - `local.microsegx/nv/scanner:2026.04.05-microsegx-scanner-r1`
- controller 已加载：
  - `AUTO_POLICY_MODE=shadow`
  - `AUTO_POLICY_WINDOW_SECONDS=5`
  - `AUTO_POLICY_SLOT_MINUTES=1`
  - `AUTO_POLICY_DISTINCT_DAY_DURATION=60s`
  - `AUTO_POLICY_TTL_CHECK_SECONDS=60`
- `OpenZiti` 与 `port-audit` 现网资源保持运行
- 新增 `port-audit-ziti-host` 已成功上线
- installer Job 已成功跑完并验证：
  - `port-audit host identity online`
  - `port-audit service terminator ready`

### 本轮零信任与网页修复补充

- `k8s-node-surface/k8s_port_audit/api/ziti_admin.py`
  - 修正 `resolve_default_controller_url()` 优先级
  - 当显式设置 `ZITI_DEFAULT_CONTROLLER_URL` 时，优先返回该值，不再被集群内 service FQDN 覆盖
  - 目的：
    - 保持网页、manager 代理和 `port-audit` 后端看到的 controller URL 一致
    - 避免重复部署 `ziti-router` 时出现 controller URL 不一致导致的异常重注册/重入网问题

- `manager/admin/webapp/websrc/app/routes/microsegx-ziti/*`
  - 新增 `embedded` 模式
  - 零信任界面在“端口暴露与零信任”页中以内嵌工作区形态呈现
  - 不再依赖单独侧栏入口

- `manager/admin/webapp/websrc/assets/i18n/zh_cn-common.json`
  - 补齐 `MicroSegX` 板块下多处中文文案
  - 包括：
    - Service type
    - 资源类型
    - Ziti identity/router 字段
    - selector / tags / hosting cost / precedence 等

- `manager/admin/src/main/scala/com/microsegx/service/microsegx/MicrosegxService.scala`
  - 忽略 manager 代理回包中的 `content-type / date / server`
  - 目的：
    - 消除代理 `/microsegx/api/ziti/*` 时的 `illegal RawHeader` 噪声告警

- `manager/admin/src/main/scala/com/microsegx/service/authentication/SuseAuthService.scala`
  - 修正登录入口对坏 JSON 请求体的错误处理
  - 之前：
    - 非法 JSON 会落到统一异常处理，前端看到 `500 Internal Server Error`
  - 现在：
    - 非法 JSON 稳定返回 `400 Bad Request`
    - 正常登录流程不受影响

### 本轮重新部署后的实测结论

- 重新执行：
  - `bash ops/microsegx-local/build-and-package.sh ops/full-release/full-release.env`
  - `bash ops/microsegx-local/deploy-local.sh ops/full-release/full-release.env`

- `OpenZiti` 当前运行状态：
  - `ziti-controller` 为 `Running`
  - `ziti-router` 为 `Running`
  - `openziti-stack-installer` Job 可重复成功执行

- `port-audit` 当前运行状态：
  - `k8s-port-audit` 为 `Running`
  - `port-audit-ziti-host` 为 `Running`
  - installer 日志确认：
    - `reuse existing OpenZiti deployment`
    - `port-audit host identity online: ready`
    - `port-audit service terminator: ready`

- manager 真实链路验证：
  - 用 `uiverify / MxVerify-2026-04-14!Aa9` 登录成功
  - `GET /microsegx/overview` 返回成功
  - `POST /microsegx/api/ziti/login` 返回成功
  - `GET /microsegx/api/ziti/session` 返回：
    - `logged_in = true`
    - `default_controller_url = https://192.168.198.128:31280`

- 登录异常路径验证：
  - 对 `/auth` 提交坏 JSON
  - 结果已从 `500` 修正为 `400`

## 2026-04-24 前端收尾、单节点 k3s 恢复与零信任重部署闭环

### 用户侧问题对应修复

- 网络规则页：
  - 将“添加到顶端”按钮移到固定 action 区，不再因为勾选 auto rule 或 selection action 出现/消失而左右跳动
  - 打开 AG Grid 表头自动换行与自动表头高度，补齐 auto policy 相关列的最小宽度，解决表头字段显示不全

- WAF 检测器：
  - 为添加/编辑规则模态框增加纵向滚动
  - 底部 action 区改为 sticky，避免表单太长时看不到“添加/保存”按钮

- 策略 > 主机页：
  - 调整主机名列宽、开启自动换行和 tooltip，长主机名不再被硬截断

- 自动策略工作台：
  - 将 hero 区背景从深色改为浅色渐变
  - 重新设计“刷新 / 查看网络规则页 / 查看网络活动页”按钮样式，使其与现有管理台视觉更一致

- 端口暴露与零信任页面：
  - 改为使用 `location.replaceState` 同步 query 参数，点击零信任工作区时不再把页面滚回顶部

- 认证与超时拦截：
  - `auth.interceptor` 不再因为后台轮询请求缺 token 就立即跳 `/login`
  - `timeout.interceptor` 对 `summary / fed/member / microsegx/overview` 等后台请求的 `401/408/503` 改为“非阻塞处理”
  - 目的：
    - 降低控制台反复出现的 `/login` 跳转噪声
    - 避免首页和 MicroSegX 工作台因为后台请求瞬时异常被误判成整站掉线

### 单节点 k3s 故障处置

- 发现问题：
  - 节点进入 `DiskPressure=True`
  - `microsegx-controller / manager / scanner` 持续被 `Evicted`
  - `openziti / port-audit` 也连带无法调度

- 现场处置：
  - 清理旧 full-release 产物、`.artifacts/k3s-auto-import` 中间文件和 `~/.cache/go-build`
  - 删除大量 `Failed / Succeeded / Evicted` Pod，停止无意义抖动
  - 磁盘从约 `12G free` 恢复到约 `20G free`
  - 结合 kubelet `stats/summary` 与 `configz` 确认：
    - 实际可用空间已恢复
    - `DiskPressure` 持续的原因是 `evictionMinimumReclaim=10%` 和 `evictionPressureTransitionPeriod=5m`

- 结果：
  - 节点状态已恢复为 `DiskPressure=False`
  - 随后重新执行正式的本地镜像导入和 `deploy-core.sh`
  - `microsegx-controller / manager / enforcer / scanner` 已重新全部恢复为 `Running`

### Scanner 接入恢复

- 已确认 controller service 持续暴露：
  - `18300`
  - `18301`
  - `18400`

- scanner 当前日志确认：
  - scanner GRPC server 正常启动
  - controller 已收到 `ScannerRegisterStream`
  - `scannerRegister` 成功，scanner 恢复注册

### 零信任与端口暴露链路修复补充

- `k8s-port-audit` 运行态修复：
  - 补导入本地 `k8s-port-audit` 镜像
  - 恢复 `k8s-port-audit` deployment 到 `Running`

- `ziti-router` 恢复：
  - 使用本地离线 chart 直接重新安装 `ziti-router`
  - 当前 `ziti-controller / ziti-router` 均为 `Running`

- stack installer 新问题定位：
  - 之前 installer Job 会在安装 `ziti-router` 时临时访问 GitHub 下载 chart
  - 实际失败点不是逻辑错误，而是：
    - `read ... github.com ... connection reset by peer`

- 离线闭环修复：
  - `k8s-node-surface/Dockerfile.stack`
  - `k8s-node-surface/Dockerfile.stack.refresh`
    - 新增复制 `charts/` 目录到 stack installer 镜像
  - `k8s-node-surface/scripts/build-stack-image-bundle.sh`
    - 构建 stack 镜像时自动从 `openziti/dist/.../charts` 发现并打包本地 Helm chart
  - `k8s-node-surface/scripts/deploy-openziti-k3s.sh`
    - 新增 `CHARTS_DIR` / `find_chart_archive()` / `chart_version_args()`
    - cert-manager / trust-manager / ziti-controller / ziti-router 优先使用本地 `.tgz` chart
    - 本地 chart 缺失时才退回公网 Helm repo

- 最终验证：
  - 重新构建 stack image bundle
  - 重新导入 `local/k8s-port-audit-stack:0.2.2`
  - 重新执行 `openziti-stack-installer` Job
  - Job 成功 `Completed`
  - 日志确认：
    - `reuse existing OpenZiti deployment`
    - `port-audit host identity online: ready`
    - `port-audit service terminator: ready`

### 当前集群最终状态

- `microsegx`
  - controller: `Running`
  - manager: `Running`
  - enforcer: `Running`
  - scanner: `Running`

- `openziti`
  - ziti-controller: `Running`
  - ziti-router: `Running`

- `port-audit`
  - k8s-port-audit: `Running`
  - port-audit-ziti-host: `Running`

### 本轮额外验证

- 前端生产构建：
  - `npm run build`
  - 结果：通过
  - 仅保留既有样式体积 warning：
    - `microsegx-port-exposure.component.scss`
    - `microsegx-ziti.component.scss`

- manager WebUI service：
  - `microsegx-service-webui` 处于正常服务状态
  - 当前 service port：`8443`

## 2026-04-24 前端收口补丁与最终重部署

### 这轮继续修复的用户可见问题

- 网络规则页：
  - 将“添加到顶端”按钮从“随选择动作一起流动”的区域拆出，固定到工具栏持久动作区
  - 补强表头换行和列宽策略，解决 auto policy 相关表头显示不全

- WAF 检测器：
  - `Add/Edit Rule` 模态框新增纵向滚动
  - 底部操作区改成 sticky，长表单时依然能看到提交按钮

- 策略 > 主机页：
  - 主机名列改为更宽、更高容纳、支持换行与 tooltip
  - 解决长主机名被直接截断的问题

- 自动策略页：
  - 调浅 hero 背景和整体配色
  - 将“查看网络规则页 / 查看网络活动页”按钮改为更接近现有站点风格的轻量按钮

- 端口暴露与零信任：
  - 切换 `summary / ziti` 工作区时，不再通过 router query 导航触发页面回顶
  - 改为 `Location.replaceState()` 原地更新 URL

- 鉴权噪声：
  - 进一步收口 `timeout.interceptor` 中对后台非阻塞 401/408/503 的控制台报错输出
  - 这一步是在前面“停止强制跳 `/login`”的基础上继续做的体验收口

### 这轮最终验证

- 重新执行：
  - `bash ops/microsegx-local/build-and-package.sh ops/full-release/full-release.env`
  - `bash ops/microsegx-local/deploy-local.sh ops/full-release/full-release.env`

- 重新部署后当前状态：
  - `microsegx-controller / manager / enforcer / scanner` 全部 `Running`
  - `ziti-controller / ziti-router` 全部 `Running`
  - `k8s-port-audit / port-audit-ziti-host` 全部 `Running`
  - `openziti-stack-installer` 本轮重新执行后再次 `Completed`

- 可达性抽查：
  - manager WebUI HTTPS 入口可响应
  - `http://192.168.198.128:18080/` 可返回端口暴露页面 HTML
  - `http://192.168.198.128:18080/ziti/` 可返回零信任页面 HTML

- 前端构建：
  - 重新执行 `npm run build`
  - 通过，最终 hash：
    - `d00a5d49267be1ec`
  - 仍只有既有 SCSS budget warning，没有新增构建错误

## 2026-04-24 自动策略统计口径与零信任提示修复

### 修复背景

- 用户反馈自动策略详情中的：
  - `连续窗口数`
  - `历史窗口数`
  - `观察天数`
  - `工作负载覆盖率`
  看起来不可信。
- 排查结论：
  - 当前实验环境启用了时间加速，`AUTO_POLICY_DISTINCT_DAY_DURATION=60s` 时，“观察天数”实际是“观察周期数”，不是自然日。
  - 候选特征状态之前没有 retention，导致 `TotalWindows / DistinctDays / SlotCounters` 会随 controller 运行时间持续累积。
  - 覆盖率只返回百分比，且源组规模缺失时后端按 `1` 兜底，容易出现“100% 但实际只是估算”的误解。
  - OpenZiti 连通并不代表 NodePort / LoadBalancer / Ingress / 主机监听已经关闭，端口暴露页缺少这个关键提示。

### 本轮代码修复

- 后端自动策略：
  - 新增 `FeatureRetentionDuration`
  - 新增环境变量 `AUTO_POLICY_FEATURE_RETENTION_SECONDS`
  - 默认候选特征保留 `14 * AUTO_POLICY_DISTINCT_DAY_DURATION`
  - 窗口处理和 aging ticker 会清理过期候选特征，避免统计无限增长
  - REST feature/candidate 增加：
    - `source_workload_count`
    - `source_group_size`
    - `source_group_size_estimated`
  - REST status 增加：
    - `feature_retention_seconds`

- 前端自动策略页：
  - 将“连续窗口数”改为“连续观察窗口”
  - 将“历史窗口数”改为“保留期内命中窗口”
  - 将“观察天数”改为“观察周期数”
  - 显示：
    - 每个观察窗口时长
    - 实验时间口径或自然日口径
    - 候选特征保留时长
    - 工作负载覆盖率的分子/分母，例如 `50% (1/2)`
  - 源组规模为兜底估算时，显示“组规模暂按 1 估算”

- 端口暴露与零信任页：
  - 在内嵌零信任工作区顶部增加提示：
    - OpenZiti 服务发布成功不等于直接暴露入口已经关闭
    - 仍需关闭对应 NodePort / LoadBalancer / Ingress / 主机监听才能完成暴露面收敛

### 本轮验证

- `jq empty manager/admin/webapp/websrc/assets/i18n/zh_cn-common.json manager/admin/webapp/websrc/assets/i18n/en-common.json`
  - 通过
- `go test ./controller/cache -run 'TestAutoPolicy|TestBuildMergedPorts|TestCompileActiveAutoRulesOrdering|TestGetAutoPolicyStatusIncludesCandidates|TestCleanupAutoPolicyFeatureStates'`
  - 通过
- `go test ./controller/rest -run '^$'`
  - 通过
- `go test ./controller/api ./controller/cache -run '^$'`
  - 通过
- `cd manager/admin/webapp && npm run prebuild && npx ng build --configuration production`
  - 通过
  - 构建 hash：`d764d5100243d623`
  - 仍只有既有 SCSS budget warning：
    - `microsegx-port-exposure.component.scss`
    - `microsegx-ziti.component.scss`

### 本轮重新打包与部署

- 执行：
  - `bash ops/microsegx-local/build-and-package.sh ops/full-release/full-release.env`
  - `bash ops/microsegx-local/deploy-local.sh ops/full-release/full-release.env`
- 部署脚本完成后，因镜像 tag 未变化且 controller Deployment 模板未变化，controller 没有自动滚动；已手动执行：
  - `kubectl rollout restart deployment/microsegx-controller-pod -n microsegx`
  - `kubectl rollout status deployment/microsegx-controller-pod -n microsegx --timeout=240s`
- enforcer 已手动滚动一次，用于刷新部署后的内部证书状态：
  - `kubectl rollout restart daemonset/microsegx-enforcer-pod -n microsegx`

### 当前部署状态

- `microsegx`
  - controller: `Running`
  - manager: `Running`
  - enforcer: `Running`
  - scanner: `Running`
- `openziti`
  - ziti-controller: `Running`
  - ziti-router: `Running`
- `port-audit`
  - k8s-port-audit: `Running`
  - port-audit-ziti-host: `Running`

### 部署后注意事项

- 本轮 Helm 升级触发的 `microsegx-cert-upgrader-job` 卡在等待 enforcer 采用 secret revision。
- controller / manager / enforcer / scanner 都已正常运行，enforcer 日志显示已重新连接 DP 和 controller。
- 为避免 `kubectl get pods` 中长期显示误导性的 `Running/Error` 升级 Job，本轮已清理该 Job 及其 Pod。
- 这不是本轮自动策略修复引入的问题，更像是本地 Helm 重复升级时内部证书轮换 Job 的边界问题；后续如果要彻底收口，建议单独把本地部署脚本的证书轮换策略改成“仅首次安装启用或升级后非阻塞清理”。

---

## 2026-04-24 零信任 `NO_EDGE_ROUTERS_AVAILABLE` 修复记录

### 现象

- Windows Ziti 客户端访问 `mc-service` 时 controller 返回：
  - `NO_EDGE_ROUTERS_AVAILABLE`
  - `ziti edge router is not available`
- `ziti-router` Pod 已经 Running，但 `mc-service` 仍不可 Dial。

### 根因

- `mc-service` 只有 Dial service-policy：
  - `#mc-client -> @mc-service`
- 缺少让 router 承载该服务的策略：
  - `Bind` service-policy
  - `service-edge-router-policy`
  - 面向 dial 身份的 `edge-router-policy`
- router 日志中可以看到 `mc-service access.gained` 后立刻 `access.removed`，controller 曾报：
  - `invalid service`
  - `invalid edge router for session`
- 这说明问题不是简单的端口网络不通，而是 Ziti 控制面策略和 router hosted-service session 状态不一致。

### 现场修复

- 为 `mc-service` 创建了三条策略：
  - `msx-bind-mc-service-ziti-router`
  - `msx-erp-mc-service-ziti-router`
  - `msx-serp-mc-service-ziti-router`
- 重启 `ziti-router` Deployment，使 router 重新订阅数据模型并创建 tunnel terminator。
- 验证结果：
  - `ziti edge policy-advisor services mc-service` 显示 `mc-client -> mc-service` 为 `OKAY`
  - `ziti edge list terminators` 中已出现 `mc-service` 的 `tunnel` terminator

### 代码修复

- `k8s-node-surface/k8s_port_audit/api/ziti_service_router.py`
  - 挂载 service 到 router 时，策略 selector 同时写入：
    - 直接对象 selector：`@router-id`
    - 稳定 role selector：`#router-ziti-router`
  - Bind policy 同时写入：
    - `@router-identity-id`
    - `#router-host-ziti-router`
  - edge-router-policy 不再只依赖 Dial policy 反推身份，也会包含 router host 身份，避免 hosted service session 缺少可用 router。
  - 若策略创建后 terminator 超时未出现，会自动重启对应 router workload 并再次等待。
- `k8s-node-surface/k8s_port_audit/api/ziti_router_k8s.py`
  - 新增 `restart_router_workload()`，通过 patch Deployment pod template annotation 触发 router rollout。

### 部署方式

- 由于当前机器无免密 `sudo`，无法把新镜像导入 k3s containerd。
- 本轮采用 ConfigMap 热修方式部署到 `port-audit/k8s-port-audit`：
  - `k8s-port-audit-ziti-hotfix`
  - 通过 `subPath` 覆盖：
    - `/opt/k8s-node-surface/k8s_port_audit/api/ziti_service_router.py`
    - `/opt/k8s-node-surface/k8s_port_audit/api/ziti_router_k8s.py`
- Deployment 已 rollout 完成，当前 `k8s-port-audit` Pod 为 Running。

### 验证

- `python3 -m py_compile`
  - 通过
- `POST /api/ziti/services/6wThGATcN3yHSjfbfvZ2Rv/attach-router`
  - 返回已有 `mc-service` terminator
  - 返回的策略包含 `@KuGsDMhDj` 与 `#router-ziti-router`
- 后续补测发现旧实现的 stale policy 清理顺序存在风险：
  - 使用更新前列表判断 stale，可能把刚 patch 的同名 managed policy 误删
  - 已改为更新后重新拉取 policy 列表，并通过当前 policy id 排除误删
- 已重新挂载并验证：
  - `port-service`
  - `nginx-service`
  - `mc-service`
- `ziti edge policy-advisor services ...`
  - 三个服务均为 `OKAY`
- `ziti edge list terminators`
  - 三个服务均存在 terminator
- `openziti`
  - `ziti-controller`: Running
  - `ziti-router`: Running
- `port-audit`
  - `k8s-port-audit`: Running

---

## 2026-04-24 零信任前端按钮与部署固化记录

### 后端固化

- 已重新构建 `k8s-node-surface` stack 镜像：
  - `local/k8s-port-audit-stack:0.2.2`
- 已导入 k3s containerd，并从 `port-audit/k8s-port-audit` Deployment 中移除上一轮临时 ConfigMap 热修挂载。
- 当前 `k8s-port-audit` 只保留正式配置挂载：
  - `scanner-config`
  - `host-proc`
- 验证：
  - Pod 内 `ziti_service_router.py` / `ziti_router_k8s.py` `py_compile` 通过
  - `ziti edge policy-advisor services mc-service` 显示 `mc-client -> mc-service` 与 `ziti-router -> mc-service` 均为 `OKAY`
  - `ziti edge list terminators` 中存在 `mc-service`、`nginx-service`、`port-service` 的 terminator
  - `openziti/ziti-router` 与 `openziti/ziti-controller` 均为 `Running`

### 前端按钮逻辑修复

- `microsegx-ziti`
  - 所有 `<button>` 显式补齐 `type="button"`，避免默认 submit 行为造成意外跳转或页面回顶。
  - “挂到 Router”只允许选择已经部署到 Kubernetes 的 router；没有可用 router 时按钮禁用并提示先部署 router。
  - 系统自动维护的 OpenZiti policy 禁止编辑和删除，避免破坏 MicroSegX 自动生成的 Dial / Bind / ERP / SERP 策略闭环。
  - 服务挂载请求等待时间从 `20s` 提升到 `45s`，匹配后端可能触发 router restart 和 terminator 建立的耗时。
  - 弹窗请求执行中禁止通过遮罩或取消按钮关闭，避免请求仍在执行时 UI 状态被重置。
- `microsegx-port-exposure`
  - 所有页面按钮补齐 `type="button"`。
  - 端口暴露页面切换“扫描摘要 / 零信任”附加工作区时保留当前滚动位置，避免点击零信任按钮后页面跳回顶部。

### 前端打包与部署

- 已执行：
  - `npm run build`
- 构建通过：
  - Hash: `71a146f3eeab8c23`
  - 仅保留既有 SCSS budget warning：
    - `microsegx-port-exposure.component.scss`
    - `microsegx-ziti.component.scss`
- 已用当前 `manager/admin/webapp/root` 更新 `manager/admin/target/scala-3.3.5/admin-assembly-1.0.jar` 中的 `root/*` 前端资源。
- 已基于本地 manager 镜像重新打包：
  - `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
- 首次替换 JAR 后发现镜像缺少 `manager` 用户映射，containerd 报：
  - `no users found`
- 已在镜像中补齐 `manager:x:1000:1000` 用户和组后重新导入 k3s。
- 已滚动重启：
  - `microsegx-manager-pod`
- 验证：
  - `microsegx-manager-pod`: Running
  - 运行中 manager JAR 已包含新的 `root/1040.48de7c5be283985c.js`、`root/9423.f750b8e8e02a2c11.js` 和 `root/main.90394d379fbd5037.js`
  - 通过 WebUI ClusterIP 拉取 lazy chunk 返回 `200`，gzip 解压后 hash 与本地构建产物一致
  - manager Pod 内访问 `http://192.168.198.128:18080/api/ziti/overview` 正常返回：
    - routers: `1`
    - workloads: `1`
    - services: `4`
    - terminators: `4`

### 追加修复：零信任操作按钮消失

- 现象：
  - 零信任页面能展示概览数据，但 Router / Service / Identity / Config / Policy 的操作按钮整组消失。
- 根因：
  - 前端按钮统一受 `canMutate` 控制。
  - 当前页面能通过后端 CLI fallback 读到概览，但 session 接口返回 `logged_in=false`，前端认为是只读态，因此隐藏全部操作按钮。
  - manager 代理场景下即使后端有默认 Ziti 凭据，也不能只依赖浏览器 cookie/session 判断是否可操作。
- 后端修复：
  - `port-audit` 在配置了默认 Ziti controller 凭据时，会自动创建 API session。
  - `/api/ziti/session` 在无 cookie 时会尝试默认凭据登录并返回 `logged_in=true`。
  - OpenZiti 变更类 API 在缺少 session cookie 时，也会使用默认凭据自动创建可变更 session。
  - `/api/ziti/overview` 优先走 API session；只有 API session 不可用时才 fallback 到 CLI 只读模式。
- 前端修复：
  - `canMutate` 不再只依赖 `logged_in=true`。
  - 只要默认凭据已配置、已有非只读 overview 数据，且不是 read-only session，就显示操作按钮。
- 部署：
  - 已重新构建并导入 `local/k8s-port-audit-stack:0.2.2`
  - 已 rollout `port-audit/k8s-port-audit`
  - 已重新执行前端 `npm run build`
  - 已更新 manager JAR、重建并导入 `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
  - 已 rollout `microsegx-manager-pod`
- 验证：
  - `http://192.168.198.128:18080/api/ziti/session`
    - `logged_in=true`
    - `auth_mode=api`
  - `http://192.168.198.128:18080/api/ziti/overview`
    - `read_only=false`
    - `routers=1`
  - `microsegx-manager-pod`、`k8s-port-audit`、`ziti-controller`、`ziti-router` 均为 `Running`

## 2026-04-24：自动策略模式切换、系统流量隔离与网络活动首击渲染修复

### 后端修复

- 新增自动策略运行模式更新接口：
  - `PATCH /v1/policy/auto/config`
  - 请求体为 `{"config":{"mode":"legacy|shadow|enforce"}}`
- 模式含义：
  - `legacy`：恢复旧 learned 即时学习；自动策略不观察、不生成、不注入。
  - `shadow`：只观察、评分和展示候选；不写入自动规则。
  - `enforce`：自动策略写入 learned 规则并参与策略编译下发。
- 模式配置持久化到：
  - `config/auto_policy/engine`
- controller 启动流程：
  - 先读取环境变量默认值。
  - 再读取 `config/auto_policy/engine`，若存在合法模式则覆盖环境变量。
  - 因此 Web 页面切换后的模式可跨 controller 重启保留。
- 编译阶段调整：
  - 只有 `enforce` 模式才会把带 auto metadata 的自动规则注入运行时策略。
  - `legacy/shadow` 下即使 KV 中已有自动规则，也不会参与编译下发。
- 系统流量隔离：
  - 自动策略 observer 跳过 MicroSegX、OpenZiti、port-audit、kube-system、cert-manager 等系统命名空间。
  - 若 group/workload 名称明显属于 `microsegx-*`、`ziti-controller`、`ziti-router`、`port-audit`，也不会进入自动策略候选。
  - 编译阶段再次跳过这些受保护 group 的自动规则，防止历史自动规则影响管理面。

### 前端修复

- 自动策略工作台新增“运行模式”切换控件：
  - 旧版即时学习
  - 影子观察
  - 正式生效
- 自动策略页面的周期/活跃槽显示从裸数字改为解释性文本：
  - 实验时间口径下显示为“第 N 个实验周期”。
  - 自然时间口径下显示为“周期第 N 天 HH:mm-HH:mm”。
- 网络活动页边点击详情首击不渲染：
  - 将 G6 图事件触发后的状态更新放回 Angular zone。
  - 会话详情返回后显式触发视图检测。
  - 目标是避免第一次点击实际状态已更新、但 Angular 视图未立即刷新。

### 构建与部署

- 后端验证：
  - `go test ./controller/cache ./controller/rest` 通过。
- 前端验证：
  - `npm run build` 通过。
  - 仅保留既有 SCSS budget warning：
    - `microsegx-port-exposure.component.scss`
    - `microsegx-ziti.component.scss`
- 已重建：
  - `microsegx/controller/controller`
  - `manager/admin/target/scala-3.3.5/admin-assembly-1.0.jar`
  - `local.microsegx/nv/controller:2026.04.05-microsegx-r1`
  - `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
- 已导入 k3s containerd：
  - controller 镜像 digest：`sha256:1d7b4ded98827beb8736889d54de62572ea87b6ac3854dab964ae995acd2ee95`
  - manager 镜像 digest：`sha256:cedb9ff6bef98dce85401a973bb2b43d9fdd03d9d74c9fbfdcbaa8abdc7b8e17`
- 已滚动重启并验证：
  - `microsegx-controller-pod`: Running
  - `microsegx-manager-pod`: Running
  - `microsegx-enforcer-pod`: Running
  - `microsegx-scanner-pod`: Running
  - `ziti-controller`: Running
  - `ziti-router`: Running
  - `k8s-port-audit`: Running

## 2026-04-24：移除页面旧版模式入口并修复 enforcer/scanner 重新接入

### 调整内容

- 自动策略页面不再暴露“旧版即时学习”切换按钮。
  - 页面仅保留“影子观察”和“正式生效”两个可操作模式。
  - 后端 `legacy` 逻辑仍保留为环境变量/配置回滚能力，不作为日常页面操作入口。
- 更新自动策略页面中英文提示：
  - 明确旧版即时学习只作为回滚路径保留。
  - 避免用户误以为需要在新版自动策略和旧 learned 流程之间频繁切换。

### 运行状态修复

- 发现 `enforcer` Pod 处于 Running，但内部未连上 controller：
  - 日志出现 `Controller endpoint is not ready`
  - 日志出现 `No known Consul servers`
  - 日志出现 `Failed to find ctrl client`
- 处理方式：
  - 滚动重启 `daemonset/microsegx-enforcer-pod`
  - 滚动重启 `deployment/microsegx-scanner-pod`
- 修复后验证：
  - controller 收到 enforcer join：
    - `connectAgentAdd`
    - `Agent join request accepted`
  - enforcer 进入 Ready：
    - `lead=10.42.0.50`
    - `GRPC server started`
    - `Ready ...`
  - scanner 重新注册完成：
    - `scannerRegister`
    - `ScannerRegisterStream receive done`
    - `CVE database written`

### 构建与部署

- 前端验证：
  - `npm run build -- --configuration production` 通过。
  - 仅有既有 SCSS budget warning。
- manager 打包：
  - `bash package/build_manager.sh` 通过。
  - Scala 仅有既有类型 warning。
- 镜像：
  - 已重建 `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
  - 已导入 k3s containerd
  - 本次 manager 镜像 digest：`sha256:f182386744781fd319851f8338c1cc811a9bf26aee4cc0be3e9b05dce8b2d454`
- 已 rollout：
  - `deployment/microsegx-manager-pod`

### 当前核心 Pod 状态

- `microsegx-controller-pod`: Running
- `microsegx-manager-pod`: Running
- `microsegx-enforcer-pod`: Running 且已重新接入 controller
- `microsegx-scanner-pod`: Running 且已重新注册 controller

## 2026-04-24：修复网络活动/自动策略页面空值渲染卡死

### 问题

- 浏览器控制台出现：
  - `TypeError: can't access property "from" of null`
- 触发场景：
  - 网络活动图中点击一条边时，前端会先清空上一条 `conversationDetail`，再异步加载新会话详情。
  - 清空瞬间弹窗状态仍可能处于边详情状态，模板直接访问 `conversationDetail.from`，导致 Angular 变更检测循环报错。
- 同类风险：
  - 自动策略页和网络活动里的自动策略检查器也存在 `rule.rule.from/action/ports` 直接访问，若后端返回空 rule 或详情加载中，会导致页面报错。

### 修复

- 网络活动边点击流程：
  - 点击新边时先退出旧弹窗状态，再清空旧会话详情。
  - 只有 `conversationDetail.from` 和 `conversationDetail.to` 都存在时才渲染边详情弹窗。
- 边详情组件：
  - 顶层增加会话对象完整性判断。
  - 标题、清理会话按钮、IP 单元格改为安全访问。
- 自动策略页面：
  - 规则列表和规则详情对 `rule` 本体增加空值保护。
- 网络活动自动策略检查器：
  - 对自动规则本体增加空值保护，避免半加载状态卡死。

### 构建与部署

- 前端构建：
  - `npm run build -- --configuration production` 通过。
  - 新 `network-activities` chunk：`7362.e71840be9dc2f185.js`
  - 新 `microsegx-auto-policy` chunk：`9423.e3ea40d802cd432d.js`
- manager 打包：
  - `bash package/build_manager.sh` 通过。
- 镜像：
  - 已重建并导入 `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
  - 本次 manager 镜像 digest：`sha256:890eab35e0789461fe542079afa93aece6282d19dd857b5e125e8696a5b01234`
- 已 rollout：
  - `deployment/microsegx-manager-pod`
- 当前状态：
  - `microsegx-manager-pod`: Running
  - manager 日志确认监听 `8443`

## 2026-04-25：系统保护规则、扫描兜底与完整部署复核

### 修复范围

- 网络活动边点击：
  - 增加边详情加载态与错误态。
  - 首次点击边时先显示加载提示，不再因为 `conversationDetail == nil` 卡死。
  - 如果后端暂时没有返回会话详情，会使用当前边的 source/target 作为兜底展示信息。
- 自动策略模式说明：
  - 前端文案明确 `shadow` 只观察评分，不写入/启用自动规则。
  - `enforce` 会把高置信自动规则写入 learned policy，并参与编译下发。
  - `legacy` 保留为环境变量回滚模式，不作为常规页面按钮。
- 系统自身通信保护：
  - 在策略编译阶段增加非持久化 system guard 规则。
  - 该规则保护 MicroSegX/OpenZiti/平台组件相关通信，不进入普通网络规则列表，也不会污染自动学习候选。
  - 业务流量仍按 shadow/enforce 模式继续观察、评分和自动生成规则。
- scanner 默认配置兜底：
  - 当 `default` vulnerability profile 缺失时，controller 会创建内存兜底并异步修复 KV。
  - 避免 scanner 已注册但 controller 持续报 `Vulnerability profile not found: default`。

### 验证

- 后端测试：
  - `go test ./controller/cache ./controller/rest` 通过。
- 前端构建：
  - `npm run build -- --configuration production` 通过。
- manager 打包：
  - `bash package/build_manager.sh` 通过。
- controller 编译：
  - `make` 通过。
- 镜像部署：
  - 已重建并导入 `local.microsegx/nv/controller:2026.04.05-microsegx-r1`
  - 已重建并导入 `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
  - 已确认 `local.microsegx/nv/enforcer:2026.04.05-microsegx-r1` 已导入 k3s
  - 已确认 `local.microsegx/nv/scanner:2026.04.05-microsegx-scanner-r1` 已导入 k3s

### 部署结果

- 当前主组件状态：
  - `microsegx-controller-pod`: Running 1/1
  - `microsegx-manager-pod`: Running 1/1
  - `microsegx-enforcer-pod`: Running 1/1
  - `microsegx-scanner-pod`: Running 1/1
- 节点状态：
  - `DiskPressure=False`
  - 已清理 Docker builder cache、旧镜像和旧离线 tar，避免再次因为磁盘压力导致 Pod Evicted。
- 接入状态：
  - controller 日志确认 enforcer 已重新接入。
  - controller 日志确认 scanner CVE 数据库已注册。
  - 重启后未再出现新的 `Vulnerability profile not found` 连续错误。

### 零信任与端口暴露组件复核

- OpenZiti：
  - `ziti-controller`: Running 1/1
  - `ziti-router`: Running 1/1
  - router 日志确认已连接 controller，且 `syncStatus=SYNC_DONE`。
- port-audit：
  - 修复 `k8s-port-audit` 的 `ErrImageNeverPull`。
  - 原因是 Deployment 使用 `local/k8s-port-audit-stack:0.2.2` 且 `imagePullPolicy=Never`，但该 tag 未导入 k3s containerd。
  - 已从本地 Docker 导入 `local/k8s-port-audit-stack:0.2.2` 到 k3s。
  - `k8s-port-audit`: Running 1/1
  - `port-audit-ziti-host`: Running 1/1
- 清理：
  - 已删除 openziti/port-audit 命名空间中历史 `ContainerStatusUnknown` Pod。

## 2026-04-25：自动策略运行语义与前端卡 loading 修复

### 修复范围

- 网络活动流量详情：
  - 修复会话详情查询参数被前端二次编码的问题。
  - 为边详情请求增加 8 秒超时兜底。
  - 即使后端暂时没有会话详情，也会用当前边的 source/target 渲染一个空详情面板，避免一直停在 loading。
- 网络规则页：
  - 修复自动规则详情里 `rule == null` 时访问 `rule.from` 导致页面卡住的问题。
  - 修复行内“添加到顶端/提升”操作传参错误，避免把整行对象当成 rule id 提交。
- 自动策略系统流量：
  - 取消 observer 对 MicroSegX/OpenZiti/平台组件流量的跳过逻辑。
  - 新语义是“系统流量可以观察和学习，同时由运行时默认 system guard 兜底保护”。
- 自动策略编译：
  - `legacy` 模式才保留旧 learned 规则。
  - 进入自动策略模式后，运行时不再注入旧 learned，只保留 Federal/Ground、system guard、用户手动规则和自动策略规则。
  - 自动规则在 `enforce/protect` 下参与编译；`shadow/monitor` 下只观察评分。
- 模式语义：
  - REST 层兼容 `discover/learn/monitor/evaluate/protect` 等全局模式别名。
  - 前端模式文案改为“学习/监视”和“保护生效”，减少 shadow/enforce 与全局模式的理解割裂。
- 日志：
  - 首次启动时 `config/auto_policy/rule/` 为空不再记为 ERROR，只作为正常空 store 初始化处理。

### 验证

- 后端测试：
  - `go test ./controller/cache ./controller/rest` 通过。
- 前端构建：
  - `npm run build -- --configuration production` 通过。
- manager 打包：
  - `bash package/build_manager.sh` 通过。
- controller 编译：
  - `make` 通过。
- 镜像部署：
  - 已重建并导入 `local.microsegx/nv/controller:2026.04.05-microsegx-r1`
  - 已重建并导入 `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
  - controller digest：`sha256:7c0d95d76e62c35c6f23f8dd2edae1c0a7ad616cadff01471effd6530907301a`
  - manager digest：`sha256:26ecca9e919241b92180631664d40060212a46793ae1b81d2e04e504bdcffc93`

### 当前部署状态

- `microsegx-controller-pod`: Running 1/1
- `microsegx-manager-pod`: Running 1/1
- `microsegx-enforcer-pod`: Running 1/1
- `microsegx-scanner-pod`: Running 1/1
- `ziti-controller`: Running 1/1
- `ziti-router`: Running 1/1
- `k8s-port-audit`: Running 1/1
- `port-audit-ziti-host`: Running 1/1

### 当前注意点

- 当前 Deployment 环境变量仍是 `AUTO_POLICY_MODE=shadow`，也就是默认“学习/监视”安全模式。
- 若要真正写入并启用自动规则，需要在自动策略页面切换到“保护生效”。
- 切到保护后，旧 learned 不再参与运行时效果；新的运行时集合是：系统默认保护规则、用户手动规则、自动 baseline/periodic/anomaly 规则。

## 2026-04-25：网络活动点击与“已生效规则”交互二次修复

### 修复范围

- 网络活动流量边点击：
  - 点击后立即打开详情面板，不再等待历史会话接口返回后才渲染。
  - group 边不再直接关闭弹窗，避免用户点击流量线后看到 Loading 或无响应。
  - 历史会话接口失败或超时时保留 fallback 详情面板，并继续显示自动策略检查器。
- manager 到 controller 的 conversation 转发：
  - 对 `conversation/:from/:to` 和 `conversation_endpoint/:id` 的 path segment 做双层编码。
  - 解决 endpoint/group id 中特殊字符被 controller 路由拆坏的问题。
- 自动策略页面：
  - “规则视图”改为“已生效规则”。
  - 空状态明确解释：学习/监视模式不会写入规则，所以已生效规则可以为空。
  - 增加“启用保护生效”主按钮和三步说明：学习/监视只观察，保护生效后生成并下发自动规则，运行时保留系统默认保护规则和用户手动规则。
- 后端模式切换：
  - `SetAutoPolicyMode(enforce)` 会尝试把已有高置信候选立即 promotion。
  - 不必必须等待下一批流量窗口才生成规则。

### 验证

- `go test ./controller/cache ./controller/rest` 通过。
- `npm run build -- --configuration production` 通过。
- `make -C microsegx/controller` 通过。
- `manager/package/build_manager.sh` 通过。
- 已重建并导入：
  - `local.microsegx/nv/controller:2026.04.05-microsegx-r1`
  - `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
- 当前运行镜像 digest：
  - controller：`sha256:dc4778328cc6a01e57944d84ca510932b31da69c4dadbd511c808904cc1bb91e`
  - manager：`sha256:0e7279529fa107751073df12d7867bc45eb30b2840c7339b3d974336ac792fe0`
- 已滚动重启 controller/manager。
- 当前 Pod 状态：
  - `microsegx-controller-pod`: Running 1/1
  - `microsegx-manager-pod`: Running 1/1
  - `microsegx-enforcer-pod`: Running 1/1
  - `microsegx-scanner-pod`: Running 1/1
- API 验证：
  - `network/graph` 返回 21 条边。
  - `network/history` 对其中一条边返回 conversation，entries 为 1。
  - `policy/auto/status` 当前模式为 `shadow`，候选特征 24 条。
  - `policy/auto/rule` 当前返回 0 条，符合“学习/监视不写入已生效规则”的语义。

### 追加修正

- 自动规则只读接口不再使用通用规则对象的 `acc.Authorize()` 做过滤。
  - 原因：自动策略存在 `Workload:ingress` 等自动引擎合成组名，通用授权函数会把这些只读规则过滤掉，导致候选视图显示 promoted、规则视图却为空。
  - 修复后，auto-policy 专用只读接口以 auto metadata 为准展示自动规则。
- `shadow` 模式下已有自动规则的 `compile_state` 统一显示为 `inactive`。
  - 原因：规则虽然存在于 store 中，但 shadow/学习监视模式不注入运行时编译链，不能显示成 active。
- 追加验证：
  - `policy/auto/status`：`mode=shadow`，候选特征 24 条，baseline 自动规则 8 条。
  - `policy/auto/rule`：返回 8 条自动规则，首条规则 `compile_state=inactive`、`active_now=false`。
  - 当前 controller digest：`sha256:bd9cd3c0624c074c2588d27af51df9ae2fc6d7f358b7a139ed0c2779fa163f39`。

## 2026-04-25：网络活动 404、保护模式全局同步与 Ziti/DNS 污染修复

### 本轮定位结论

- 网络活动页点击流量线返回 `network/history 404` 的主要原因不是前端图渲染本身，而是历史边或旧缓存边在 controller 中已经不存在。
  - manager 侧现在会把 controller 的 conversation 404 转换为空 conversation。
  - 前端点击流量线时也会先打开 fallback 详情面板，避免卡在 Loading。
- 浏览器仍可能缓存旧的 `7362.*.js` 网络活动 chunk。
  - 本轮在 manager 包内保留了旧 chunk 文件名兼容别名：
    - `7362.1a56a2fead9ad6a2.js`
    - `7362.de059b368cd02dec.js`
  - 这些旧文件名会返回当前已修复的网络活动模块，避免旧 runtime 请求旧 chunk 404。
- “保护生效”按钮之前只切了 auto-policy 模式和 service/all，没有同步全局 `config-v2` 网络策略配置。
  - 本轮改为同时同步：
    - auto policy mode = `enforce`
    - 所有服务策略模式 = `Protect`
    - `net_service_policy_mode = Protect`
    - `disable_net_policy = false`
    - `new_service_policy_mode = Protect`
- 业务域名解析成 `198.18.*` 并不是 MicroSegX 自动规则或 OpenZiti controller 生成错误。
  - 宿主机上存在 `verge-mihomo` 代理，创建了 `Meta` 虚拟网卡和策略路由。
  - 该代理会把部分集群 CIDR/DNS 流量带入本地代理 DNS，导致 `backend.learn.svc.cluster.local`、`nginx.web.svc.cluster.local` 被解析成 `198.18.*`。
  - 本轮已在宿主机添加临时高优先级直连规则，使 `10.42.0.0/16` Pod CIDR 与 `10.43.0.0/16` Service CIDR 走主路由，不再经过本地代理策略路由。

### 本轮代码修复

- 前端规则详情弹窗：
  - `rule/from/to/applications` 为空时不再抛出 `can't access property "from" of null`。
  - 自动规则、系统默认保护规则、空规则对象均可安全渲染。
- 网络活动详情：
  - 规则区域增加空值保护，避免无命中规则或 404 兜底 conversation 时模板崩溃。
- 自动策略页面：
  - `保护生效` 按钮现在会同步全局网络策略配置，不再只是切 UI 状态。
  - 这意味着按钮含义变成“真正启用自动规则运行时效果”，而不是只改变页面上的学习状态。
- manager 静态资源：
  - 增加旧网络活动 chunk 文件名兼容，降低浏览器缓存导致的旧 JS 404 风险。

### 当前运行语义

- `学习/监视`：
  - 观察流量、计算候选、展示评分。
  - 不把自动规则注入运行时策略。
- `保护生效`：
  - 自动策略引擎切为 `enforce`。
  - 已有 legacy learned 会迁移为 auto baseline metadata。
  - 系统默认保护规则、用户手动规则、自动 baseline/periodic/anomaly 规则共同参与运行时编译。
  - 未学习到、也没有用户规则或系统默认保护规则覆盖的业务流量会被 Protect 模式拒绝。
- 系统默认保护规则：
  - 覆盖 `microsegx`、`openziti`、`openziti-installer`、`port-audit` 等平台组件组之间的互通。
  - 这些规则不是为了阻止业务学习，而是为了避免平台自身因为自动学习不足被误拦截。
  - Ziti 到具体业务服务的访问仍应通过学习规则或用户规则进入策略体系。

### 本轮验证

- `go test ./controller/cache ./controller/rest` 通过。
- `npm run build -- --configuration production` 通过。
- `manager/package/build_manager.sh` 通过。
- 重新 repack 并导入：
  - `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
  - 当前 manager image manifest：`sha256:8c7474f961935190e38ae54409c3020197f794c97e4a5d777d3e95a93b8a78f0`
- 当前 Pod 状态：
  - `microsegx-controller-pod`: Running 1/1
  - `microsegx-manager-pod`: Running 1/1
  - `microsegx-enforcer-pod`: Running 1/1
  - `microsegx-scanner-pod`: Running 1/1
  - `ziti-controller`: Running 1/1
  - `ziti-router`: Running 1/1
  - `k8s-port-audit`: Running 1/1
  - `port-audit-ziti-host`: Running 1/1
- API 验证：
  - `network/history` 对用户提供的两条旧边均返回 `HTTP 200`。
  - `policy/auto/status` 当前为 `mode=enforce`。
  - `policy/auto/rule` 当前返回 625 条，其中：
    - `baseline`: 49 条
    - `system_guard`: 576 条
  - `config` 当前为：
    - `new_service_policy_mode = Protect`
    - `net_service_policy_mode = Protect`
    - `disable_net_policy = false`
    - `net_service_status = false`
- 保护效果验证：
  - `client.learn -> backend.learn` 可访问。
  - `rogue.learn -> backend.learn` 超时，被 Protect 策略拦截。
  - 删除了临时测试用规则 `temporary dns virtual service test`。
- DNS 验证：
  - `backend.learn.svc.cluster.local` 现在解析为真实 ClusterIP `10.43.171.189`。
  - `nginx.web.svc.cluster.local` 现在解析为真实 ClusterIP `10.43.43.222`。
  - 当前网络图中不再出现 `Workload:10.43.153.236` 或 `198.18.*` 形式的异常业务节点，仅保留合理的 `Workload:ingress`。
- 辅助脚本：
  - 新增 `ops/microsegx-local/ensure-cluster-direct-routing.sh`。
  - 用于在本地 k3s 开发机上重新安装 Pod/Service CIDR 直连策略路由，避免宿主机代理污染集群 DNS。

### 仍需注意

- 本轮添加的宿主机 `ip rule` 是运行时修复，用于避开本机 `verge-mihomo` 代理对 k3s 集群 CIDR 的污染。
  - 若宿主机重启或代理重置路由，需要重新添加直连规则，或者在代理软件中把 `10.42.0.0/16`、`10.43.0.0/16` 配成直连。
- OpenZiti router 当前仍启用了 `tunnelMode=host`。
  - 这不是本轮 198.18 污染的直接来源，但页面上应把“启用 tunneler”解释为高级托管能力，避免误以为所有业务都必须走 router host tunnel。

## 2026-04-25：自动策略规则治理、系统默认规则收窄与人工删除

### 本轮问题

用户反馈自动策略规则列表中存在大量难以解释的规则，其中一部分已经对应不到当前运行容器；同时页面缺少分页、搜索、业务维度筛选、多选删除等治理能力，导致规则一旦生成就难以人工介入。

另外，`system_guard` 系统默认保护规则之前过于宽泛，接近平台组件之间的全互联保护。它虽然能避免 MicroSegX/OpenZiti/port-audit 被 Protect 模式误拦截，但也会让规则列表膨胀，并且让用户难以判断哪些规则是真正自动学习来的。

### 后端修复

- 收窄 `system_guard` 默认规则生成范围：
  - 只为当前仍有 live member 或 service address 的平台组生成默认保护规则。
  - 排除调试、安装器、注册、升级、临时用户测试等不应长期固化的组。
  - `ServiceIP -> ServiceIP` 默认只保留同组自保护，不再生成跨 ServiceIP 全互联。
  - 默认保护规则仍覆盖 MicroSegX、OpenZiti、port-audit 三类平台基础组件，避免系统自身被自动策略误伤。
- 为虚拟 `system_guard` 规则增加稳定 ID：
  - ID 由规则组对稳定计算得到，便于前端展示、筛选和人工 suppression。
  - 这些规则不是普通 KV policy rule，而是编译期虚拟注入的系统保护规则。
- 增加自动规则人工删除能力：
  - 真实自动规则删除时，会同时删除规则本体和 metadata。
  - 虚拟 `system_guard` 删除时，不删除不存在的规则本体，而是写入 suppression metadata，后续编译不再注入该条默认保护规则。
  - suppression metadata 不参与 anomaly TTL 清理，也不参与普通 aging 清理，避免用户手动隐藏的默认规则被后台“复活”。
- 增加 REST 删除接口：
  - `DELETE /v1/policy/auto/rule/:id`
  - `DELETE /v1/policy/auto/rule`
  - 批量删除请求支持多个 rule ID。
- manager 代理层同步支持 DELETE：
  - 修复此前浏览器通过 manager 访问删除接口时返回 `405 Method Not Allowed` 的问题。
  - 修复 admin 用户删除自动规则时被通用 policy rule 权限检查误拦为 `403 Forbidden` 的问题。

### 前端修复

- 自动策略规则列表增加：
  - 搜索框。
  - 规则类别筛选，包括 `baseline / periodic / anomaly / system_guard`。
  - 业务/命名空间筛选。
  - 分页按钮。
  - 当前页全选。
  - 多选删除。
  - 单条删除。
- 规则来源变得更明确：
  - `baseline`：稳定业务流量自动生成。
  - `periodic`：周期性业务流量自动生成。
  - `anomaly`：异常行为临时拒绝。
  - `system_guard`：平台默认保护规则，不是业务学习结果。
- 前端类型和 i18n 同步增加了删除结果、系统保护规则、分页、筛选和规则来源等字段。
- 补充运行状态识别：
  - 后端为每条自动规则返回 source/destination 是否仍有 live endpoint 或 service address。
  - 前端增加“运行中 / 疑似失效”标记和筛选，方便定位容器已经消失但规则还存在的历史项。
  - 进一步补充 `Workload:<...>` 和 `Host:<...>` 直连端点检查：
    - `Workload:ingress` 作为入口虚拟节点保持有效。
    - 具体 workload ID 会查 `wlCacheMap/nvwlCacheMap`。
    - workload IP 会查当前 `ipWLMap` 且要求 alive。
    - host ID 会查 `hostCacheMap`；外部 IP host 不按 Pod 生命周期判死。

### 当前验证结果

- 后端测试：
  - `go test ./controller/cache ./controller/rest` 通过。
  - `microsegx/package/build_controller.sh` 通过。
- 前端与 manager：
  - `npm run build -- --configuration production` 通过。
  - `sbt admin/assembly` 通过。
  - manager 镜像重新封装并导入 k3s。
- controller：
  - controller 镜像重新封装并导入 k3s。
- 当前 Pod 状态：
  - `microsegx-controller-pod`: Running 1/1
  - `microsegx-manager-pod`: Running 1/1
  - `microsegx-enforcer-pod`: Running 1/1
  - `microsegx-scanner-pod`: Running 1/1
- 当前自动策略状态：
  - `mode = enforce`
  - `system_guard = 11`
  - `baseline = 10`
  - `periodic = 0`
  - `anomaly = 0`
  - `feature = 0`
- 当前自动规则列表：
  - 总数 21 条。
  - `baseline`: 10 条。
  - `system_guard`: 11 条。
  - `疑似失效`: 10 条，主要为历史 baseline 指向当前组缓存中没有 live endpoint/service address 的对象。
  - 其中与 `Workload:<...>` 虚拟入口相关的失效项为 8 条，`Workload:ingress` 本身保持 live，失效原因来自目标组不存在。
- 删除接口验证：
  - `DELETE /policy/auto/rule` 已返回 `HTTP 200`。
  - 使用不存在的 ID 测试时返回 `{"result":{"skipped":[999999999]}}`，说明 manager 代理、controller 路由和删除处理链已经贯通。
- 静态资源验证：
  - 当前网络活动旧 chunk 与新 chunk 均返回 `HTTP 200`。
  - 当前自动策略旧 chunk 与新 chunk 均返回 `HTTP 200`。
  - 这用于降低浏览器缓存导致的旧 JS 404/400 风险。

### 当前语义说明

- `system_guard` 不是业务学习规则，而是系统默认保护层。
- 用户可以在自动策略页手动删除 `system_guard`；该操作实际含义是“抑制这条默认保护规则”，不是删除某条 KV policy rule。
- 用户可以删除 `baseline / periodic / anomaly`；这些是真实自动规则，删除时会移除规则本体和 metadata。
- 规则列表现在应优先通过业务筛选、类别筛选和搜索定位，避免直接在全量列表里逐条辨认。

### 仍需注意

- 当前 `system_guard` 已从全互联收窄，但仍偏保守，目的是优先保证 MicroSegX/OpenZiti/port-audit 自身在 Protect 模式下稳定运行。
- 如果后续确认某些平台组之间不需要互通，可以继续把 `system_guard` 从“平台族互通”进一步收敛为“明确角色对互通”。
- 对已消失 workload 生成的历史 baseline 规则，当前可以人工多选删除；后续还可以继续增强 aging 逻辑，让无 live endpoint 的规则自动进入 stale 状态并提示清理。

---

## 2026-04-25：enforcer / port-audit / OpenZiti 连通性修复

### 现象

- `microsegx-enforcer-pod` Pod 处于 Running，但 controller `/summary` 一度显示：
  - `enforcers = 0`
  - `hosts = 0`
  - `workloads = 0`
- manager 页面访问端口暴露和零信任接口时超时。
- port-audit 内部访问 Ziti controller 的 NodePort 地址超时。
- `port-audit-host` identity 连接 OpenZiti edge router 失败，表现为 `NO_EDGE_ROUTERS_AVAILABLE` 或 `edgeRouterConnectionStatus = offline`。

### 根因

- controller 多次重启后，旧 enforcer 进程仍在运行但没有重新加入当前 controller/Consul leader，属于“Pod Running 但控制面未注册”的状态。
- manager 运行态 `MICROSEGX_PORT_AUDIT_BASE_URL` 被设置为宿主机 HostPort 地址：
  - `http://192.168.198.128:18080`
  - 在当前集群策略和 NodePort/HostPort 路径下，该地址不如 Service DNS 稳定。
- port-audit 默认 Ziti controller URL 使用宿主机 NodePort：
  - `https://192.168.198.128:31280`
  - 集群内部管理调用应优先使用：
  - `https://ziti-controller-client.openziti.svc.cluster.local:31280`
- `ziti-router` 的 edge NodePort `30222` 没有稳定转发到 router Pod；controller NodePort `31280` 可用，但 router NodePort 不可用，导致 host identity 无法连接 edge router。

### 修复

- 重启 enforcer DaemonSet，使其重新加入 controller：
  - controller `/summary` 恢复 `enforcers = 1`、`hosts = 1`、`workloads > 0`。
- 将 manager 的 port-audit base URL 改为集群内 Service DNS：
  - `http://k8s-port-audit.port-audit.svc.cluster.local:8080`
- 将 port-audit 默认 Ziti controller URL 改为集群内 Service DNS：
  - `https://ziti-controller-client.openziti.svc.cluster.local:31280`
- 将 `ziti-router` 改为 `hostNetwork: true` 与 `dnsPolicy: ClusterFirstWithHostNet`：
  - 修复 `192.168.198.128:30222` 不通的问题。
  - `ziti-router` 重新上线后，业务服务 terminator 重新 established。
- 将 `port-audit-ziti-host` 改为 `hostNetwork: true` 与 `dnsPolicy: ClusterFirstWithHostNet`：
  - 重启后 `port-audit-host` identity 恢复 `edgeRouterConnectionStatus = online`。
  - `port-audit-web` terminator 恢复。
- 将上述运行态修复同步进部署脚本与 values：
  - `ops/full-release/deploy-core.sh`
  - `ops/microsegx-local/deploy-local.sh`
  - `k8s-node-surface/manifests/openziti/ziti-router-values.yaml`
  - `k8s-node-surface/scripts/deploy-port-audit-ziti-stack.sh`

### 验证

- MicroSegX summary：
  - `controllers = 1`
  - `enforcers = 1`
  - `hosts = 1`
  - `scanners = 1`
  - `workloads = 51`
- manager 代理接口：
  - `/microsegx/overview` 返回成功。
  - `/microsegx/api/external_exposure_summary` 返回成功。
  - `/microsegx/api/scan_state` 返回成功。
  - `/microsegx/api/ziti/session` 返回成功。
  - `/microsegx/api/ziti/overview` 返回成功。
  - `/microsegx/api/ziti/routers` 返回成功。
  - `/microsegx/api/ziti/services` 返回成功。
- OpenZiti：
  - `ziti-router` 为 online。
  - `supportedProtocols.tls = tls://192.168.198.128:30222`。
  - `port-audit-host` 为 online。
  - `port-audit-web`、`mc-service`、`nginx-service`、`port-service` 均可看到 terminator。

---

## 2026-04-25：观察视图去重、业务筛选与零信任流量语义增强

### 用户侧现象

- 自动策略观察视图中多条流量看起来像重复数据，因为页面主要展示 `from -> to`，没有把端口、协议、命名空间、业务和流量来源一起展示。
- 规则视图和观察视图缺少按命名空间/业务进一步筛选的入口。
- 通过 OpenZiti 发布的服务与普通入口流量没有明确分开，页面上容易只看到类似 `Workload:ingress -> nv.nginx.web` 的普通入口视角，而看不到“零信任服务经 ziti-router 到业务服务”的逻辑路径。

### 本轮修复

- 后端自动策略 REST 返回增加解释性字段：
  - `display_key`
  - `from_namespace / to_namespace / namespace`
  - `from_business / to_business / business`
  - `traffic_source`
  - `zero_trust`
- 后端按 group 名称推导基础语义：
  - `nv.<service>.<namespace>` 解析为业务与命名空间。
  - `Workload:ingress` 标记为入口流量。
  - `ziti / openziti / ziti-router` 相关 group 标记为零信任流量。
  - `microsegx / openziti / port-audit` 相关 group 标记为系统组件流量。
- 前端自动策略页新增筛选：
  - 已生效规则视图：按分类、业务、命名空间、流量来源、运行状态筛选。
  - 观察视图：按阶段、候选类别、业务、命名空间、流量来源筛选。
- 前端观察视图做展示去重：
  - 以 feature key、流量来源、端口集合和 FQDN 集合作为显示身份。
  - 避免同一条候选因为展示字段不足而看起来“重复”。
- 前端新增零信任发布路径区域：
  - 从 OpenZiti service/config/terminator 信息合成逻辑路径。
  - 显示为 `ziti-router -> nv.<service>.<namespace>` 这样的治理视角。
  - 该区域用于解释零信任发布关系，不替代真实数据面连接观测。

### 关键语义说明

- `普通业务流量`：普通 workload/group 之间的直接通信。
- `入口流量`：从 `Workload:ingress` 或外部入口进入集群服务的流量。
- `零信任流量`：名称或路径中包含 OpenZiti/ziti-router/zero-trust 组件的流量，或由 OpenZiti 配置合成的发布路径。
- `系统组件流量`：MicroSegX、OpenZiti、port-audit 等平台组件之间的通信。

### 验证

- Go 单元测试通过：
  - `go test ./controller/cache ./controller/rest`
- 前端生产构建通过：
  - `npm run build -- --configuration production`

---

## 2026-04-27：自动策略页“接口已返回但页面卡死”专项修复

### 现象

- 用户反馈进入自动策略相关页面后表现为长时间无响应。
- 同期用命令行验证发现：
  - `/policy/auto/status`
  - `/policy/auto/rule`
  - `/policy/auto/feature`
  - `/policy/auto/event`
  - `/microsegx/overview`
  均能正常返回。
- 因此本轮判断重点从“接口阻塞”转向“前端渲染主线程阻塞”。

### 根因判断

- 自动策略页模板中存在大量直接绑定 getter 的写法。
- 这些 getter 会在 Angular 每轮变更检测中重新执行：
  - 规则筛选
  - 候选特征筛选
  - 命名空间选项构建
  - 工作负载选项构建
  - 流量来源选项构建
  - 当前页规则切片
  - 当前页全选状态判断
- 当页面同时存在自动刷新、Material 组件和较多规则/候选数据时，即使接口已经返回，浏览器主线程也可能被反复计算拖住，看起来像“卡死且无报错”。

### 本轮修复

- 将自动策略页的派生数据改为缓存状态：
  - 接口返回后计算一次。
  - 筛选条件变化后计算一次。
  - 翻页或选择变化后只更新必要状态。
  - 模板不再在每次变更检测中重新遍历所有规则和候选。
- 为规则、候选、事件和筛选选项增加 `trackBy`。
- 候选特征列表默认只渲染前 200 条，避免大量候选一次性压垮浏览器；仍可通过搜索、命名空间、工作负载和来源筛选缩小范围。
- 自动刷新周期从 10 秒调整为 30 秒，降低页面渲染期间的重复刷新压力。

### 部署

- 前端生产构建通过：
  - `npm run build -- --configuration production`
- manager assembly 通过：
  - `sbt admin/assembly`
- 新 manager 镜像：
  - `local.microsegx/nv/manager:2026.04.27-render-cache-r1`
- 已导入 k3s 并滚动部署：
  - `microsegx-manager-pod` 已使用新镜像并成功 rollout。

### 验证

- 新页面资源已生效：
  - `main.bf7173d7fb31c1ec.js`
  - `9423.620c37b636f8114b.js`
- API 验证结果：
  - `/policy/auto/status` 约 0.04s。
  - `/policy/auto/rule` 约 0.03s。
  - `/policy/auto/feature` 约 0.08s。
  - `/policy/auto/event` 约 0.08s。
  - `/microsegx/overview` 约 0.57s。
- 并发验证：
  - 8 并发 `/microsegx/overview` 全部 200，约 2.0s 至 2.4s。
  - 16 并发 `/policy/auto/rule` 全部 200，约 0.15s 至 0.43s。
  - 10 并发自动策略 JS chunk 全部 200，约 0.08s 至 0.17s。

### 结论

- 当前已确认后端接口、静态资源和 manager 服务本身没有出现长时间 pending。
- 本轮主要修复的是页面进入后主线程被模板重复计算拖死的问题。
- 如果浏览器仍显示旧行为，优先做强制刷新或清理站点缓存，因为新构建的文件名已经变化。

---

## 2026-04-27：观察视图分页与系统自身通信保护修复

### 现象

- 页面卡死问题已确认缓解后，继续处理两个问题：
  - 自动策略观察视图缺少分页，候选特征多时不便查看。
  - 进入保护模式时，如果系统自身通信尚未被自动学习，WebUI、controller、enforcer、scanner、OpenZiti、port-audit 等基础链路存在被策略锁死的风险。

### 前端修复

- 自动策略观察视图增加分页：
  - 每页 30 条候选特征。
  - 展示当前页范围和总数。
  - 支持上一页、下一页。
- 搜索条件变化时同时重置规则页与观察页分页位置。

### 后端修复

- 系统自身通信不再依赖“先学习到再允许”。
- `system_guard` 改为默认开启，但从旧的大范围 `any` 规则改成更窄的启动保护：
  - 只从当前仍然存活的系统组件生成规则。
  - 只覆盖 `microsegx`、`openziti`、`port-audit` 三类基础组件。
  - 不再生成 `port-audit -> nodes` 这类节点扫描保护规则。
  - 规则端口按目标角色收敛，不再统一使用 `any`。
- 当前端口范围：
  - WebUI/manager：`tcp/8443`
  - controller/API/cluster/webhook：`tcp/443,tcp/10443,tcp/18300,tcp/18301,udp/18301,tcp/18400,tcp/20443,tcp/30443`
  - enforcer：`tcp/18401`
  - scanner：`tcp/18402`
  - OpenZiti controller：`tcp/1280,tcp/31280`
  - OpenZiti router：`tcp/3022,tcp/30222`
  - port-audit：`tcp/8080`
- WebUI 入口增加默认保护：
  - `external -> microsegx-service-webui`
  - `external -> microsegx-service-webui-public-*`
- OpenZiti 对外入口也保留默认保护：
  - `external -> ziti-controller-*`
  - `external -> ziti-router-*`

### 部署

- 新 controller 镜像：
  - `local.microsegx/nv/controller:2026.04.27-system-guard-r1`
- 新 manager 镜像：
  - `local.microsegx/nv/manager:2026.04.27-feature-pagination-r1`
- 已导入 k3s 并滚动部署：
  - `microsegx-controller-pod` rollout 成功。
  - `microsegx-manager-pod` rollout 成功。

### 验证

- 后端测试：
  - `go test ./controller/cache` 通过。
  - `go test ./controller/rest -run 'TestShutdownResourceCleanup|TestAutoPolicy|TestPolicy' -count=1` 通过。
  - `go test ./controller/cache ./controller/rest` 中 `controller/rest` 的完整包测试曾在既有 `longpoll` goroutine leak 检查处失败一次，和本次改动无直接关系。
- 前端构建：
  - `npm run build -- --configuration production` 通过。
- 接口验证：
  - `/policy/auto/status` 约 0.12s。
  - `/policy/auto/rule` 约 0.39s。
  - `/policy/auto/feature` 约 0.11s。
  - `/microsegx/overview` 约 0.83s。
- 当前状态：
  - `system_guard_rule_count=59`
  - 说明系统启动保护规则已由 controller 生成并通过 manager 状态接口可见。

---

## 2026-04-26：修复自动策略 feature 接口导致页面卡住的问题

### 问题现象

- 用户反馈 `/policy/auto/feature` 会卡死，导致自动策略页面或网络活动侧栏不动。
- 直接从 controller 和 manager 调用该接口时，接口本身返回很快，说明不是后端死锁。
- manager 日志显示前端会连续重复请求 `/v1/policy/auto/feature` 与 `/v1/policy/auto/rule`。

### 修复内容

- 自动策略主页面增加刷新重入保护：
  - 上一次 `status/rule/feature/event` 拉取未结束时，不再启动新的定时刷新。
  - 定时刷新不再每次把全页切成 loading 状态，避免页面看起来被锁死。
- 网络活动页的自动策略侧栏增加边选择去重：
  - 同一条 `from -> to` 边已经加载过时，不再重复拉取全量 feature/rule。
  - 同一条边正在请求中时，新的 `ngOnChanges` 不再重复发起请求。
  - 同一条边的缓存保留 5 秒，避免永久缓存旧的“未匹配”状态。
- 自动策略模式切换联动全局策略：
  - `legacy` 对应全局 `Discover`。
  - `shadow` 对应全局 `Monitor`。
  - `enforce` 对应全局 `Protect`。
  - 自动策略配置更新失败时会提示失败；全局两路联动接口失败时不再拖死自动策略配置更新。

### 验证

- 前端生产构建通过：
  - `npm run build -- --configuration production`
- manager assembly 通过：
  - `sbt admin/assembly`
- manager 镜像已重建、导入 k3s 并滚动部署：
  - `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
- 当前 pod 状态：
  - `microsegx-manager-pod` Running
  - `microsegx-controller-pod` Running
  - `microsegx-enforcer-pod` Running
  - `microsegx-scanner-pod` Running
  - `ziti-controller` Running
  - `ziti-router` Running
- manager 代理接口验证：
  - `/policy/auto/status` HTTP 200
  - `/policy/auto/rule` HTTP 200
  - `/policy/auto/feature` HTTP 200，约 0.08 秒返回
  - `/policy/auto/event` HTTP 200
- 模式联动接口验证：
  - `/policy/auto/config` HTTP 200
  - `/service/all` HTTP 200
  - `/config-v2` HTTP 200
- 网络活动历史接口验证：
  - `/network/history?from=Workload:ingress&to=nv.ziti-controller.openziti` HTTP 200
- 当前自动策略模式：
  - `shadow`
- 后端测试通过：
  - `go test ./controller/cache ./controller/rest`
- 本地集群已刷新：
  - 重建 `controller` 二进制。
  - 重建 `manager` jar。
  - 重打并导入本地 k3s 镜像：
    - `local.microsegx/nv/controller:2026.04.05-microsegx-r1`
    - `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
  - 滚动重启并确认：
    - `microsegx-controller-pod` Running
    - `microsegx-manager-pod` Running
    - `microsegx-enforcer-pod` Running
    - `microsegx-scanner-pod` Running
    - `ziti-router` Running
    - `port-audit-ziti-host` Running

### 后续注意

- 如果真实数据面没有产生 `ziti-router -> 业务服务` 的连接，网络活动图仍可能只看到入口视角；本轮新增的“零信任发布路径”是基于 OpenZiti 配置的治理视角，用于和数据面观察视角互补。
- 如果后续需要在网络拓扑图中直接画出虚拟零信任路径，需要在图数据源中额外合成 virtual edge，而不是只依赖 NeuVector 原始连接事件。

---

## 2026-04-25：修复 OpenZiti 最后一跳流量归因

### 用户侧现象

- 用户希望“只要是通过零信任代理访问业务系统，就应学习成 `ziti -> 业务 Pod` 的流量”，用于后续可控学习与可控拦截。
- 实际网络活动中经常出现 `Workload:ingress -> nv.nginx.web` 或 Host/IP 形式，而不是 `nv.ziti-router.openziti -> nv.nginx.web`。

### 根因判断

- `ziti-router` 和 `port-audit-ziti-host` 之前均使用 `hostNetwork: true`。
- 在 hostNetwork 模式下，Pod 共享节点网络命名空间，OpenZiti 访问后端业务时源地址容易表现为节点 IP、Host 或 ingress，而不是稳定的 Pod 身份。
- DNS 配置本身不是问题。OpenZiti host.v1 配置中的目标仍然是 Kubernetes DNS，例如 `nginx.web.svc.cluster.local:80`。问题在于“发起连接的网络身份”不在 Pod 网络里。

### 本轮修复

- 将 OpenZiti router 从 hostNetwork 改为 Pod 网络：
  - `hostNetwork: false`
  - `dnsPolicy: ClusterFirst`
- 将 `port-audit-ziti-host` 从 hostNetwork 改为 Pod 网络：
  - `hostNetwork: false`
  - `dnsPolicy: ClusterFirst`
- 保留 OpenZiti 对外访问方式：
  - router 仍通过 NodePort `192.168.198.128:30222` 对外提供 edge 入口。
  - router Pod 内部仍监听 `3022`。
  - Kubernetes Service 将 NodePort `30222` 转发到 router Pod 的 `3022`。
- 修改持久化部署入口，避免网页端或脚本重部署后回退：
  - `k8s-node-surface/manifests/openziti/ziti-router-values.yaml`
  - `k8s-node-surface/scripts/deploy-port-audit-ziti-stack.sh`
  - `k8s-node-surface/k8s_port_audit/api/ziti_router_k8s.py`
- 重新构建并导入 `local/k8s-port-audit-stack:0.2.2`，滚动重启 `k8s-port-audit`，确保网页端后端使用新的部署逻辑。

### 验证结果

- `ziti-router` 当前 Pod IP 为 `10.42.0.147`，不再是节点 IP。
- `ziti-router-edge` / `ziti-router-transport` endpoint 已变为 `10.42.0.147:3022`。
- `port-audit-ziti-host` 当前 Pod IP 为 `10.42.0.148`，不再是节点 IP。
- OpenZiti controller 中 `ziti-router` 仍为 online。
- `port-service`、`mc-service`、`nginx-service`、`port-audit-web` terminator 均存在。
- 从 `ziti-router` Pod 访问 `nginx.web.svc.cluster.local:80` 后，nginx 访问日志显示来源为 `10.42.0.147`，说明最后一跳已经变成 router Pod 到业务 Pod 的流量。

### 预期效果

- 后续通过 OpenZiti 访问业务服务时，MicroSegX 更容易将最后一跳归因为 `ziti-router` 所在 workload/group，而不是 `Workload:ingress` 或 Host/IP。
- 自动策略学习可以自然区分：
  - 普通入口流量：`Workload:ingress -> 业务服务`
  - 零信任代理流量：`ziti-router -> 业务服务`
- 若仍看到旧的 ingress 边，通常是浏览器或 NodePort 直接访问业务服务留下的直接入口流量，不代表 OpenZiti 最后一跳仍然错误。

---

## 2026-04-25：端口审计扫描流量降噪与 WebUI 零信任学习确认

### 用户侧现象

- 自动策略页面中出现 `nv.k8s-port-audit.port-audit -> nodes`，并携带大量端口。
- 该流量本质上是端口审计组件对节点暴露面的扫描/探测，不应作为业务通信基线学习。
- 需要确认 `ziti-router -> nv.microsegx-service-webui.microsegx` 这类零信任代理到 MicroSegX WebUI 的最后一跳仍可被学习。

### 本轮修复

- 在自动策略观察入口加入扫描流量降噪：
  - 当来源是 `k8s-port-audit` 扫描组件，目标是 `nodes`、`fed.nodes`、`nv.hostaddr_group` 或 `Host:*` 这类节点范围对象时，直接跳过观察。
  - 不跳过 `ziti-router`、`port-audit-ziti-host` 与普通业务服务之间的流量。
- 在自动规则生成链路加入同样保护：
  - candidate promotion 阶段不再把端口审计到节点的扫描特征提升为自动规则。
  - legacy learned adoption 阶段不再把这类旧 learned 规则认领为 auto baseline。
  - cleanup 阶段会删除已经存在的同类 auto rule，避免历史污染继续显示或生效。
- 在编译链路加入同样保护：
  - 即使 KV 中残留同类 auto metadata/rule，也不会被注入运行时 `CLUSGroupIPPolicy`。
- 在状态接口加入同样保护：
  - `/v1/policy/auto/status`
  - `/v1/policy/auto/feature`
  - `/v1/policy/auto/rule`
  - 这些接口不再把端口审计到节点的扫描特征/规则算入候选、规则数量或列表。
- 在前端自动策略页面压缩长端口列表显示：
  - 端口只展示前若干项，并用 `+N` 表示还有更多。
  - 这样即使其他合法业务确实有多端口，也不会把卡片撑爆。

### WebUI 零信任链路确认

- OpenZiti `mc-service-host-config` 当前目标为：
  - `microsegx-service-webui.microsegx.svc.cluster.local:8443`
- OpenZiti terminator 当前存在：
  - `mc-service -> ziti-router`
- `ziti-router` 当前运行在 Pod 网络中：
  - Pod IP：`10.42.0.147`
- 已从 `ziti-router` Pod 内访问：
  - `https://microsegx-service-webui.microsegx.svc.cluster.local:8443`
  - 请求成功返回内容。

### 结论

- `nv.k8s-port-audit.port-audit -> nodes` 这类扫描流量现在不会再进入自动策略候选、自动规则、编译结果和状态展示。
- `ziti-router -> nv.microsegx-service-webui.microsegx` 不在过滤范围内，且最后一跳已经具备 Pod 网络源身份，因此可以被自动策略观察与学习。
- 如果页面短时间内仍看到旧的 `port-audit -> nodes` 项，通常是前端缓存、旧 API 响应或历史 learned 规则残留；新的 controller 清理周期会逐步删除带 auto metadata 的同类历史规则。

### 验证

- Go 测试通过：
  - `go test ./controller/cache ./controller/rest`
- 前端生产构建通过：
  - `npm run build -- --configuration production`

---

## 2026-04-27：取消默认保护，系统组件同样进入学习范畴

### 用户侧最终要求

- 不要默认保护规则。
- MicroSegX 自身组件、OpenZiti 组件、port-audit 等系统组件之间的通信也必须通过观察窗口进入学习链路。
- 系统不应预置一批默认 allow 规则来替代学习结果。

### 本轮调整

- 将 `system_guard` 从默认启用改为默认关闭。
- 当前运行中的 controller 显式设置：
  - `AUTO_POLICY_SYSTEM_GUARD=false`
- 保留 `AUTO_POLICY_SYSTEM_GUARD=true` 作为隐藏应急开关，但它不再是项目默认行为，也不作为论文/演示主路径。
- 自动策略观察入口不排除 MicroSegX / OpenZiti / port-audit 命名空间。
- 目前只保留一个噪声过滤：
  - `port-audit -> nodes` 的扫描型聚合流量不进入学习，避免生成“端口审计器到节点的大量端口规则”。

### 当前语义

- `system_guard_rule_count=0` 表示当前没有默认注入的系统保护规则。
- `system_feature_count` 或 `system_rule_count` 如果不为 0，表示系统组件的真实流量已经被观察或学习到。
- 系统组件访问 Web UI、controller、enforcer、scanner、OpenZiti 的通信不会靠默认规则放行，而是和普通业务流量一样进入自动策略候选、评分和生成流程。

### 验证

- Go 测试通过：
  - `go test ./controller/cache`
- controller 已重新构建并部署：
  - `local.microsegx/nv/controller:2026.04.27-no-default-guard-r1`
- 当前集群确认：
  - `microsegx-controller-pod` Running
  - `microsegx-manager-pod` Running
  - `microsegx-enforcer-pod` Running
  - `microsegx-scanner-pod` Running
- API 验证通过：
  - `/policy/auto/status` 返回 200
  - `/policy/auto/rule` 返回 200
  - `/policy/auto/feature` 返回 200
  - `/microsegx/overview` 返回 200
- `/policy/auto/status` 当前确认：
  - `mode=shadow`
  - `system_guard_rule_count=0`

---

## 2026-04-27：按最终边界收窄平台保活规则并修复重复候选

### 用户侧最终边界

- `microsegx` 命名空间内部通信不应被自动策略阻拦。
- `openziti -> manager/webui` 不应被自动策略阻拦。
- 其他业务访问、零信任访问业务、普通入口访问业务仍然由自动策略学习和用户规则决定。

### 本轮调整

- 重新启用极小范围的 `system_guard`，但语义从“系统默认保护”改为“平台保活”。
- 平台保活只生成两类规则：
  - `microsegx -> microsegx`：允许 MicroSegX 核心组件与 MicroSegX service 之间通信。
  - `openziti -> microsegx manager/webui`：只允许 OpenZiti controller/router 到 manager/webui 的 `tcp/8443`。
- 不再为以下链路生成平台保活：
  - `openziti -> 业务服务`
  - `ingress -> 业务服务`
  - `port-audit -> nodes`
  - `microsegx -> openziti`
  - `openziti -> controller/scanner/enforcer`
  - 任意业务命名空间互通
- 为避免 controller 使用 stub runtime 或缓存启动顺序导致保活规则缺失，保活生成器增加固定核心组：
  - `nv.microsegx-manager-pod.microsegx`
  - `nv.microsegx-controller-pod.microsegx`
  - `nv.microsegx-enforcer-pod.microsegx`
  - `nv.microsegx-scanner-pod.microsegx`
  - `nv.ziti-controller.openziti`
  - `nv.ziti-router.openziti`
- 这些固定组只用于平台保活，不参与业务学习放行。

### 重复候选修复

- 发现 `nv.ziti-router.openziti -> nv.nginx.web` 会同时出现：
  - `tcp/80`
  - `app:1001`
- 根因是同一条连接先以 L4 端口形式进入观察窗口，后续又被应用识别补充为 app feature。
- 新逻辑改为“应用识别优先”：
  - 同一 `from/to/proto` 出现 app feature 时，删除对应 L4 feature。
  - 已存在 app feature 时，后续同源同目的同协议的 L4 feature 不再进入候选。
- 这样零信任业务链路不会在观察页里因为 L4/App 双轨而重复显示。

### 验证

- Go 测试通过：
  - `go test ./controller/cache`
- 前端构建通过：
  - `npm run build -- --configuration production`
- manager assembly 通过：
  - `sbt admin/assembly`
- 已部署镜像：
  - `local.microsegx/nv/controller:2026.04.27-bootstrap-scope-r6`
  - `local.microsegx/nv/manager:2026.04.27-bootstrap-label-r1`
- 当前集群验证：
  - `microsegx-controller-pod` Running
  - `microsegx-manager-pod` Running
  - `microsegx-enforcer-pod` Running
  - `microsegx-scanner-pod` Running
- `/policy/auto/status` 当前确认：
  - `system_guard_rule_count=46`
  - 所有平台保活规则均限制在 `microsegx -> microsegx` 或 `openziti -> manager/webui:8443`
- 当前未再看到 `ziti-router -> nginx` 的 L4/App 重复候选。

---

## 2026-04-26：卡顿/卡死复查

### 复查目标

- 确认 WebUI、自动策略接口、port-audit、OpenZiti 和核心 MicroSegX 组件是否仍存在明显阻塞、请求风暴或 CrashLoop。
- 重点复查此前容易导致页面卡死的 `/v1/policy/auto/feature` 请求。

### 当前运行状态

- `microsegx-controller-pod`、`microsegx-manager-pod`、`microsegx-enforcer-pod`、`microsegx-scanner-pod` 均为 Running。
- `ziti-controller`、`ziti-router`、`k8s-port-audit`、`port-audit-ziti-host` 均为 Running。
- WebUI 首页跟随跳转后返回 200，耗时约 22ms。
- port-audit 主要接口返回正常：
  - `/api/dashboard` 返回 200，约 88ms。
  - `/api/ziti/overview` 返回 200，约 430ms。
  - `/api/ziti/configs` 返回 200，约 31ms。
  - `/api/ziti/session` 返回 200，约 18ms。

### 自动策略接口复查

- 最近 20 分钟 manager 日志中，`/v1/policy/auto/feature` 只出现 1 次真实登录后的请求。
- 该请求返回 200，响应体 gzip 后约 683 bytes。
- 同一轮自动策略页面请求中，`status`、`rule`、`feature`、`event` 均返回成功。
- 当前没有发现 `/policy/auto/feature` 请求风暴或接口长时间不返回的现象。

### DNS 与零信任链路复查

- 主机路由仍将 `10.43.0.0/16` 与 `10.42.0.0/16` 指向 `cni0`，没有再被 VPN/TUN 表接管。
- `ziti-router` 内可解析：
  - `nginx.web.svc.cluster.local`
  - `microsegx-service-webui.microsegx.svc.cluster.local`
  - `k8s-port-audit.port-audit.svc.cluster.local`
- `ziti-router -> microsegx-service-webui` 返回 307，约 24ms。
- `ziti-router -> nginx` 返回 200，约 5ms。

### 残留风险

- 节点根分区使用率约 87%，Kubernetes 事件中仍有镜像垃圾回收失败告警，后续构建/部署可能受磁盘空间影响。
- `microsegx-updater-pod` CronJob 当前仍引用缺失镜像 `local.microsegx/nv/updater:0.0.9`，导致一个历史 Job 持续 `ErrImageNeverPull`。该问题不会直接卡死 WebUI，但会制造事件噪音，需要后续清理或修正 updater 镜像来源。
- manager 日志里仍能看到旧 token 触发的 401，这通常来自浏览器旧会话或登录前请求，不是接口卡死；重新登录后自动策略接口返回正常。

### 当前结论

- 以本次复查结果看，当前没有复现页面卡死、自动策略接口阻塞或核心组件 CrashLoop。
- 若用户浏览器仍卡住，优先检查浏览器旧 token、前端缓存和是否再次被 VPN/TUN 改写集群网段路由。

---

## 2026-04-26：WebUI pending 根因复现与自动恢复

### 现象

- 浏览器开发者工具中出现大量请求 pending：
  - 字体文件
  - `version`
  - `alerts`
  - `config-v2?source=navbar`
  - `favicon`
- 命令行直连 WebUI 时，服务端响应正常。

### 根因

- Mihomo/Clash TUN 重启后，会重新覆盖 policy route table `2022`。
- 覆盖后，`10.43.153.236` 与 `10.43.0.10` 会再次走 `Mihomo` 虚拟网卡，而不是本地 k3s 的 `cni0`。
- 复现时路由为：
  - `10.43.153.236 via 198.18.0.2 dev Mihomo table 2022`
  - `10.43.0.10 via 198.18.0.2 dev Mihomo table 2022`
- 这会导致浏览器访问 Kubernetes ClusterIP、CoreDNS 或 WebUI 资源时 pending。

### 修复

- 重新执行 `ops/microsegx-local/vpn-bypass-k3s.sh` 后，路由恢复为：
  - `10.43.153.236 dev cni0 table 2022`
  - `10.43.0.10 dev cni0 table 2022`
- 修改脚本，使其可由普通用户或 root 执行。
- 新增 systemd timer：
  - `microsegx-k3s-vpn-bypass.service`
  - `microsegx-k3s-vpn-bypass.timer`
- timer 已安装并启用，会每 30 秒幂等恢复：
  - `10.42.0.0/16 dev cni0 table 2022`
  - `10.43.0.0/16 dev cni0 table 2022`

### 验证

- WebUI 首页返回 200，约 17ms。
- `Roboto-Regular` 字体返回 200，约 13ms。
- `main.js` 返回 200，约 27ms。
- CoreDNS 查询正常：
  - `microsegx-service-webui.microsegx.svc.cluster.local -> 10.43.153.236`
  - `nginx.web.svc.cluster.local -> 10.43.43.222`

### 注意

- 如果浏览器自身使用独立代理插件，并且代理没有绕过 `10.0.0.0/8`，仍可能绕过系统路由继续 pending。
- 最稳定访问入口是 NodePort：
  - `https://192.168.198.128:30001/`
  - 或本机访问 `https://127.0.0.1:30001/`

---

## 2026-04-27：前端无限 loading 与 overview 聚合接口阻塞修复

### 现象

- 用户反馈页面不是简单变慢，而是像卡死一样，放几个小时没有变化，也没有明显报错。
- 重点路径：
  - `/microsegx/overview`
  - `/policy/auto/rule`

### 排查结论

- 真实 Token 访问 `/policy/auto/rule` 能快速返回，通常在 100ms 以内，不是主要卡点。
- `/microsegx/overview` 是聚合接口，会串行调用 port-audit dashboard、Ziti session、Ziti overview 等下游接口。
- 修复前串行请求可到 8 秒以上，并发 8 个 overview 请求时，有 5 个超过 12 秒没有任何响应。
- Angular 原有 `TimeoutInterceptor` 名称容易误导，它只处理 401/408/503 跳转逻辑，并没有真正给 HTTP 请求设置超时。
- 因此只要某个 HTTP 请求卡在 pending，组件里的 `loading=true` 与 `refreshInFlight=true` 就可能长期不释放，表现为“页面无报错卡死”。

### 修复内容

- 前端全局 HTTP 拦截器增加真实请求超时：
  - `/microsegx/overview`：15 秒
  - `policy/auto/*`：15 秒
  - `/microsegx/api/*`：20 秒
  - 其他 GET：60 秒
  - 其他非 GET：120 秒
- 后端 `MicrosegxService.getOverview()` 增加短 TTL 缓存：
  - 默认缓存 10 秒
  - 避免多个组件或多个页面同时进入时重复打 port-audit/Ziti 聚合接口
- 后端 overview 下游调用增加短超时：
  - 默认 4 秒
  - 可通过 `MICROSEGX_OVERVIEW_UPSTREAM_TIMEOUT_SECONDS` 调整
- overview 聚合失败时返回降级 JSON，而不是让页面一直等。
- manager 镜像已重新构建并部署：
  - `local.microsegx/nv/manager:2026.04.27-loading-timeout-r1`

### 验证结果

- 前端 production build 通过。
- manager `sbt admin/compile` 与 `sbt admin/assembly` 通过。
- 部署后真实 Token 单请求：
  - `/microsegx/overview` 返回 200，约 2.85 秒。
  - `/policy/auto/rule` 返回 200，约 82ms。
  - `/policy/auto/status` 返回 200，约 83ms。
  - `/policy/auto/feature` 返回 200，约 22ms。
  - `/policy/auto/event` 返回 200，约 75ms。
- 部署后并发 8 个 `/microsegx/overview`：
  - 全部返回 200。
  - 耗时约 2.7 到 3.4 秒。
  - 未再出现 12 秒无响应超时。
- 部署后并发 12 个 `/policy/auto/rule`：
  - 全部返回 200。
  - 耗时约 0.4 到 0.85 秒。

### 当前判断

- 这次问题不是单纯 API 不返回，也不是单纯代理问题。
- 更准确的根因是：
  - overview 聚合接口抗并发差，存在长时间 pending 风险。
  - 前端没有真实请求超时，导致 pending 请求可以无限占住 loading 状态。
- 现在已经从前后端两侧限制了无限等待。

---

## 2026-04-26：DNS/VPN 拦截排查与零信任 DNS 名恢复

### 问题现象

- `ziti-router`、`microsegx-manager`、`k8s-port-audit` 内访问 Kubernetes Service DNS 时异常。
- 典型异常：
  - `*.svc.cluster.local` 返回 NXDOMAIN。
  - `service.namespace.svc` 被解析为 `198.18.*`。
  - OpenZiti host.v1 目标如果写成 Kubernetes DNS，会出现访问失败。

### 根因判断

- 不应该把 OpenZiti host.v1 或 manager 到 port-audit 的地址长期改成 ClusterIP。
- 实际问题是宿主机 Mihomo/Clash TUN 的策略路由拦截了 Kubernetes 集群流量：
  - `ip route get 10.43.0.10` 命中 `table 2022`，走 `Mihomo`。
  - Pod 访问 kube-dns ServiceIP `10.43.0.10:53` 时，Service DNAT 后需要到 CoreDNS Pod CIDR `10.42.*`，但该路径也可能被 Mihomo 表接走。
  - 直连 CoreDNS Pod IP `10.42.0.25:53` 能正确解析，说明 CoreDNS 本体不是坏的。

### 本轮运行时修复

- 在 Mihomo 策略路由表中加入 Kubernetes Pod / Service CIDR 例外：
  - `sudo ip route replace 10.42.0.0/16 dev cni0 table 2022`
  - `sudo ip route replace 10.43.0.0/16 dev cni0 table 2022`
- 排查期间曾临时调整 CoreDNS Corefile；根因确认后已恢复为 k3s 默认 CoreDNS 形态，最终修复点保留在 VPN 绕过路由上。
- 修复后验证：
  - Pod 通过 `10.43.0.10` 可解析 `kubernetes.default.svc.cluster.local`。
  - Pod 通过 `10.43.0.10` 可解析 `nginx.web.svc.cluster.local`。
  - Pod 通过 `10.43.0.10` 可解析 `microsegx-service-webui.microsegx.svc.cluster.local`。
  - Pod 通过 `10.43.0.10` 可解析 `k8s-port-audit.port-audit.svc.cluster.local`。
  - Pod 通过 `10.43.0.10` 可解析 `ziti-controller-client.openziti.svc.cluster.local`。

### 配置恢复

- 已把 OpenZiti host.v1 配置恢复为 DNS 名：
  - `port-audit-bind-config -> k8s-port-audit.port-audit.svc.cluster.local:8080`
  - `port-audit-host-config -> k8s-port-audit.port-audit.svc.cluster.local:8080`
  - `nginx-host-v1 -> nginx.web.svc.cluster.local:80`
  - `mc-service-host-config -> microsegx-service-webui.microsegx.svc.cluster.local:8443`
- 已把 port-audit 的 Ziti controller 默认地址恢复为 DNS 名：
  - `https://ziti-controller-client.openziti.svc.cluster.local:31280`
- 已把 manager 到 port-audit 的地址恢复为 DNS 名：
  - `http://k8s-port-audit.port-audit.svc.cluster.local:8080`

### 代码与脚本调整

- 部署脚本不再默认把 port-audit 地址回填为 ClusterIP。
- 新增本地辅助脚本：
  - `ops/microsegx-local/vpn-bypass-k3s.sh`
  - 用于 Mihomo/Clash TUN 开启时恢复 `10.42.0.0/16 -> cni0` 的绕过路由。

### 当前验证结果

- manager Pod 内可以通过 DNS 访问 port-audit：
  - `http://k8s-port-audit.port-audit.svc.cluster.local:8080/api/ziti/session` 返回 200。
- `ziti-router` Pod 内可以通过 DNS 解析并访问业务服务：
  - `nginx.web.svc.cluster.local:80` 返回 200。
  - `microsegx-service-webui.microsegx.svc.cluster.local:8443` 返回 307，说明已到达 WebUI 服务。

### 注意事项

- 该绕过规则是运行时路由。如果 Mihomo/Clash TUN 重启后重建 table 2022，需要重新执行：
  - `ops/microsegx-local/vpn-bypass-k3s.sh`
- 长期原则：
  - OpenZiti host.v1 仍使用 Kubernetes DNS 名。
  - manager 到 port-audit 仍使用 Kubernetes DNS 名。
  - 不把 ClusterIP 写入长期配置。

---

## 2026-04-26：零信任不封直连，只做分路径学习的二次校正与部署验证

### 用户侧澄清

- 零信任访问不需要自动影响或关闭非零信任访问通道。
- 正确目标是：
  - 零信任链路和普通直连链路分开学习。
  - 零信任链路和普通直连链路分开管控。
  - 零信任链路和普通直连链路分开判断。
  - 前端显示时能明确看到不同的两条链路。

### 本轮代码校正

- 继续确认没有保留 `zero_trust_deny` 类别。
- `traffic_source=zero_trust` 的判断收紧为：
  - 源端是 OpenZiti / ziti 代理组件发起的链路，才视为零信任数据路径。
  - 仅仅访问到 `ziti-controller`，不再被当成“零信任业务链路”。
- 因此：
  - `nv.ziti-router.openziti -> nv.nginx.web` 会显示为 `zero_trust`。
  - `Workload:ingress -> nv.ziti-controller.openziti` 会显示为 `ingress`。
  - `nv.direct-curl.web -> nv.nginx.web` 会显示为 `direct`。

### 部署

- 重新构建并部署 controller：
  - `make -C microsegx/controller`
  - `docker build -t local.microsegx/nv/controller:2026.04.05-microsegx-r1 ...`
  - `k3s ctr -n k8s.io images import`
  - `kubectl rollout restart -n microsegx deployment/microsegx-controller-pod`
- controller 已成功滚动更新。
- manager 仍使用上一轮已部署的前端构建。

### 真实流量验证

验证用例一：普通业务直连。

```text
direct-curl.web -> nginx.web
```

结果：

- 临时 `direct-curl-verify` Pod 访问 `nginx.web.svc.cluster.local:80` 成功。
- 自动策略 feature 中观察到：
  - `from = nv.direct-curl.web`
  - `to = nv.nginx.web`
  - `traffic_source = direct`
  - `stage = observing`

验证用例二：零信任代理侧到同一业务目标。

```text
ziti-router.openziti -> nginx.web
```

结果：

- 自动策略 feature 中观察到：
  - `from = nv.ziti-router.openziti`
  - `to = nv.nginx.web`
  - `traffic_source = zero_trust`
  - `stage = observing`
- 这说明同一个 nginx 目标下，普通直连链路和零信任链路已经被拆成两条候选链路，没有被合并。

验证用例三：入口访问 OpenZiti 控制面。

```text
Workload:ingress -> ziti-controller.openziti
```

结果：

- 自动策略 feature 中现在显示：
  - `traffic_source = ingress`
- 不再误归类为 `zero_trust`。

### 仍需注意

- `ziti-router` 容器内直接 `curl nginx.web.svc.cluster.local:80` 当前仍超时。
- 但自动策略已经能观察到 `ziti-router -> nginx` 的连接尝试。
- 因此当前结论应写成：

> 自动策略已经能够把零信任链路和普通直连链路分开学习、分开统计、分开展示；但 OpenZiti 到 nginx 的完整业务访问闭环还需要继续排查客户端/隧道侧实际拨号问题。

### 验证命令结果摘要

- `go test ./controller/cache ./controller/rest` 通过。
- controller rollout 成功。
- 状态接口显示：
  - `direct_feature_count > 0`
  - `zero_trust_feature_count > 0`
  - `ingress_feature_count > 0`
- 同一目标 `nv.nginx.web` 下已同时存在：
  - `nv.direct-curl.web -> nv.nginx.web`，来源 `direct`
  - `nv.ziti-router.openziti -> nv.nginx.web`，来源 `zero_trust`
- controller 构建通过：
  - `make -C microsegx/controller`
- manager assembly 通过：
  - `sbt admin/assembly`
- 本地镜像已重建并导入 k3s：
  - `local.microsegx/nv/controller:2026.04.05-microsegx-r1`
  - `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
- 已滚动重启并确认：
  - `microsegx-controller-pod` Running
  - `microsegx-manager-pod` Running
  - `microsegx-enforcer-pod` Running
  - `microsegx-scanner-pod` Running
  - `ziti-router` Running

---

## 2026-04-26：自动策略对象筛选重做与取消 system guard 默认保护

### 用户侧问题

- 自动策略页的“业务/命名空间筛选”会出现 `xx -> xx` 这种边格式，筛选含义不清晰。
- 筛选框旁存在文字被遮挡的问题。
- `system guard` 自动生成了大量价值不高的默认保护规则，其中部分对象不在当前 Pod 列表里，而且这类虚拟规则不属于普通可老化规则，影响判断。
- 观察视图里的“零信任发布路径”来自 OpenZiti 配置合成，不是真实学习到的流量/规则，对当前排查帮助不大。

### 本轮修复

- 自动策略页规则视图与观察视图的对象筛选改为两级模型：
  - 一级：命名空间，多选。
  - 二级：Pod / 工作负载，多选。
  - 不选择表示全部。
  - 选择命名空间后，Pod / 工作负载下拉只展示这些命名空间内的对象。
- 筛选项只来自端点对象：
  - 来源命名空间
  - 目标命名空间
  - 来源 Pod / 工作负载
  - 目标 Pod / 工作负载
- 不再把 `from -> to` 的组合边作为筛选项。
- 调整筛选框样式：
  - 增大筛选框宽度。
  - 允许多选值正常展示。
  - 增加对象筛选清除按钮。
- 删除观察视图里的“零信任发布路径”配置面板。
  - 页面现在只展示真实自动策略特征、真实自动规则和自动策略事件。
  - 零信任流量仍通过 `traffic_source=zero_trust` 标识，但必须来自真实观察/学习链路。
- 取消 `system guard` 默认保护：
  - 默认不再生成 `system_guard` 虚拟规则。
  - 默认不再把这类规则加入编译链路。
  - 默认不再在自动策略规则列表里展示这类规则。
  - 保留隐藏环境开关 `AUTO_POLICY_SYSTEM_GUARD=true`，仅作为以后需要恢复时的手动选项。

### 设计取舍

- 这次没有再用“业务”作为主筛选项，因为当前后端的 `business` 字段更像从 group name 提取的摘要，不适合作为精确筛选维度。
- 当前更可靠的维度是：
  - 命名空间
  - Pod / 工作负载对象
  - 流量来源类型
  - 规则类别
  - 搜索框
- 零信任配置路径被删除后，页面不会再给人一种“已经学习到了某条零信任链路”的错觉；是否学习成功，只看真实观察特征和真实规则。

### 验证

- Go 测试通过：
  - `go test ./controller/cache ./controller/rest`
- 前端生产构建通过：
  - `npm run build -- --configuration production`
- controller 构建通过：
  - `make -C microsegx/controller`
- manager assembly 通过：
  - `sbt admin/assembly`
- 本地镜像已重建并导入 k3s：
  - `local.microsegx/nv/controller:2026.04.05-microsegx-r1`
  - `local.microsegx/nv/manager:2026.04.05-microsegx-r1`
- 已滚动重启并确认：
  - `microsegx-controller-pod` Running
  - `microsegx-manager-pod` Running
  - `microsegx-enforcer-pod` Running
  - `microsegx-scanner-pod` Running
- controller 启动日志确认：
  - `system_guard_enabled=false`

---

## 2026-04-26：零信任链路与普通链路分开学习、分开展示

### 用户侧澄清

- 零信任流量不应该自动导致普通直连通道被关闭。
- 正确目标是：
  - 零信任链路独立学习。
  - 入口链路独立学习。
  - 普通业务链路独立学习。
  - 前端能清楚看到三类链路，而不是把它们混成一条规则或一条边。

### 本轮修复

- 取消“零信任伴生直连拒绝”方向：
  - 不新增 `zero_trust_deny` 规则类别。
  - 不因为 `ziti-router -> nginx` 已学习，就自动生成 `ingress -> nginx` deny。
- 增强连接归因：
  - 当连接端点被临时表示为 `Workload:<IP>`，但 controller 能从 `ipWLMap` 反查到真实 Pod 时，会恢复为真实 workload ID。
  - 这样网络活动图和自动策略观察面都更容易显示成真实链路，例如 `ziti-router -> nginx`，而不是 `Workload:<IP> -> nginx`。
- 自动策略后端增加按链路来源统计：
  - `zero_trust_feature_count`
  - `ingress_feature_count`
  - `direct_feature_count`
  - 对应规则计数也同步输出。
- 自动策略 UI 增加链路来源概览：
  - 零信任链路
  - 入口链路
  - 普通链路
  - 每类同时显示候选链路数与已生成规则数。
- 保持原有筛选能力：
  - 命名空间多选
  - Pod / 工作负载多选
  - 流量来源筛选
  - 搜索

### 当前零信任运行验证结果

- `ziti-router -> microsegx-service-webui.microsegx.svc.cluster.local:8443` 可达。
- `ziti-router -> nginx.web.svc.cluster.local:80` 当前超时。
- `microsegx-manager -> nginx.web.svc.cluster.local:80` 可达。
- `microsegx-enforcer -> nginx Pod IP:80` 可达。
- OpenZiti controller 侧检查：
  - `nginx-service` 存在。
  - `nginx-host-v1` 指向 `nginx.web.svc.cluster.local:80`。
  - `nginx-service` 已有 `ziti-router` tunnel terminator。
  - policy-advisor 显示 `mc-client -> nginx-service` Dial OK，`ziti-router -> nginx-service` Bind OK。

### 当前判断

- 自动策略链路分离逻辑已经实现并通过单元测试。
- nginx 这条零信任业务访问链路当前还需要继续排查 OpenZiti 客户端侧/隧道侧实际拨号，因为直接在 `ziti-router` 容器里 curl 目标服务会超时，而其他 Pod 到 nginx 是通的。
- 这意味着：
  - 后端“如何分开学习”的逻辑已具备。
  - 但要在页面上看到真实 `ziti-router -> nginx` 学习结果，还需要先让实际零信任请求成功打到 nginx。

### 验证

- Go 测试通过：
  - `go test ./controller/cache ./controller/rest`
- 前端生产构建通过：
  - `npm run build -- --configuration production`

## 2026-04-27：恢复自动策略学习输入与修正失效规则判定噪声

### 问题现象

- 自动策略页面没有新学习规则。
- `/policy/auto/status` 一度显示：
  - `feature_count=0`
  - `observed_event_count=0`
  - `last_window_event_count=0`
- enforcer 日志显示：
  - `Controller endpoint is not ready`
  - `Failed to send connections`
  - `No known Consul servers`
  - `Connection map full`

### 根因

- enforcer 没有成功加入 controller 集群，连接事件无法发送到 controller。
- live 环境中的 `CLUSTER_JOIN_ADDR` 曾被部署脚本改成 controller ClusterIP，Consul/leader 发现不稳定。
- 改成短 DNS `microsegx-svc-controller.microsegx` 后，在 hostNetwork/VPN 环境下曾被解析到 `198.18.0.19` fake-ip。
- 因此最终使用完整集群 DNS：
  - `microsegx-svc-controller.microsegx.svc.cluster.local`

### 修复内容

- live 环境：
  - enforcer `CLUSTER_JOIN_ADDR` 改为完整 Kubernetes DNS。
  - scanner `CLUSTER_JOIN_ADDR` 改为完整 Kubernetes DNS。
  - 重启 enforcer/scanner，清空 enforcer 内部堆满的连接缓存。
- 部署脚本：
  - `ops/full-release/deploy-core.sh` 默认不再写 controller ClusterIP。
  - 默认 join 地址改为 `microsegx-svc-controller.<namespace>.svc.cluster.local`。
  - artifact bundle 内同名部署脚本同步修正。
- 系统保活规则：
  - 删除固定组名兜底生成逻辑。
  - 只基于当前真实存在的 group/workload/service 生成保活规则。
  - 避免生成大量不存在 Pod 对应的 `system_guard` 规则。

### 验证结果

- enforcer 已重新注册成功：controller 日志出现 `AgentAdmissionRequest` 与 `agentUpdate`。
- 自动策略观察恢复：
  - `/policy/auto/status` 显示 `feature_count=23`。
  - `last_window_event_count=10`。
  - `zero_trust_feature_count=4`。
- 零信任链路可被观察到，例如：
  - `nv.ziti-router.openziti -> nv.nginx.web | app:1001 | zero_trust`
- 系统保活规则从 46 条降到 4 条。
- 4 条系统保活规则均为 live：
  - stale 数量为 0。
  - 内容仅为 `ziti-controller/ziti-router -> microsegx webui service tcp/8443`。
- Go 测试通过：
  - `go test ./controller/cache`

### 当前失效规则判定说明

- 自动规则列表中的 `stale=true` 当前不是按“多久没访问”判断。
- `stale=true` 的含义是：
  - 规则的源组或目标组当前没有可用成员或服务地址。
  - 即 `from_live=false` 或 `to_live=false`。
- 规则长期不用的自动删除逻辑是另一套机制：
  - baseline / periodic 根据 `LastMatchAt` 或 `CreatedAt` 和 aging duration 判断是否删除。
  - anomaly deny 根据 `ExpiresAt` TTL 到期删除。
- 因此：
  - “疑似失效”适合用于找已不存在 Pod/Service/Group 的规则。
  - “长期未使用”适合用于自动老化回收。
  - 两者不是同一个判定。

## 2026-04-27：零信任快速准入与自动规则人工编辑

### 目标

- 只要流量被归因为零信任链路，就不再等完整 baseline 周期才允许进入候选/生成路径。
- 已生成的自动规则需要能人工调整分类，例如：
  - 基线允许。
  - 周期允许。
  - 异常拒绝。
- 人工调整后的规则不能被后续自动学习静默改回原分类。

### 后端实现

- 在自动策略决策阶段增加零信任快速准入：
  - 对 `traffic_source=zero_trust` 的观测特征，如果不是高置信异常且不属于忽略流量，则直接给出 `baseline allow` 决策。
  - 置信度按 `1 - S_anomaly` 计算，并设置下限 `0.65`。
  - 原因码加入：
    - `zero_trust_fast_admission`
    - `observed_zero_trust_path`
    - `auto_aging_enabled`
- 该规则仍然是普通自动规则：
  - 本体仍为 `CLUSPolicyRule`。
  - metadata 仍为 `CLUSAutoPolicyMeta`。
  - 后续仍走 baseline aging 自动老化删除。
- 增加自动规则编辑接口：
  - `PATCH /v1/policy/auto/rule/:id`
  - 支持把规则改为 `baseline / periodic / anomaly`。
  - `baseline / periodic` 对应 allow。
  - `anomaly` 对应 deny，并写入 TTL。
  - `periodic` 保存周期槽。
  - 保存后写入 `manual_override` 原因码。
- 自动引擎增加人工覆盖保护：
  - 如果某条同源/同目标/同协议特征已经有 `manual_override` 自动规则，自动学习不会再生成另一条相同特征的 allow/deny 去覆盖它。

### 前端实现

- 自动策略规则列表新增“编辑”按钮。
- 规则详情侧栏也新增“编辑”入口。
- 新增编辑弹窗：
  - 三段式分类选择：基线允许 / 时间约束允许 / 异常拒绝。
  - 置信度输入。
  - 周期规则槽位输入。
  - 异常拒绝 TTL 输入。
  - 人工原因说明输入。
- 弹窗样式与现有自动策略页面保持浅色卡片风格，主体区域可滚动，避免表单在小屏幕下被遮挡。
- `system_guard` 是虚拟系统保活规则，当前不支持改类；可以删除抑制，但不能重新分类。

### 验证

- Go 单元测试通过：
  - `go test ./controller/cache`
  - `go test ./controller/rest`
- 前端生产构建通过：
  - `npm run build`
- manager jar 构建通过：
  - `bash ./make_jar.sh`
- 已构建并部署镜像：
  - `local.microsegx/nv/controller:2026.04.27-zt-edit-r1`
  - `local.microsegx/nv/manager:2026.04.27-zt-edit-r1`
- live 集群恢复后核心组件状态：
  - controller Running
  - manager Running
  - enforcer Running
  - scanner Running
  - ziti-controller Running
  - ziti-router Running
- 接口验证：
  - `/policy/auto/status` 正常返回。
  - `/policy/auto/rule` 正常返回。
  - `/policy/auto/feature` 正常返回，响应不再卡死。
  - `PATCH /policy/auto/rule/:id` 路由已打通，非法分类会返回 400，说明 manager 代理和 controller 路由均已生效。
- 零信任快速准入验证：
  - `/policy/auto/feature` 中可见零信任候选带有 `zero_trust_fast_admission`。
  - 示例：
    - `nv.ziti-router.openziti -> nv.nginx.web`
    - `class_hint=baseline`
    - `action_hint=allow`

### 部署过程中的环境问题

- 本次部署时节点出现 `DiskPressure`，原因是多轮镜像 tar 和 Docker build cache 占用磁盘。
- 已处理：
  - 删除 `/tmp/microsegx-*.tar`。
  - 执行 Docker build cache prune。
  - 清理大量 Evicted Pod。
  - 重启 k3s 让 kubelet 重新计算磁盘状态。
- 当前节点：
  - `DiskPressure=False`
  - taint 已清除。
  - 根分区约 21G 可用。

---

## 2026-04-27：周期规则运维化编辑与页面文案整理

### 背景

- 原编辑弹窗把周期规则直接暴露为 `periodic_slots` 数字列表。
- 这些 slot 是控制器内部时间槽，不适合运维人员直接理解和维护。
- 页面上还有部分偏实现侧的词，例如“周期槽”“promotion”“源工作负载覆盖率”，容易造成误解。

### 前端调整

- 周期规则编辑从“手工填写槽号”改成“选择生效时间”：
  - 生产口径下按“周一至周日 + 开始时间 + 结束时间”配置。
  - 实验口径下按“第 N 个实验周期”选择。
  - 提供“全部 / 工作日 / 周末 / 清空”等快捷按钮。
  - 弹窗内显示“保存后生效”的自然语言预览。
- 底层仍然向后端提交 `periodic_slots`：
  - 前端负责把运维可读的时间窗口换算成控制器内部 slot。
  - 后端协议不变。
- 周期展示文案调整：
  - “周期槽摘要”改为“生效时间窗口”。
  - “活跃槽”改为“活跃时间窗口”。
  - 生产口径展示为类似 `周一 09:00-09:30`。
  - 实验口径展示为类似 `第 1 个实验周期`。
- 筛选框体验调整：
  - 多选筛选框选中内容居中显示。
  - 多选较多时展示为“第一项 等 N 项”，避免文字挤出或遮挡。
  - 工作负载下拉列表显示为两行：工作负载名 + 命名空间。
- 指标文案调整：
  - “源工作负载覆盖率”改为“源组实例覆盖率”。
  - 增加说明：表示同一源组内已经观察到产生该流量的实例比例，比例越高越像稳定业务基线。
  - “待 promotion”改为“待生成规则”。

### 验证与部署

- 前端生产构建通过：
  - `npm run build`
- manager jar 构建通过：
  - `bash ./make_jar.sh`
- 已构建并部署 manager 镜像：
  - `local.microsegx/nv/manager:2026.04.27-periodic-ui-r2`
- 集群状态验证：
  - manager pod 已滚动更新并处于 `Running`。
  - controller / enforcer / scanner 仍处于 `Running`。
  - 页面入口 `/` 正常返回新的前端资源。

### 2026-04-27 追加调整：关闭实验加速口径

- 发现 `AUTO_POLICY_DISTINCT_DAY_DURATION=60s` 时，页面只能表达“第几个模拟周期”，无法体现“每天 08:00-17:00”这类真实运维语义。
- 已将当前 controller 运行参数切回真实时间口径：
  - `AUTO_POLICY_DISTINCT_DAY_DURATION=24h`
  - `AUTO_POLICY_SLOT_MINUTES=30`
  - `AUTO_POLICY_WINDOW_SECONDS=30`
  - 移除显式 `AUTO_POLICY_FEATURE_RETENTION_SECONDS`，恢复由控制器按 14 天计算。
- 当前接口确认：
  - `distinct_day_seconds=86400`
  - `slot_minutes=30`
  - `feature_retention_seconds=1209600`
- 这样周期规则编辑会展示真实星期与时间段，例如“周一 08:00-17:00”，而不是实验周期。

### 2026-04-27 追加调整：周期弹窗多时间段与手动添加规则

- 周期规则编辑继续运维化：
  - 支持为同一组星期配置多个时间段。
  - 预览按自然星期顺序聚合展示，不再因为底层 slot 从 Unix 周四起算而显示成“周四开头”。
  - 同一天时间段要求结束时间晚于开始时间。
  - 跨过 24:00 的时间段必须显式勾选“跨到次日”，例如 `22:00 -> 次日 02:00`。
  - 弹窗主体增加高度限制和滚动，避免低分辨率下无法看到保存按钮。
- 增加手动添加自动规则能力：
  - controller 新增 `POST /v1/policy/auto/rule`。
  - manager 新增对应代理 `POST /policy/auto/rule`。
  - 前端自动策略页增加“添加规则”按钮。
  - 手动创建的规则仍写入 auto metadata，可继续在页面里改成基线、周期或异常拒绝。
- 验证：
  - `npm run build` 通过。
  - `go test ./controller/cache ./controller/rest ./controller/api` 通过。
  - 用临时规则验证 `POST /policy/auto/rule` 创建路径和删除路径均可用，验证后已删除临时规则。
- 部署：
  - controller 镜像：`local.microsegx/nv/controller:2026.04.27-auto-create-r1`
  - manager 镜像：`local.microsegx/nv/manager:2026.04.27-auto-create-r1`
  - controller / manager / enforcer / scanner 当前均为 `Running`。
- 当前计数核对：
  - `feature_count=0`，因为 controller 滚动更新后内存观察候选被清空，后续业务流量会重新进入观察窗口。
  - `baseline_rule_count=8`，其中 `zero_trust_rule_count=5`、`ingress_rule_count=3`。
  - `periodic_rule_count=0`、`anomaly_rule_count=0`。
  - `promotion_count=0`、`delete_count=0`，测试动作后已通过 controller 重启清理内存统计。

### 2026-04-27 追加调整：清理异常 Pod 并恢复 enforcer / scanner / port-audit

- 清理内容：
  - 删除各命名空间中历史残留的 `Completed`、`Error`、`ContainerStatusUnknown`、`Init:ContainerStatusUnknown` Pod。
  - 保留所有当前 `Running` 的业务 Pod 与平台 Pod。
- enforcer / scanner：
  - controller 重启后，旧 enforcer 虽然 Pod 为 `Running`，但日志中持续出现 `Controller endpoint is not ready` 与 `No known Consul servers`，说明控制连接未恢复。
  - 已滚动重启 `microsegx-enforcer-pod` DaemonSet 与 `microsegx-scanner-pod` Deployment。
  - controller 日志确认：
    - `Add or update enforcer`
    - `scannerRegister`
    - `ScannerUpdateHandler`
  - scanner 日志确认：
    - `scannerRegisterStream: Stream send done`
- port-audit：
  - `k8s-port-audit` 删除异常 Pod 后重新创建仍失败，根因是 Deployment 使用 `local/k8s-port-audit-stack:0.2.2` 且 `imagePullPolicy=Never`，但该镜像未导入 k3s containerd。
  - 已导入本地构建产物：
    - `k8s-node-surface/dist/k8s-port-audit-stack-local-0.2.2/k8s-port-audit-stack-0.2.2.tar`
  - 已滚动重启 `port-audit/k8s-port-audit`，当前 `k8s-port-audit` 与 `port-audit-ziti-host` 均为 `Running`。
- 当前集群状态：
  - `kubectl get pods -A --field-selector=status.phase!=Running` 返回 `No resources found`。
  - `microsegx-enforcer-pod` DaemonSet 为 `1/1`。
  - `microsegx-scanner-pod` Deployment 为 `1/1`。
  - `k8s-port-audit` `/healthz` 返回 `ok`。

### 2026-04-27 追加调整：自动策略规则弹窗与计数文案修正

- 弹窗滚动修复：
  - 添加规则 / 修改规则弹窗改为固定高度布局。
  - 只有弹窗内容区滚动，底部“取消 / 保存”按钮固定可见。
  - 阻止滚轮事件穿透到背后的页面，避免滚动弹窗时页面本体跟着滚。
- 周期规则时间编辑：
  - 去掉“跨到次日”复选框。
  - 周期规则只接受当天时间段，结束时间必须晚于开始时间。
  - 结束时间 `00:00` 作为特殊语义，表示到当天结束。
  - 需要跨天时由用户拆成不同日期的两段，例如：
    - 周一 `22:00-00:00`
    - 周二 `00:00-02:00`
  - 预览不再把相邻日期合并成“次日”，而是按实际选择的日期和时间段展示。
- 计数文案修正：
  - `观察事件` 改为 `当前窗口事件`。
  - `候选特征` 改为 `观察特征`。
  - `已生成 / 已回收` 改为 `本次启动后生成 / 回收`，避免误解成总规则数。
- 验证：
  - `npm run build` 通过。
  - `manager/make_jar.sh` 通过。
  - manager 镜像已构建并部署：
    - `local.microsegx/nv/manager:2026.04.27-modal-count-r1`
  - 当前 manager Pod 为 `Running`。
  - 本地 jar 与 Pod 内 jar SHA256 一致：
    - `8604543bac7fc2d835e5de5c73d5798c730bb55a78f8215d59e82e46789ded17`
  - 静态 i18n 验证已返回新文案：
    - `当前窗口事件`
    - `观察特征`
    - `本次启动后生成 {{promotion}} / 回收 {{delete}}`
- 当前状态接口核对：
  - `mode=shadow`
  - `observed_event_count=10`
  - `feature_count=26`
  - `zero_trust_feature_count=3`
  - `zero_trust_rule_count=5`
  - `ingress_feature_count=11`
  - `ingress_rule_count=3`
  - `direct_feature_count=9`
  - `direct_rule_count=0`
  - `baseline_rule_count=8`
  - `periodic_rule_count=0`
  - `anomaly_rule_count=0`
  - `pending_promotion_count=0`
  - `promotion_count=0`
  - `delete_count=0`

### 2026-04-27 追加调整：规则编辑弹窗可用性与网络规则计数修正

- 自动策略添加 / 编辑弹窗：
  - 提高弹窗层级，避免被页面其它元素或下拉层遮挡。
  - 将规则类型切换区改成弹窗内容顶部的固定区域，选择“时间约束允许”后仍可随时切回“基线允许”或“异常拒绝”。
  - 周期规则增加“保存后生效”总览，以标签形式展示所有选择出来的生效时间段，避免多个时间段挤在一行看不清。
  - 周期规则明细仍在下方编辑，弹窗内部滚动，底部取消 / 保存按钮保持固定可见。
  - 手动添加规则时，源和目标从当前规则视图与观察视图已识别到的工作负载 / 规则组下拉选择，不再要求用户手写组名。
  - 弹窗内输入框、下拉框文字居中显示，降低筛选框和表单内容看起来偏移的问题。
- 网络规则页计数：
  - 总计不再统计默认规则行 `id=-1`。
  - 总计按当前“全部 / 自动 / 旧学习 / 用户”与自动规则类别筛选后的基础列表计算。
  - 快速搜索启用时显示“搜索结果数 / 当前基础列表数”，避免与来源筛选混算。
- 验证：
  - `npm run build` 通过。
  - `manager/make_jar.sh` 通过。
  - manager 镜像已构建并部署：
    - `local.microsegx/nv/manager:2026.04.27-modal-count-r2`
  - 当前 `microsegx` 命名空间核心组件均为 `Running`：
    - controller
    - manager
    - enforcer
    - scanner
  - 本地 jar 与 Pod 内 jar SHA256 一致：
    - `f4861c25c9b0cfcbdc9b1cf768aaf4e66633e869819d4d0c12432b3e19642cea`
  - 静态 i18n 验证已返回新文案：
    - `共 {{count}} 个时间段`
    - `CREATE_ENDPOINT_HINT`

### 2026-04-27 追加调整：ServiceIP 不再作为自动策略学习与展示对象

- 问题判断：
  - Kubernetes Service 的 ClusterIP 会被旧连接预处理链路归入 `nv.ip.<service>.<namespace>`。
  - 这类对象适合作为“归因线索”，不适合作为自动策略的主语，因为最终管控对象应是具体 workload / pod 归属组。
- 后端修复：
  - 自动策略 observer 在生成特征前先解析 `nv.ip.*`。
  - 优先将 `nv.ip.<service>.<namespace>` 映射到同名 workload 组。
  - 如果同名 workload 组不存在，则读取 ServiceIP group 中保存的 namespace 与 selector label，再匹配当前运行中的 workload，归并到实际 learned group。
  - 无法解析的 `nv.ip.*` 不再进入自动策略特征、promotion、编译和状态接口。
  - 历史遗留的 `nv.ip.*` 自动候选会在特征清理中删除；历史遗留的 `nv.ip.*` 自动规则会在 controller 启动、TTL tick 和规则清理中删除，并且不再参与编译。
  - 手工新增 / 修改自动规则时拒绝使用 `nv.ip.*` 作为源或目标。
  - 连接归一化也会把可解析的 ServiceIP 节点改写成 workload group，减少网络活动视图里出现 ServiceIP 主语。
- 前端修复：
  - 自动策略页的 namespace / endpoint 筛选项不再生成 ServiceIP 分类。
  - 即使后端短时间内返回历史 `nv.ip.*`，也不会进入添加规则下拉选项。
  - ServiceIP 不再作为运维筛选维度展示。
- 验证：
  - `go test ./controller/cache` 通过。
  - 新增单测覆盖：
    - 同名 ServiceIP 到 workload group 的解析。
    - Service selector 到实际 workload group 的解析。
    - ServiceIP 旧候选特征自动清理。
  - `npm run build` 通过。
  - `manager/make_jar.sh` 通过。
  - controller 二进制构建通过。
  - 已部署镜像：
    - `local.microsegx/nv/controller:2026.04.27-no-serviceip-r2`
    - `local.microsegx/nv/manager:2026.04.27-no-serviceip-r1`
  - 当前 `microsegx` 命名空间核心组件均为 `Running`：
    - controller
    - manager
    - enforcer
    - scanner

### 2026-04-27 追加调整：周期规则编辑支持多组生效时间

- 问题判断：
  - 后端周期规则本体保存的是 `periodic_slots` 槽集合，天然可以表示任意星期与任意时间段的组合。
  - 原前端编辑弹窗把“星期集合”和“时间段集合”做成全局配置，保存时会对二者做笛卡尔积，因此无法表达“周一、周二 08:00-17:00，同时周日 19:00-20:00”这类不同日期不同时间段的规则。
- 前端修复：
  - 将周期规则编辑器改为“多组生效时间”。
  - 每组包含独立的星期选择和独立的时间段列表。
  - 保存时只在同一组内部组合星期与时间段，不同组之间取并集后生成 `periodic_slots`。
  - 编辑已有周期规则时，会按实际槽集合还原为多组配置，避免把不同日期的时间段错误合并成全局时间段。
  - 增加中文/英文说明，明确每组的组合关系和使用示例。
- 学习逻辑确认：
  - 自动学习仍基于后端 `SlotCounters` 和 `PeriodicSlots` 槽集合，不受前端“多组编辑器”限制。
  - 学习得到的周期槽可以是任意分布，前端现在只是把这种任意分布用更可运维的方式展示和编辑。
- 验证：
  - `npm run build` 通过。
  - `manager/make_jar.sh` 通过。
  - 已部署 manager 镜像：
    - `local.microsegx/nv/manager:2026.04.27-periodic-blocks-r1`
  - 当前 `microsegx` 命名空间核心组件均为 `Running`。
  - 本地 jar 与 Pod 内 jar SHA256 一致：
    - `f0df47a3da61abf31f37a6b98980c0e975472a00014cd65b93f5651ba5cf8f8b`

### 2026-04-27 追加调整：自动策略编辑弹窗避免被顶栏遮挡

- 问题判断：
  - 原自动策略编辑弹窗使用页面内自定义 fixed 容器。
  - 由于主内容区与顶栏属于不同 stacking context，即使弹窗自身 `z-index` 很高，也可能被固定顶栏压住。
- 前端修复：
  - 将自动策略添加 / 编辑弹窗外层改为原生 `dialog`。
  - 打开规则编辑或添加规则时调用 `showModal()`，让浏览器将弹窗放入 top layer。
  - 保留原弹窗内部滚动、底部固定操作区、点击遮罩关闭和 Esc 关闭逻辑。
  - 为 `dialog::backdrop` 设置遮罩和背景模糊，避免依赖页面内遮罩层级。
- 验证：
  - `npm run build` 通过。
  - `manager/make_jar.sh` 通过。
  - 已部署 manager 镜像：
    - `local.microsegx/nv/manager:2026.04.27-dialog-toplayer-r1`
  - 当前 `microsegx` 命名空间核心组件均为 `Running`。
  - 本地 jar 与 Pod 内 jar SHA256 一致：
    - `d7bd54f1f4e77ac55b063ed346671dffc0dcbc8fa3c022b49b8f6509cfe65d56`

### 2026-04-27 追加调整：网络规则页主表字段收敛

- 问题判断：
  - 网络规则页主表同时展示了 `rule_source`、`auto_policy_class`、置信度、最近观察时间、周期槽、过期时间等自动策略内部字段。
  - 这些字段适合放在规则详情中解释，不适合全部堆到主表里，否则会导致表头显示不全、横向空间紧张，并增加运维判断成本。
- 前端修复：
  - 主表保留运维直接需要的字段：规则 ID、源、目标、应用、端口、动作、类型、规则来源、更新时间、命中次数、最近命中和操作。
  - 将多列自动策略内部字段合并为一个“规则来源”列。
  - “规则来源”列区分：
    - 自动策略
    - 旧版学习
    - 手动/平台
  - 自动策略规则在同一列下附带显示分类：基线允许、时间约束允许、异常拒绝。
  - 置信度、周期槽、过期时间、最近观察等解释性信息继续保留在选中规则后的自动策略详情卡中。
  - 表头启用换行和自适应高度，减少字段名被截断的问题。
  - 主网络规则页启用内置分页，默认每页 50 条，可切换 25 / 50 / 100 / 200 条，避免规则很多时一页过长。
  - 筛选按钮增加数量展示。
  - 如果当前没有旧版 learned 规则，则不再显示“旧版学习”筛选按钮，避免空筛选项误导。
- 当前环境确认：
  - `object/config/policy/default/rule/` 共 9 条规则。
  - `object/config/auto_policy/rule/` 共 8 条自动策略元数据。
  - 旧版 learned 规则数量为 0。
  - 因此当前页面不显示“旧版学习”筛选是预期行为，不是规则丢失。
- 验证：
  - `npm run build` 通过。
  - `manager/make_jar.sh` 通过。
  - `git diff --check` 通过。
  - 已部署 manager 镜像：
    - `local.microsegx/nv/manager:2026.04.27-network-rules-clean-r3`
  - 当前 `microsegx` 命名空间核心组件均为 `Running`：
    - controller
    - manager
    - enforcer
    - scanner
  - 本地 jar 与 Pod 内 jar SHA256 一致：
    - `23d083efd92ee085787890156082e7dc6f8bc20a3e53a20d8d97878d6707a15b`

### 2026-04-29 追加调整：网络规则页增加旧版学习对照栏

- 问题判断：
  - 当前自动策略模式下，旧版 learned 规则不再作为主要运行时依据。
  - 当前环境中真实旧版 learned 规则数量可能为 0，导致网络规则页没有可用于论文对照实验的旧版规则数据。
  - 仅展示 policy store 中真实 legacy learned 规则不足以支撑“原系统 learned 结果 vs 新系统自动策略结果”的实验对比。
- 前端修复：
  - 网络规则页新增“旧版对照”筛选栏。
  - “旧版对照”不是实际策略规则，而是根据自动策略观察特征推导出的旧版 learned 机制可能生成的 allow 规则预览。
  - 旧版对照行使用虚拟负 ID、只读状态和禁用样式。
  - 旧版对照不会进入 `networkRules` 提交数组，不会写入 KV，也不会参与 controller 策略编译和数据面下发。
  - “全部”计数仍只统计真实规则；“旧版对照”单独统计，避免把实验对照数据误认为当前生效策略。
  - 增加中文/英文提示，明确该栏“只读、不生效、仅用于实验对比统计”。
- 实验意义：
  - 可在同一页面对比：
    - 自动策略规则数量
    - 真实旧版 learned 规则数量
    - 基于当前观察流量估算的旧版 learned 对照规则数量
  - 便于论文中说明新系统避免逐连接即时学习后，规则生成口径与旧系统的差异。
- 验证：
  - `node` JSON 解析校验中英文 i18n 通过。
  - `npm run prebuild && npx ng build --configuration production` 通过。
  - 构建仅有既有 optional-chain 和 SCSS budget 警告，无新增编译错误。
  - `manager/make_jar.sh` 通过。
  - 已部署 manager 镜像：
    - `local.microsegx/nv/manager:2026.04.29-legacy-preview-r1`
  - 当前 manager deployment 镜像已切换到上述标签。
  - 本地 jar 与 Pod 内 jar SHA256 一致：
    - `3d3451e82d885bc3692298356d72e5cb03c06cff9d9c39ece9042975ab6f9365`
  - 已通过 ClusterIP 请求确认新前端入口资源：
    - `main.d95f757dbe2bd16a.js`
    - `runtime.f7e1d0bde7e0c224.js`
    - `styles.bede070094951ef0.css`
  - 已通过 i18n 静态资源确认页面包含“旧版对照”等新增中文文案。

### 2026-04-29 追加调整：零信任接入链路与端口审计节点扫描准入

- 问题判断：
  - OpenZiti 访问不是单一的 `ziti-router -> 业务 Pod`，还包括客户端到 `ziti-controller-client`、客户端到 `ziti-router-edge` 的接入/控制链路。
  - 如果只学习后端代理链路，前半段 `workload/client -> ziti-router` 或 `workload/client -> ziti-controller` 可能没有被允许，导致后端规则已经生成但命中计数不增长。
  - `k8s-port-audit -> nodes` 是端口暴露面检测的基础链路，不应被自动策略系统过滤掉。
  - 但节点扫描会访问大量端口，若按普通端口集合展示和生成，会造成页面端口列表过长且不便运维。
- 后端修复：
  - 取消对 `nv.k8s-port-audit.port-audit -> nodes/Host:*` 的忽略逻辑。
  - 将 `k8s-port-audit -> Host:*` 归一为单条 `k8s-port-audit -> nodes` 候选特征。
  - 对端口审计节点扫描启用快速准入，生成基线允许规则，而不是等待普通 3 天稳定性阈值。
  - 对端口审计节点扫描规则的端口输出压缩为单个协议全范围，例如 `tcp/1-65535`，避免前端出现大段端口列表。
  - 将所有涉及 OpenZiti controller/router 的流量统一归类为 `zero_trust`，包括：
    - 客户端/工作负载到 `ziti-controller`
    - 客户端/工作负载到 `ziti-router`
    - `ziti-router` 到后端业务工作负载
    - OpenZiti 与 DNS、证书、管理面相关的辅助链路
  - 对 zero-trust 链路继续保留快速准入能力，使其在学习模式下先观察，在保护模式下可较快生成 allow。
- 设计边界：
  - 本次没有恢复旧版 learned 即时学习。
  - 端口审计和零信任链路仍然是“观察到后学习出来”的规则，不是无条件平台默认规则。
  - `AUTO_POLICY_MODE=shadow` 时只观察和展示，不下发；切到 `enforce` 后才参与运行时编译。
- 验证：
  - `go test ./controller/cache -run 'TestAutoPolicy|TestCompileActiveAutoRules'` 通过。
  - 已重建并部署 controller 镜像：
    - `local.microsegx/nv/controller:2026.04.29-ziti-portaudit-r1`
  - `microsegx-controller-pod` 已完成滚动更新并处于 `Running`。

### 2026-04-29 追加修复：手动规则删除被自动规则保护逻辑误拦截

- 问题判断：
  - 后端为保护自动策略一致性，已禁止通过通用网络规则接口直接修改或删除自动规则。
  - 手动规则本身不属于自动规则，理论上应该允许删除。
  - 实际删除失败的原因是前端提交删除时，不只提交待删除规则 ID，还会把列表中未修改的规则以“仅 ID 占位”的形式一并放入替换 payload。
  - 当列表里存在自动规则时，后端自动规则只读校验会把这些“仅 ID 占位”的自动规则误判为不完整修改，从而拒绝整个请求。
- 前端修复：
  - 纯删除操作现在只提交 `{ delete: [...] }`，不再附带未修改规则列表。
  - 删除标记逻辑改为按规则 ID 集合匹配，避免多选删除或排序变化时误标记。
  - 新增/临时虚拟规则不会进入删除数组，避免提交不存在的负 ID 或前端临时 ID。
- 后端兼容修复：
  - 自动规则保护校验增加“仅 ID 占位规则”兼容。
  - 如果 payload 中的自动规则只有 `id` 而没有实际字段变更，后端将其视为未修改，不再阻止同一请求中的手动规则删除。
  - 仍然保留对自动规则本体修改、删除的拒绝，避免自动规则 metadata 与规则本体失配。
- 验证：
  - `go test ./controller/rest ./controller/cache -run 'TestAutoPolicy|TestCompileActiveAutoRules|TestPolicy'` 通过。
  - `npm run prebuild && npx ng build --configuration production` 通过。
  - `manager/make_jar.sh` 通过。
  - 已重建并部署：
    - `local.microsegx/nv/manager:2026.04.29-manual-delete-r1`
    - `local.microsegx/nv/controller:2026.04.29-manual-delete-r1`
- 部署处理：
  - 首次滚动时节点出现 `DiskPressure`，导致大量新 Pod 被 Evicted，并触发本地 `imagePullPolicy: Never` 镜像丢失问题。
  - 已临时停止滚动重建、删除 Failed/Evicted Pod、清理本次构建 tar 文件和 Docker buildx 缓存。
  - 已将运行必需镜像重新导入 k3s/containerd：
    - manager
    - controller
    - controller init 旧镜像
    - scanner
    - enforcer
    - updater
    - k8s-port-audit
  - 当前节点 `DiskPressure=False`，根分区约 83% 使用率。
  - 当前核心组件均为 `Running`：
    - microsegx controller
    - microsegx manager
    - microsegx enforcer
    - microsegx scanner
    - OpenZiti controller/router
    - k8s-port-audit
