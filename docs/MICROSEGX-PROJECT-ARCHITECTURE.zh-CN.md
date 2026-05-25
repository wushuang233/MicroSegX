# MicroSegX 项目结构与系统架构图

本文档用于快速说明当前 `MicroSegX` 项目的整体代码结构、运行时组件关系、自动网络策略学习链路、端口暴露与零信任接入链路，以及策略编译下发链路。

本文档偏向“给论文、答辩、交接和后续开发使用”的结构说明，不展开具体代码实现。

---

## 1. 项目仓库结构图

```mermaid
flowchart TB
    Repo["MicroSegX 仓库根目录"]

    Repo --> Core["microsegx<br/>核心安全平台"]
    Repo --> Manager["manager<br/>Web 管理端与管理服务"]
    Repo --> Scanner["scanner<br/>漏洞/镜像扫描组件"]
    Repo --> Helm["microsegx-helm<br/>Kubernetes 部署模板"]
    Repo --> PortAudit["k8s-node-surface<br/>端口暴露治理与审计"]
    Repo --> Ziti["openziti<br/>零信任部署与集成资产"]
    Repo --> Ops["ops<br/>本地构建、交付和部署脚本"]
    Repo --> Docs["docs<br/>设计、执行、部署和说明文档"]
    Repo --> Artifacts["artifacts / docker-images / stage / target<br/>构建产物与本地交付物"]

    Core --> Controller["controller<br/>策略、缓存、REST、自动学习引擎"]
    Core --> Agent["agent<br/>节点侧 agent / enforcer 逻辑"]
    Core --> DP["dp<br/>数据面策略执行"]
    Core --> Share["share<br/>公共类型、协议、KV key、gRPC proto"]
    Core --> Upgrader["upgrader<br/>升级与证书任务"]

    Manager --> WebUI["admin/webapp<br/>Angular 前端"]
    Manager --> AdminSvc["admin<br/>Scala 管理服务"]
    Manager --> ManagerPkg["package<br/>manager 镜像打包"]

    PortAudit --> PortBackend["k8s_port_audit<br/>端口扫描与 Kubernetes 资源归因"]
    PortAudit --> PortWeb["web<br/>端口暴露治理前端/辅助界面"]
    PortAudit --> PortZiti["ziti<br/>端口治理与零信任联动脚本"]
```

---

## 2. 运行时总体架构图

```mermaid
flowchart LR
    subgraph UserSide["用户侧"]
        Browser["浏览器 / 运维人员"]
        ZitiClient["OpenZiti Client / Tunnel"]
    end

    subgraph K8s["Kubernetes 集群"]
        subgraph MicroSegXNS["microsegx 命名空间"]
            ManagerPod["microsegx-manager<br/>Web UI + 管理服务"]
            ControllerPod["microsegx-controller<br/>策略控制面 / REST API / 自动学习"]
            EnforcerPod["microsegx-enforcer<br/>节点流量观察与策略执行"]
            ScannerPod["microsegx-scanner<br/>镜像与漏洞扫描"]
            KV["内置 KV / Consul<br/>配置、规则、元数据"]
        end

        subgraph ZitiNS["openziti 命名空间"]
            ZitiController["ziti-controller<br/>零信任控制器"]
            ZitiRouter["ziti-router<br/>零信任边缘路由"]
        end

        subgraph PortAuditNS["port-audit 命名空间"]
            PortAuditPod["k8s-port-audit<br/>端口扫描与暴露面归因"]
            ZitiHost["port-audit-ziti-host<br/>零信任 host/tunnel 辅助组件"]
        end

        subgraph BizNS["业务命名空间"]
            Frontend["业务 Pod / frontend"]
            Backend["业务 Pod / backend"]
            DB["业务 Pod / db / redis / mysql"]
        end
    end

    Browser -->|"HTTPS 8443"| ManagerPod
    ManagerPod -->|"REST / 反向代理"| ControllerPod
    ControllerPod <--> KV
    ControllerPod -->|"策略计算结果"| EnforcerPod
    EnforcerPod -->|"连接事件 / workload 状态"| ControllerPod
    EnforcerPod -->|"数据面策略执行"| Frontend
    EnforcerPod -->|"数据面策略执行"| Backend
    EnforcerPod -->|"数据面策略执行"| DB

    ScannerPod -->|"扫描任务/结果"| ControllerPod
    PortAuditPod -->|"Kubernetes API / 端口扫描"| ControllerPod
    ManagerPod -->|"端口暴露与零信任页面"| PortAuditPod

    ZitiClient -->|"零信任接入"| ZitiRouter
    ZitiRouter <--> ZitiController
    ZitiRouter -->|"代理访问业务服务"| Frontend
    ZitiRouter -->|"代理访问业务服务"| Backend
    ZitiHost -->|"辅助暴露/托管服务"| ZitiController
```

说明：

- `manager` 面向浏览器，负责页面、管理入口和部分管理代理逻辑。
- `controller` 是核心控制面，负责资源缓存、策略生成、策略编译、REST API 和自动策略引擎。
- `enforcer` 是节点侧关键组件，负责观察真实网络连接并执行下发的策略。
- `scanner` 负责镜像/漏洞扫描能力。
- `k8s-port-audit` 负责端口暴露面扫描、归因和治理。
- `openziti` 负责零信任接入能力。

---

## 3. 自动网络策略学习链路

```mermaid
flowchart TB
    Traffic["真实业务流量<br/>Pod -> Pod / Ingress -> Pod / Ziti -> Pod"]
    Enforcer["enforcer<br/>节点侧连接观察"]
    Conn["CLUSConnection<br/>连接事件"]
    UpdateConnections["controller/cache/connect.go<br/>UpdateConnections()"]
    Normalize["端点归因与归一化<br/>workload / group / namespace / traffic_source"]
    Observer["auto_policy_observer.go<br/>observeAutoPolicyEvent()"]
    Window["观察窗口缓存<br/>autoObservedEvent"]
    Aggregate["窗口聚合<br/>autoWindowAggregate"]
    Feature["特征状态<br/>autoFeatureState"]

    Score["三类评分"]
    Baseline["baseline score<br/>稳定业务基线"]
    Periodic["periodic score<br/>时间集中/周期行为"]
    Anomaly["anomaly score<br/>异常/威胁/爆发行为"]

    Decision["自动决策"]
    Continue["继续观察"]
    BaselineRule["baseline allow<br/>基线允许规则"]
    PeriodicRule["periodic allow<br/>时间约束允许规则"]
    AnomalyRule["anomaly deny<br/>异常拒绝规则"]

    PolicyRule["CLUSPolicyRule<br/>规则本体"]
    AutoMeta["CLUSAutoPolicyMeta<br/>自动规则元数据"]
    KV["KV Store<br/>policy/default/rule + auto_policy/rule"]
    Compile["策略编译<br/>calculateIPPolicyFromCache()"]
    Push["下发 enforcer<br/>CLUSGroupIPPolicy / DerivedPolicyRule"]
    Runtime["数据面执行"]

    Traffic --> Enforcer --> Conn --> UpdateConnections --> Normalize --> Observer --> Window --> Aggregate --> Feature --> Score
    Score --> Baseline
    Score --> Periodic
    Score --> Anomaly
    Baseline --> Decision
    Periodic --> Decision
    Anomaly --> Decision

    Decision --> Continue
    Decision --> BaselineRule
    Decision --> PeriodicRule
    Decision --> AnomalyRule

    BaselineRule --> PolicyRule
    PeriodicRule --> PolicyRule
    AnomalyRule --> PolicyRule
    BaselineRule --> AutoMeta
    PeriodicRule --> AutoMeta
    AnomalyRule --> AutoMeta

    PolicyRule --> KV
    AutoMeta --> KV
    KV --> Compile --> Push --> Runtime
```

自动策略学习的核心原则：

- 不是每条连接立即生成规则。
- 连接先进入观察窗口。
- 窗口内相同通信行为被聚合成特征。
- 特征再根据稳定性、周期性和异常性进行评分。
- 只有达到条件后才 promotion 为正式规则。

---

## 4. 自动策略核心数据模型

```mermaid
classDiagram
    class CLUSConnection {
        AgentID
        HostID
        ClientWL
        ServerWL
        ClientIP
        ServerIP
        ClientPort
        ServerPort
        IPProto
        Application
        Bytes
        Sessions
        PolicyAction
        PolicyId
        Violates
        ThreatID
        Severity
        FQDN
    }

    class autoObservedEvent {
        Key
        FromWL
        ToWL
        Port
        FQDN
        ObservedAt
        ThreatID
        Severity
        Violates
    }

    class autoFeatureKey {
        From
        To
        IsApp
        IPProto
        Application
    }

    class autoFeatureState {
        Key
        FirstObserved
        LastObserved
        ConsecutiveWindows
        TotalWindows
        DistinctDays
        SrcWorkloadsSeen
        Ports
        FQDNs
        SlotCounters
        BaselineScore
        PeriodicScore
        AnomalyScore
    }

    class CLUSPolicyRule {
        ID
        From
        To
        Ports
        Applications
        Action
        CfgType
        MatchCntr
        LastMatchAt
    }

    class CLUSAutoPolicyMeta {
        RuleID
        Class
        Confidence
        CreatedAt
        LastObserved
        ExpiresAt
        PeriodicSlots
        ReasonCodes
    }

    CLUSConnection --> autoObservedEvent : 归一化
    autoObservedEvent --> autoFeatureKey : 提取特征 key
    autoObservedEvent --> autoFeatureState : 窗口聚合更新
    autoFeatureState --> CLUSPolicyRule : promotion 生成规则本体
    autoFeatureState --> CLUSAutoPolicyMeta : promotion 生成元数据
    CLUSAutoPolicyMeta --> CLUSPolicyRule : RuleID 关联
```

说明：

- `CLUSPolicyRule` 是真正参与原有策略编译和下发的规则本体。
- `CLUSAutoPolicyMeta` 是新增元数据，用来表达自动策略分类、置信度、周期槽和 TTL。
- 自动规则复用 learned 规则段，但不进入旧版 learned 内存态。

---

## 5. 策略编译与运行时优先级

```mermaid
flowchart TB
    RuleMap["policyCache.ruleMap<br/>所有规则本体"]
    RuleHeads["policyCache.ruleHeads<br/>原始规则顺序"]
    AutoMetaMap["autoPolicyMetaMap<br/>自动规则分类元数据"]

    Bucket["稳定分桶编译"]
    Federal["1. Federal"]
    Ground["2. Ground"]
    AutoDeny["3. auto anomaly deny"]
    User["4. UserCreated"]
    AutoPeriodic["5. auto periodic allow<br/>只在当前时间槽激活"]
    AutoBaseline["6. auto baseline allow"]
    Legacy["7. legacy learned"]
    Default["8. mixed/default"]

    GroupPolicy["CLUSGroupIPPolicy"]
    Derived["CLUSDerivedPolicyRule"]
    EnforcerRuntime["enforcer 数据面匹配执行"]

    RuleMap --> Bucket
    RuleHeads --> Bucket
    AutoMetaMap --> Bucket

    Bucket --> Federal --> GroupPolicy
    Bucket --> Ground --> GroupPolicy
    Bucket --> AutoDeny --> GroupPolicy
    Bucket --> User --> GroupPolicy
    Bucket --> AutoPeriodic --> GroupPolicy
    Bucket --> AutoBaseline --> GroupPolicy
    Bucket --> Legacy --> GroupPolicy
    Bucket --> Default --> GroupPolicy

    GroupPolicy --> Derived --> EnforcerRuntime
```

运行时顺序的含义：

- 平台治理规则优先。
- 自动异常拒绝规则高于用户以下的自动允许规则。
- 用户手动规则保留明确优先级。
- 周期允许规则只在当前时间槽命中时注入。
- 旧版 learned 规则排在自动允许之后，便于逐步过渡。

---

## 6. 端口暴露治理与零信任链路

```mermaid
flowchart LR
    Browser["浏览器 / 管理员"]
    Manager["MicroSegX Manager<br/>端口暴露与零信任页面"]
    Controller["MicroSegX Controller<br/>统一 REST / 状态汇总"]

    subgraph PortAudit["端口暴露治理"]
        AuditScanner["k8s-port-audit<br/>扫描 NodePort / Ingress / HostPort / LoadBalancer"]
        K8sAPI["Kubernetes API<br/>Service / Ingress / Pod / Node"]
        Exposure["暴露面清单<br/>端口、服务、命名空间、资源归因"]
    end

    subgraph OpenZiti["OpenZiti 零信任"]
        ZitiCtl["ziti-controller"]
        ZitiRouter["ziti-router"]
        Identity["Identity / Service / Policy / Terminator"]
    end

    subgraph Business["业务服务"]
        Web["web/nginx/frontend"]
        API["backend/api"]
        DB["db/redis/mysql"]
    end

    Browser --> Manager
    Manager --> Controller
    Manager --> AuditScanner
    AuditScanner --> K8sAPI
    AuditScanner --> Exposure
    Exposure --> Manager

    Manager --> ZitiCtl
    ZitiCtl --> Identity
    ZitiRouter --> ZitiCtl
    ZitiRouter --> Web
    ZitiRouter --> API

    Controller -->|"自动策略观察普通入口流量"| Web
    Controller -->|"自动策略观察零信任代理流量"| ZitiRouter
```

说明：

- 端口暴露治理用于发现“哪些服务直接暴露在集群外部或节点端口上”。
- OpenZiti 用于提供零信任入口。
- 自动策略系统会把普通入口链路和零信任链路分开归因、分开学习、分开展示。

---

## 7. 前端页面与后端接口关系

```mermaid
flowchart TB
    UI["Angular Web UI"]

    UI --> Overview["概览页<br/>/microsegx/overview"]
    UI --> AutoPolicy["自动策略工作台<br/>/microsegx/auto-policy"]
    UI --> NetworkRules["网络规则页<br/>/policy/rule"]
    UI --> NetworkActivity["网络活动页<br/>/graph"]
    UI --> PortExposure["端口暴露及零信任页<br/>/microsegx/port-exposure"]
    UI --> ZitiPanel["零信任管理区<br/>折叠在端口暴露页面内"]

    AutoPolicy --> AutoStatusAPI["GET /policy/auto/status"]
    AutoPolicy --> AutoFeatureAPI["GET /policy/auto/feature"]
    AutoPolicy --> AutoRuleAPI["GET /policy/auto/rule"]
    AutoPolicy --> AutoEventAPI["GET /policy/auto/event"]
    AutoPolicy --> AutoConfigAPI["PATCH /policy/auto/config"]

    NetworkRules --> PolicyAPI["GET /policy<br/>POST/PATCH/DELETE policy/rule"]
    NetworkRules --> AutoRuleAPI

    NetworkActivity --> GraphAPI["GET /graph / network/history"]
    NetworkActivity --> AutoFeatureAPI
    NetworkActivity --> AutoRuleAPI

    PortExposure --> ExposureAPI["端口扫描/暴露面 API"]
    PortExposure --> ZitiAPI["OpenZiti API / controller CLI 回退"]

    AutoStatusAPI --> Controller["controller REST"]
    AutoFeatureAPI --> Controller
    AutoRuleAPI --> Controller
    AutoEventAPI --> Controller
    AutoConfigAPI --> Controller
    PolicyAPI --> Controller
    GraphAPI --> Controller
    ExposureAPI --> PortAudit["k8s-port-audit"]
    ZitiAPI --> OpenZiti["OpenZiti controller"]
```

---

## 8. 典型数据流：从业务访问到规则生效

```mermaid
sequenceDiagram
    participant Biz as 业务 Pod / 客户端
    participant Enforcer as Enforcer
    participant Controller as Controller
    participant Auto as Auto Policy Engine
    participant KV as KV Store
    participant UI as Web UI

    Biz->>Enforcer: 发起网络连接
    Enforcer->>Controller: 上报 CLUSConnection
    Controller->>Controller: UpdateConnections() 预处理与归因
    Controller->>Auto: observeAutoPolicyEvent()
    Auto->>Auto: 观察窗口聚合
    Auto->>Auto: baseline / periodic / anomaly 评分
    Auto-->>UI: /policy/auto/feature 展示候选

    alt 达到 promotion 条件
        Auto->>KV: 写入 CLUSPolicyRule
        Auto->>KV: 写入 CLUSAutoPolicyMeta
        Controller->>Controller: scheduleIPPolicyCalculation()
        Controller->>Enforcer: 下发编译后的策略
        Enforcer->>Biz: 执行 allow / deny
        Auto-->>UI: /policy/auto/rule 展示已生成规则
    else 未达到条件
        Auto-->>UI: 继续观察
    end
```

---

## 9. 论文/答辩推荐使用方式

建议在论文或答辩 PPT 中使用以下图：

- 总体架构：使用第 2 节“运行时总体架构图”。
- 核心创新：使用第 3 节“自动网络策略学习链路”。
- 数据模型：使用第 4 节“自动策略核心数据模型”。
- 工程闭环：使用第 5 节“策略编译与运行时优先级”。
- 外部板块：使用第 6 节“端口暴露治理与零信任链路”。

如果只能放一张总图，建议使用第 2 节；如果讲自动策略核心贡献，建议使用第 3 节。
