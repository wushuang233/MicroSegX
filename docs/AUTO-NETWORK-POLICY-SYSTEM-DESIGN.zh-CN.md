# MicroSegX 全自动网络策略系统改造设计文档

## 1. 文档目的

本文档用于指导 `MicroSegX` 当前网络规则策略系统的自动化改造，目标是在尽量复用现有 controller/agent/DP 链路的前提下，将当前“逐连接即时学习”的策略系统升级为“自动观察、自动分类、自动生成、自动淘汰”的全自动网络策略系统。

本文档覆盖：

- 背景与现状
- 目标与范围
- 总体架构
- 算法设计
- 详细实现方案
- 数据结构与 KV 设计
- 线程、锁、定时器与同步设计
- 测试与验证方法
- 里程碑与交付顺序
- 风险与回滚方案

本文档默认读者熟悉 Go 项目开发流程，但不要求先熟悉本仓库的全部细节。

### 1.1 与整篇毕业论文的关系

如果从整篇本科毕业论文的角度看，本项目不应只被理解为“改一个 NeuVector 模块”，而应被统一表述为：

> 面向 Kubernetes 集群场景下的安全防护需求，构建一套同时覆盖集群内部东西向通信控制与集群外部南北向访问控制的云主机微隔离系统。

建议将整篇论文分成两个板块，并明确主次关系：

1. 集群内部微隔离策略自动生成
   - 以 `MicroSegX / NeuVector` 二次开发为核心
   - 关注东西向流量自动学习、自动分类、自动生成策略
   - 这是论文的主要创新来源和核心技术板块

2. 集群外部暴露面治理与零信任访问控制
   - 以端口扫描归因、开放端口治理、访问入口收敛、身份认证授权为核心
   - 关注南北向访问面的工程治理
   - 这是论文的系统实现与应用落地板块

两者之间的统一主线建议写成：

> Kubernetes 集群安全防护应同时覆盖内部东西向通信和外部南北向访问两个维度，并在两个维度上尽可能实现自动化、最小暴露和零信任控制。

从篇幅与答辩重心上，建议：

- 内部微隔离策略自动生成：作为论文主板块，约占 40% 左右篇幅
- 外部暴露面治理与零信任访问控制：作为配套系统板块，约占 25% 左右篇幅
- 其余部分由绪论、相关工作、系统实现、实验与总结组成

---

## 2. 背景与现状

### 2.1 当前系统的工作方式

当前仓库中的网络策略主链路已经比较完整：

- 连接事件入口在 `controller/cache/connect.go`
  - 主处理函数：`UpdateConnections()`
- 学习逻辑入口在 `controller/cache/learn.go`
  - 即时学习函数：`addConnectToGraph()`
  - learned rule 生成：`learnAppPort()`
  - learned rule 落库：`procLearnedPolicy()`
- 策略编译入口在 `controller/cache/policy.go`
  - 编译函数：`calculateIPPolicyFromCache()`
  - 节点重组：`reorgPolicyIPRulesPerNode()`
  - slot 切片：`preparePolicySlotsCommon()`
- agent 接收 `CLUSGroupIPPolicy` 并下发 `CLUSDerivedPolicyRule`

关键事实：

- 当前系统已经具备完整的规则下发与数据面执行能力
- 当前 learned rule 以 `CLUSPolicyRule` 形式写入 KV
- 当前策略编译路径已经非常复杂，且 `rules[0]` 是特殊的默认地址表
- 当前规则命中统计已经存在，可用于后续老化逻辑

### 2.2 当前系统的主要问题

当前系统在自动学习方面存在以下结构性问题：

1. 逐连接即时学习
   - `addConnectToGraph()` 收到连接后，会直接调用 `learnAppPort()`
   - 偶发流量、调试流量、一次性探测流量很容易被写成正式规则

2. 规则粒度过粗
   - 当前 learned key 是 `groupPair{from,to,isApp}`
   - 同一组对的多个端口会被合并在一条 learned allow 规则中

3. 端口处理过于粗暴
   - 端口过多时会退化成 `any`
   - 这会显著扩大暴露面

4. 缺少自动异常拒绝机制
   - 当前系统能记录 `VIOLATE/DENY/ThreatID/Severity`
   - 但没有自动把高风险流量转成 deny 规则的机制

5. 缺少自动周期规则
   - 当前系统没有针对“固定时间窗重复出现的正常流量”建立时间约束规则

6. 缺少规则生命周期管理
   - learned rule 长期累计，不会根据真实使用情况自动淘汰

### 2.3 本次改造的基本原则

本次改造必须遵守以下原则：

1. 尽量不改 agent 与数据面协议
2. 尽量不改现有 `CLUSPolicyRule -> CLUSGroupIPPolicy -> CLUSDerivedPolicyRule` 主链路
3. 自动规则本体尽量复用现有 `CLUSPolicyRule`
4. 新增逻辑优先落在 controller/cache 与 controller/rest
5. 第一版优先实现“可行、可验证、可回滚”

---

## 3. 改造目标

### 3.1 总目标

将当前网络策略系统升级为全自动策略系统，使其能够基于连接行为自动生成以下三类规则：

- `baseline allow`
  - 表示长期稳定、反复出现、可信的业务基线流量
  - 在说明性语境下可类比“自动白名单”，但论文正文不建议直接作为正式术语

- `periodic allow`
  - 表示只在固定时间窗口内重复出现的正常流量
  - 属于带时间约束的自动允许规则

- `anomaly deny`
  - 表示高置信异常流量
  - 在说明性语境下可类比“自动黑名单”，但论文正文不建议直接作为正式术语

### 3.2 具体目标

1. 不再对每条连接即时落规则
2. 引入观察窗口与候选态
3. 对流量做稳定性判定
4. 对流量做时间模式判定
5. 对流量做异常风险识别
6. 自动生成 allow/deny 规则
7. 自动淘汰长期无用规则
8. 增加状态可观测能力

### 3.3 非目标

以下内容不在第一版范围内：

- 不修改 agent gRPC / protobuf 结构
- 不改 DP 匹配机制
- 不引入重型深度学习模型
- 不优先做增量策略重算
- 不做多 controller 候选态热同步
- 不做人工配置白名单/黑名单/周期规则

### 3.3.1 推荐论文正式措辞

为避免答辩时在术语上被追问，建议论文中优先使用以下正式表述：

- `baseline allow`
  - 基线允许规则
- `periodic allow`
  - 时间约束允许规则
- `anomaly deny`
  - 异常拒绝规则
- `multi-layer admission control`
  - 基于规则分类元数据和编译优先级的多层准入控制机制

不建议在论文标题、摘要和贡献点中直接使用：

- “自动白名单系统”
- “自动黑名单系统”
- “异常检测算法”

这些词可以只在讲解时作为直观类比出现。

### 3.4 论文定位与贡献边界

从本科毕业论文的角度，本文的核心贡献应聚焦在“自动学习策略优化”，而不是简单罗列功能点。

建议将贡献分成两类：

1. 核心研究贡献
   - 将逐连接即时学习改为窗口聚合学习
   - 将观测流量自动分类为 `baseline / periodic / anomaly`
   - 引入规则生命周期管理，形成自动生成与自动淘汰闭环

2. 工程支撑能力
   - `legacy / shadow / enforce` 三模式
   - 规则本体与 metadata 两层模型
   - 状态可观测接口与实验验证链路

同时需要明确以下“边界”，避免论文表述过度：

- 第一版不把“增量策略重算”作为论文贡献，除非后续真的实现
- 第一版的 `anomaly` 采用启发式威胁行为识别，不应直接表述为完整机器学习异常检测算法
- 第一版的端口归并是通过新自动引擎绕过旧 `learnAppPort()` 的 `MaxSvcPortNum` 路径实现，不应表述为“修改了原系统的固定阈值算法”

### 3.5 工程价值、真实性与创新边界

从工程和项目落地角度，建议把本项目分成三种性质来理解：

1. 真实工程价值
   - 解决当前系统“逐连接即时学习”导致的误学习问题
   - 降低 `any` 规则和过粗规则带来的暴露面
   - 引入 `shadow / enforce` 渐进部署，降低新策略直接上线的风险
   - 引入状态可观测与生命周期回收，提升系统长期可维护性

2. 真实创新点
   - 在不修改 agent 协议和数据面主链路的前提下，将原有 learned 策略链改造成“观察-聚合-评分-生成-回收”的闭环系统
   - 在 NeuVector/MicroSegX 既有架构内实现基于稳定性、周期性、异常性的三分类自动生成机制
   - 通过 metadata + 编译分桶的方式，在不新增通用 `CfgType` 的情况下表达多层准入控制

3. 不应夸大的部分
   - 这不是新的底层数据面匹配框架
   - 这不是新的通用零信任协议
   - 第一版不是完整机器学习异常检测系统
   - 第一版也不是面向超大规模集群的高可用分布式特征平台

因此，更准确的工程定位是：

> 本项目的核心价值在于对现有微隔离策略学习链路进行系统级重构和自动化增强，而不是发明一个全新的底层安全平台。

对本科毕设而言，这种“在真实开源系统上完成结构性增强”的系统创新是成立的，也比纯概念性算法更有落地价值。

---

## 4. 总体架构

### 4.1 总体思路

新系统不再把每一条连接直接映射成策略，而是把连接先送入自动策略观察引擎。

新流水线如下：

```text
连接事件
  -> 规范化
  -> 观察窗口聚合
  -> 行为特征提取
  -> 三类评分
      -> 稳定性评分
      -> 周期性评分
      -> 异常性评分
  -> 自动决策
      -> baseline allow
      -> periodic allow
      -> anomaly deny
      -> continue observing
  -> 规则落库
  -> 策略编译
  -> agent 下发
```

### 4.2 两层数据模型

为了最大限度复用现有链路，本次改造使用“两层模型”：

#### 第一层：自动规则本体

复用现有 `CLUSPolicyRule`

- `Action = allow` 或 `deny`
- `CfgType = Learned`
- 通过现有 learned rule ID 段分配 ID
- 直接走现有 `policyCache`、编译、下发链路

#### 第二层：自动规则元数据

新增 `CLUSAutoPolicyMeta`

用于记录：

- 规则类别：`baseline / periodic / anomaly`
- 置信度
- 观测时间
- 周期时间窗
- deny 规则过期时间
- 原因码

### 4.3 为什么不引入新的通用规则类型

不新增新的 `CfgType`，原因如下：

1. 当前通用规则体系强依赖现有 ID 分段
2. `PolicyRuleIdToCfgType()` 只对现有 4 段做强约束
3. 现有 REST、排序、rule head、cache、sync 都围绕现有类型展开
4. 新增通用类型会显著扩大改动面

因此：

- 自动规则本体复用 `Learned`
- 新类别放到 metadata 层表达

### 4.4 自动规则与旧 learned 内存态的隔离原则

这是第一版架构中非常关键的一条约束：

虽然自动规则本体在策略存储中复用 `CfgType = Learned`，但它们**不能**被视为旧 learned 引擎的内存态规则。

原因：

- 旧 learned 内存态使用 `lprWrapperMap map[groupPair]*learnedPolicyRuleWrapper`
- 该结构的 key 只有 `from/to/isApp`
- 它无法正确表达：
  - 同一组对下多个自动规则并存
  - `baseline / periodic / anomaly` 的分类差异
  - deny 与 allow 的差异
  - 周期时间窗与 TTL 等 metadata

因此第一版必须遵守：

1. 自动规则可以存入 policy store
2. 但自动规则**不能进入**旧 learned 的 `lprWrapperMap`
3. 自动规则**不能进入**旧 learned 的 graph hot sync learned rule 集合
4. 自动规则与旧 learned 仅在 policy store / policyCache 层共存，不在 learned 内存态层混用

这意味着需要在以下位置显式做“跳过 auto rule”处理：

- `SyncLearnedPolicyFromCluster()`
- `syncGraphTx()`
- `syncGraphRx()` 中 learned rule 恢复逻辑

判断依据：

- 若某个 `ruleID` 在 `autoPolicyMetaMap` 中存在，则该规则属于 auto rule
- 该规则参与策略编译，但不参与旧 learned 内存态恢复与热同步

---

## 5. 与当前仓库的对接点

### 5.1 连接入口

文件：

- `microsegx/controller/cache/connect.go`

关键函数：

- `UpdateConnections()`
- `preQualifyConnect()`
- `postQualifyConnect()`

当前连接处理顺序：

1. 预过滤
2. 更新命中统计
3. 预处理 endpoint
4. 调用 `addConnectToGraph()`

改造后：

1. 保留当前 graph/UI 逻辑
2. 新增 `observeAutoPolicyEvent(conn, ca, sa, stip)`
3. 新模式下关闭即时 `learnAppPort()`

### 5.2 学习入口

文件：

- `microsegx/controller/cache/learn.go`

关键函数：

- `addConnectToGraph()`
- `learnAppPort()`
- `procLearnedPolicy()`
- `startPolicyThread()`

改造后：

- `addConnectToGraph()` 负责 graph 和可视化属性
- 新 learned 规则不再由 `learnAppPort()` 即时生成
- 新的自动策略引擎批量生成规则后，复用类似 `procLearnedPolicy()` 的方式写入集群

### 5.3 策略编译入口

文件：

- `microsegx/controller/cache/policy.go`

关键函数：

- `calculateIPPolicyFromCache()`
- `reorgPolicyIPRulesPerNode()`
- `preparePolicySlotsCommon()`

最重要约束：

- `groupIPPolicies[0]` 必须保持是默认地址表
- 不能破坏 `rules[0]` 特殊语义

改造后：

- `rules[0]` 保持不变
- 自动规则的“运行时生效顺序”由 `calculateIPPolicyFromCache()` 的编译分桶逻辑控制，而不是简单等同于原始 `policyCache.ruleHeads` 顺序
- 如需让 UI/REST 展示顺序也与运行时完全一致，可在后续版本增加 rule head 重排逻辑；但第一版不把它作为强依赖

### 5.4 配置分发入口

文件：

- `microsegx/controller/cache/object.go`

关键函数：

- `configUpdate()`

改造后：

- 新增 `CFGEndpointAutoPolicy`
- 增加 `autoPolicyConfigUpdate()` 分支

要求：

- `autoPolicyConfigUpdate()` 在 metadata 新增、修改、删除时，必须触发 `scheduleIPPolicyCalculation(true)`
- 原因是 auto rule 的分类、TTL 或周期时间窗一旦变化，运行时编译结果必须及时刷新

### 5.5 初始化入口

文件：

- `microsegx/controller/cache/cache.go`

关键函数：

- `Init()`

改造后：

- 在 `startPolicyThread()` 之前完成 auto policy metadata bootstrap
- 初始化 auto policy engine
- 初始化缓存
- 初始化定时器和模式配置

初始化顺序要求：

1. 先加载 `autoPolicyMetaMap`
2. 再启动 `startPolicyThread()`
3. 然后再进行普通 config watch 与其他模块初始化

原因：

- `startPolicyThread()` 启动时会调用 `SyncLearnedPolicyFromCluster()`
- 若此时 auto metadata 尚未加载，就无法在 learned 恢复阶段识别并跳过 auto rules
- 这样会把 auto rules 误吸入旧 learned 的 `lprWrapperMap`

### 5.6 实验环境与部署假设

本方案在工程实现上应区分两类环境：

1. 开发与快速验证环境
   - 可使用单节点 k3s
   - 重点验证功能正确性、规则生成逻辑和实验流程
   - 允许引入“时间加速参数”缩短观察周期

2. 最终验证环境
   - 可迁移到一个小型 Kubernetes 集群，例如 `1 master + 2 worker`
   - 重点验证系统在多节点场景下的连通性、规则编译与真实流量行为
   - 第一版建议仍部署单 controller 实例，以降低分布式同步复杂度

因此：

- 方案本身不依赖单节点环境
- 但第一版为了可控性，建议在最终 3 节点集群上仍采用单 controller 验证模式
- 多 controller 候选态热同步不纳入第一阶段范围

---

## 6. 新增模块设计

### 6.1 auto_policy_types.go

职责：

- 定义自动规则元数据结构
- 定义特征 key / 特征状态
- 定义配置结构和状态结构

建议结构：

```go
type AutoPolicyClass string

const (
    AutoPolicyBaseline AutoPolicyClass = "baseline"
    AutoPolicyPeriodic AutoPolicyClass = "periodic"
    AutoPolicyAnomaly  AutoPolicyClass = "anomaly"
)

type CLUSAutoPolicyMeta struct {
    RuleID        uint32          `json:"rule_id"`
    Class         AutoPolicyClass `json:"class"`
    Confidence    float64         `json:"confidence"`
    CreatedAt     time.Time       `json:"created_at"`
    LastObserved  time.Time       `json:"last_observed"`
    ExpiresAt     time.Time       `json:"expires_at,omitempty"`
    PeriodicSlots []uint16        `json:"periodic_slots,omitempty"`
    ReasonCodes   []string        `json:"reason_codes,omitempty"`
}
```

### 6.2 auto_policy_observer.go

职责：

- 接收连接事件
- 归一化连接特征
- 放入窗口缓存

建议入口函数：

```go
func observeAutoPolicyEvent(conn *share.CLUSConnection, ca, sa *nodeAttr, stip *serverTip)
```

建议特征归一化规则：

- 使用 `node2Group()` 将 `ClientWL/ServerWL` 规范化到组级别
- 端口优先用 `utils.GetPortLink(proto, wlPort)` 保持现有语义
- 若有应用识别，保留 `Application`
- 保留 `FQDN`
- 记录时间窗槽位

### 6.3 auto_policy_engine.go

职责：

- 周期性处理窗口
- 聚合特征
- 更新特征状态
- 产生决策

核心流程：

1. drain 当前窗口连接事件
2. 聚合同类事件
3. 更新 feature state
4. 计算 baseline score / periodic score / anomaly score
5. 判断规则 promotion / modify / delete

实现约束：

- `drain` 必须是“先在 `graphMutex` 保护下复制切片并清空，再在锁外做聚合与评分”
- 不允许在连接主路径内直接做聚合、排序、统计检验或评分
- 第一版推荐使用预分配 `[]autoObservedEvent` 切片或环形缓冲区，不推荐在 `graphMutex` 持有期间做阻塞 channel 写入

### 6.4 auto_policy_periodic.go

职责：

- 时间槽统计
- 周期性评分
- 周期窗口提取

建议实现：

- 默认每 30 分钟一个时间槽
- 一周共 `7 * 48 = 336` 个槽
- 对每个 feature 记录每个槽出现次数

周期判定条件建议：

- 至少观察 7 天
- 高活跃槽数较少
- 槽内出现频率高
- 槽外出现频率低

### 6.5 auto_policy_anomaly.go

职责：

- 启发式威胁行为识别
- 自动 deny 候选判定

第一版采用启发式检测：

- 新颖性异常
- 时间异常
- 多端口爆发
- 多目标爆发
- 结合 `VIOLATE/DENY/Severity/ThreatID`

后续预留接口：

```go
type AnomalyDetector interface {
    Score(feature *autoFeatureState) (float64, []string)
}
```

### 6.6 auto_policy_store.go

职责：

- 元数据缓存
- KV 读写
- 加锁与事务写入

建议缓存：

- `autoPolicyMetaMap map[uint32]*share.CLUSAutoPolicyMeta`
- `autoPolicyFeatureMap map[autoFeatureKey]*autoFeatureState`

### 6.9 auto_policy_config.go

职责：

- 读取环境变量与默认参数
- 统一管理窗口、时间槽、实验加速参数和定时器周期

建议配置项：

```text
AUTO_POLICY_MODE=legacy|shadow|enforce
AUTO_POLICY_WINDOW_SECONDS=30
AUTO_POLICY_SLOT_MINUTES=30
AUTO_POLICY_DISTINCT_DAY_DURATION=24h
AUTO_POLICY_TTL_CHECK_SECONDS=300
```

其中：

- `AUTO_POLICY_WINDOW_SECONDS`
  - 控制观察窗口大小
- `AUTO_POLICY_SLOT_MINUTES`
  - 控制周期时间槽粒度
- `AUTO_POLICY_DISTINCT_DAY_DURATION`
  - 定义“统计意义上的一天”长度
  - 生产环境默认 24 小时
  - 测试环境可缩短，例如 60 秒
- `AUTO_POLICY_TTL_CHECK_SECONDS`
  - 控制 anomaly deny 的 TTL 清理频率

实验加速建议：

- 在单节点 k3s 或本地实验环境中，可将：
  - `AUTO_POLICY_DISTINCT_DAY_DURATION=60s`
  - `AUTO_POLICY_WINDOW_SECONDS=5`
  - `AUTO_POLICY_SLOT_MINUTES=1`
- 这样 baseline 和 periodic 规则可在分钟级完成验证
- 论文中应明确说明这是“实验加速参数”，用于缩短观测周期，不改变方法本身的判定逻辑

### 6.10 已冻结的一版实现决策

为避免后续开发和论文表述反复变化，第一版建议将以下决策视为固定：

1. 自动规则本体复用 `CLUSPolicyRule`
2. 自动规则分类信息使用独立 metadata
3. 不新增新的通用 `CfgType`
4. 不修改 agent 协议
5. 编译顺序通过编译阶段稳定分桶实现
6. anomaly deny 使用独立 TTL 清理 ticker
7. 实验阶段允许使用时间加速参数
8. 最终小型集群验证默认采用单 controller 实例

这些决策既是工程边界，也是后续论文表述边界。若后续版本需要突破这些边界，应单独作为“二期增强”讨论，而不是混入第一版目标。

### 6.7 auto_policy_compile.go

职责：

- 从 `policyCache.ruleMap + autoPolicyMetaMap` 中得到按当前时间生效的自动规则
- 控制自动规则注入顺序

### 6.8 auto_policy_status.go

职责：

- 提供状态只读接口所需的数据整理
- 输出候选、已生效规则、异常事件摘要、周期规则槽位等

---

## 7. 数据结构与 KV 设计

### 7.1 自动规则本体

自动规则本体继续使用 `CLUSPolicyRule`。

属性约定：

- `CfgType = share.Learned`
- `Action = share.PolicyActionAllow` 或 `share.PolicyActionDeny`
- `Ports` 使用现有端口串格式
- `Applications` 使用现有应用 ID 数组

这意味着：

- 现有 `policyConfigUpdate()` 可以直接接收这些规则
- 现有 `preQualifyConnect()` 能识别这些 `PolicyId`
- 现有命中统计会自动累计到这些 rule ID 上

### 7.2 自动规则元数据

新增 KV endpoint：

- `CFGEndpointAutoPolicy = "auto_policy"`

新增 store：

- `CLUSConfigAutoPolicyStore = CLUSConfigStore + CFGEndpointAutoPolicy + "/"`

建议 key 设计：

- `config/auto_policy/engine`
  - 保存引擎配置与模式
- `config/auto_policy/rule/<ruleID>`
  - 保存自动规则元数据

一致性要求：

- 自动规则本体与 metadata 必须由同一事务共同写入或删除
- 不允许出现“rule 已存在但 metadata 缺失”的长期状态
- 如果极端情况下发生 metadata 丢失，运行时可临时将该规则视为 `legacy learned`，但后台应记录告警并触发修复或清理

### 7.3 自动特征状态

第一版不做持久化，仅存内存。

原因：

- 特征状态体量较大
- 它是过程数据，不是最终策略数据
- 第一版可以接受 leader 切换后重新观察

后续如需增强 HA，可考虑单独热同步。

实现建议：

- `autoPolicyMetaMap` 的读写建议统一放在 `cacheMutex` 保护下
- 原因是编译主链路 `calculateIPPolicyFromCache()` 本身就在缓存读锁语义下运行，metadata 若复用相同锁域，能减少额外锁交叉复杂度
- `autoPolicyFeatureMap` 可以由自动策略引擎自己的互斥锁或窗口处理线程独占管理，不建议混入策略编译路径

规模假设与适用范围：

- 第一版仅做内存态 feature state，适合中小规模集群和本科毕设实验环境
- 对单节点 k3s 或中小规模测试集群而言，该方案的内存占用通常可接受
- 若后续面向大规模生产集群，需要进一步引入特征压缩、淘汰策略或热同步机制

控制器假设：

- 若在最终验证环境中采用 `1 master + 2 worker` 的小型 Kubernetes 集群，但 controller 仍保持单实例部署，则：
  - feature state 内存态方案依然成立
  - 不需要处理 controller 间候选特征一致性
  - 不需要处理 leader 切换导致的状态同步问题
- 若后续扩展为多 controller 实例部署，则应重新评估候选态同步问题

---

## 8. 规则分类逻辑

### 8.1 baseline allow

表示长期稳定的业务基线流量。

第一版建议采用可解释的加权评分，而不是纯 if-else 拼接。

定义归一化特征：

- `f_consecutive = min(ConsecutiveWindows / Wc, 1.0)`
- `f_total = min(TotalWindows / Wt, 1.0)`
- `f_days = min(DistinctDays / Dreq, 1.0)`
- `f_srccov = min(SrcWorkloadSeen / max(SrcGroupSize, 1), 1.0)`
- `f_safe = 1 - S_anomaly`

其中推荐默认值：

- `Wc = 6`
- `Wt = 12`
- `Dreq = 3`

baseline 稳定度分数：

```text
S_baseline =
    0.30 * f_consecutive +
    0.25 * f_total +
    0.20 * f_days +
    0.15 * f_srccov +
    0.10 * f_safe
```

推荐 promotion 条件：

- `S_baseline >= 0.75`
- `DistinctDays >= 3`
- `S_anomaly <= 0.30`
- 未被识别为高周期性流量

说明：

- 这里的 `SrcGroupSize` 可由 `groupCacheMap[group].members` 近似计算
- 若目标组是单实例数据库，目标覆盖率不适合作为硬条件，因此第一版不把 `DstGroupSize` 放入主评分公式
- 该公式适合论文写作，也便于后续做消融实验和参数对比

promotion 后：

- 生成 `Action=allow`
- `Class=baseline`

### 8.2 periodic allow

表示只在固定时间窗口内出现的正常通信。

第一版采用固定时间槽模型，不引入复杂 cron 学习。

时间槽定义：

- 每 30 分钟一个槽
- 一周共 `7 * 48 = 336` 个槽

对每个 feature，记第 `i` 个槽的观测次数为 `c_i`，则：

```text
p_i = c_i / Σ c_i
H = - Σ (p_i * log(p_i))
S_concentration = 1 - H / log(336)
```

其中：

- `H` 为时间槽分布熵
- `S_concentration` 越高，说明流量越集中在少数时间槽，周期性越强

再定义：

- `f_days = min(DistinctDays / 7, 1.0)`
- `f_repeat = RepeatedTopSlots / max(ActiveSlots, 1)`
- `f_outside = 1 - OutsideSlotHitRatio`

周期性分数：

```text
S_periodic =
    0.45 * S_concentration +
    0.25 * f_days +
    0.20 * f_repeat +
    0.10 * f_outside
```

推荐 promotion 条件：

- `DistinctDays >= 7`
- `S_periodic >= 0.70`
- `S_baseline < 0.85` 或其明显呈现时间集中性

说明：

- 相比只用“活跃槽数少于 X”这种硬阈值，熵更适合论文写作，因为它能量化“时间分布是否集中”
- 若后续需要更强统计解释，可再补充 Gini 系数作为对比，但第一版不建议同时上两套指标

promotion 后：

- 生成 `Action=allow`
- `Class=periodic`
- metadata 中记录 `PeriodicSlots`

编译时：

- 当前时间不在 `PeriodicSlots` 中时，不注入策略

### 8.3 anomaly deny

表示高置信异常流量。

第一版不将其表述为“完整机器学习异常检测算法”，而是表述为“启发式威胁行为识别与临时 deny 生成机制”。

建议异常信号：

- 首次见到的组对、端口、应用
- 短时间访问多个端口
- 短时间访问多个目标
- 出现在历史上从未出现的时间槽
- 同时伴随 `VIOLATE/DENY`
- Threat/Severity 较高

建议将这些信号归一化后叠加为风险分数：

```text
S_anomaly =
    0.25 * f_novelty +
    0.20 * f_portburst +
    0.20 * f_dstburst +
    0.15 * f_time_deviation +
    0.20 * f_violation
```

推荐 promotion 条件：

- `S_anomaly >= 0.80`
- 或 `ThreatID/Severity` 已达到高危阈值
- deny 默认带 TTL，仅作临时封禁

promotion 后：

- 生成 `Action=deny`
- `Class=anomaly`
- 设置短 TTL，例如 10 分钟或 30 分钟

### 8.4 continue observing

不满足任何一类 promotion 条件时：

- 继续观察
- 不落正式规则

---

## 9. 编译与优先级设计

### 9.1 设计目标

自动生成出来的三类规则必须在现有编译链中具有可解释的顺序。

### 9.2 推荐顺序

在不改变现有 `Federal/Ground/User/Learned` 基本体系的前提下，推荐顺序为：

1. `Federal`
2. `Ground`
3. `auto anomaly deny`
4. `UserCreated`
5. `auto periodic allow`
6. `auto baseline allow`
7. `legacy learned`
8. `mixed/default`

理由：

- `Federal/Ground` 保持平台治理优先
- `anomaly deny` 需要高于自动 allow
- 周期 allow 应高于基线 allow
- 旧 legacy learned 放在自动 allow 之后，便于逐步淘汰

### 9.3 编译实现方式

这里需要特别说明：当前仓库中 `calculateIPPolicyFromCache()` 默认直接按 `adjustPolicyRuleHeads()` 遍历 `policyCache.ruleHeads`。因此如果不做额外处理，运行时顺序会直接继承存储顺序。

第一版推荐做法不是“完全依赖 rule head 插入位置”，而是在 `calculateIPPolicyFromCache()` 中采用“两步式稳定分桶编译”：

1. 第一步：遍历 `adjustPolicyRuleHeads()`，按顺序把规则稳定放入以下 bucket：
   - `federalRules`
   - `groundRules`
   - `autoAnomalyRules`
   - `userRules`
   - `autoPeriodicRules`
   - `autoBaselineRules`
   - `legacyLearnedRules`
2. 第二步：先 `append(getDefaultGroupPolicy())`
3. 按 bucket 顺序重新编译并追加到 `groupIPPolicies`
4. 每个 bucket 内保持原始相对顺序不变

注意：

- `rules[0]` 不能动
- 不允许把 auto rule 插入到 `rules[0]` 前
- 第一版可接受“运行时编译顺序”和“原始 ruleHeads 展示顺序”暂时不完全一致
- 如后续要实现 UI/REST 与运行时完全一致，可在 `applyAutoPolicyChanges()` 中增加 rule head 重排步骤，但这不是第一版必须项

---

## 10. 端口与协议处理策略

### 10.1 为什么不新增独立 IPProto 字段

当前 controller 到 agent 的语义已经大量依赖端口串表达协议，例如：

- `tcp/80`
- `udp/53`
- `8080-8090`

相关解析逻辑已存在于 `share/utils/utils.go`。

因此第一版保持：

- 协议仍编码在 `Ports` 字符串里
- 不额外引入独立规则层协议字段

### 10.2 端口范围归并

第一版必须实现端口范围归并，禁止简单超过阈值就直接变 `any`。

这里需要强调：

- 本方案第一版并不是去修改旧 `learnAppPort()` 中的 `MaxSvcPortNum = 20` 逻辑
- 而是让新自动引擎绕开旧的逐连接 learned 端口聚合路径，直接生成更精细的 `Ports` 字符串
- 因此论文表述应使用“通过新自动引擎避免了旧固定阈值退化路径”，而不是“修改了原系统的固定阈值算法”

建议策略：

1. 对同类特征收集的端口去重
2. 同协议内排序
3. 相邻或近邻端口合并成范围
4. 输出 `utils.GetPortRangeLink()` 兼容格式

示例：

- `tcp/8080,tcp/8081,tcp/8082` -> `tcp/8080-8082`
- `udp/53,udp/123` 保持分离

---

## 11. 线程、定时器与锁设计

### 11.1 锁顺序约束

当前仓库明确约束：

- `graphMutex` 内可使用 `cacheMutex`
- 反过来不允许

因此新增模块必须遵守：

1. 连接观察入口在 `graphMutex` 内只做轻量归一化与 append
2. observer 内允许复用 `node2Group()` 和 `utils.GetPortLink()`，因为其锁顺序仍是 `graphMutex -> cacheMutex`
3. observer 内不允许做 map 聚合、排序、评分、熵计算或阻塞 channel 写入
4. 窗口处理线程必须先在 `graphMutex` 保护下复制待处理事件并清空缓存，再在锁外做聚合、评分和 promotion
5. 规则写入、编译和老化尽量在定时线程中做

### 11.2 新增定时器

在 `startPolicyThread()` 中新增：

- `autoPolicyWindowTicker`
  - 默认 30 秒
  - 用于处理观察窗口

- `autoPolicyScheduleTicker`
  - 默认 1 分钟
  - 用于检查 periodic rule 当前激活集是否变化

- `autoPolicyTTLTicker`
  - 默认 5 分钟，或由 `AUTO_POLICY_TTL_CHECK_SECONDS` 控制
  - 专门用于 anomaly deny 的 TTL 清理

- `autoPolicyAgingTicker`
  - 默认 1 小时
  - 仅用于 baseline/periodic 的长期老化，不负责 anomaly deny 的 TTL 清理

### 11.3 推荐模式开关

通过环境变量控制模式：

- `AUTO_POLICY_MODE=legacy`
  - 完全走旧 learned 流程
- `AUTO_POLICY_MODE=shadow`
  - 新系统只观察，不下发
- `AUTO_POLICY_MODE=enforce`
  - 新系统正式落规则

### 11.4 规则写入锁

自动规则写入和删除必须复用：

- `CLUSLockPolicyKey`
- `cluster.Transact()`

原因：

- 保证 rule 和 rule head 更新原子化
- 避免与现有 REST 和 learned 写入冲突

---

## 12. 落地实现方案

### 12.1 Phase 0：脚手架与影子模式

目标：

- 完成数据结构、缓存、配置入口和状态接口
- 不改变现有策略行为

要做的事：

1. 在 `share/clus_apis.go` 中新增：
   - `CFGEndpointAutoPolicy`
   - `CLUSConfigAutoPolicyStore`
   - `CLUSAutoPolicyMeta`
2. 在 `controller/cache/object.go` 中增加：
   - `case share.CFGEndpointAutoPolicy`
3. 在 `controller/cache/cache.go` 中初始化：
   - `autoPolicyInit()`
4. 增加：
   - `AUTO_POLICY_MODE`
   - `AUTO_POLICY_WINDOW_SECONDS`
   - `AUTO_POLICY_SLOT_MINUTES`
   - `AUTO_POLICY_DISTINCT_DAY_DURATION`
   - `AUTO_POLICY_TTL_CHECK_SECONDS`
5. 提供只读接口：
   - `/v1/policy/auto/status`
   - `/v1/policy/auto/rule`

验收标准：

- 编译通过
- 不影响现有行为
- 能看到 shadow 状态输出

从论文组织角度，建议将工程阶段映射为四个更易讲述的模块：

- 模块 A：基础框架与观测面
  - 对应 Phase 0 + Phase 1
- 模块 B：核心学习引擎
  - 对应 Phase 2
- 模块 C：扩展分类能力
  - 对应 Phase 3 + Phase 4
- 模块 D：生命周期闭环
  - 对应 Phase 5

答辩时建议按这四部分讲，而不是逐个 Phase 念开发流水账。

### 12.2 Phase 1：连接观察面改造

目标：

- 连接进入 auto policy observer
- 旧 graph 逻辑不受影响

要做的事：

1. 在 `connect.go` 的 `UpdateConnections()` 中调用：
   - `observeAutoPolicyEvent()`
2. 在 `learn.go` 的 `addConnectToGraph()` 中引入模式判断：
   - `legacy` 下保持原行为
   - `shadow/enforce` 下关闭即时 `learnAppPort()`
3. 保留：
   - `wlGraph`
   - `polAttr`
   - 可视化逻辑

验收标准：

- graph/UI 无回归
- shadow 下不新增 learned allow 规则
- 连接特征缓存有数据

### 12.3 Phase 2：baseline allow 自动生成

目标：

- 稳定流量可自动转为正式 allow

要做的事：

1. 实现窗口聚合
2. 实现稳定性评分
3. 实现 `promoteBaselineRule()`
4. 用 `CLUSPolicyRule{CfgType: Learned, Action: allow}` 落库
5. 同时写入 metadata

验收标准：

- 稳定业务调用在几轮观察后生成 allow 规则
- `policyCache` 能正确接收这些规则
- 编译与下发正常

### 12.4 Phase 3：periodic allow 自动生成

目标：

- 定时行为可被识别为时间窗规则

要做的事：

1. 引入时间槽统计
2. 实现周期评分
3. 实现 `promotePeriodicRule()`
4. metadata 中保存 `PeriodicSlots`
5. 编译阶段仅在当前时间槽激活时注入

验收标准：

- 周期任务流量仅在对应时间窗被放行
- 非时间窗内不注入该 allow 规则

### 12.5 Phase 4：anomaly deny 自动生成

目标：

- 高置信异常流量自动转 deny

要做的事：

1. 实现启发式异常检测器
2. 评分超过阈值时 promotion deny 规则
3. deny metadata 写入 `ExpiresAt`
4. 到期自动删除

实现要求补充：

- anomaly deny 的 TTL 清理不能挂在 1 小时 aging ticker 上
- 必须使用更高频的 `autoPolicyTTLTicker` 或等价机制
- 否则 deny 规则会明显滞留，影响实验正确性和系统行为可解释性

验收标准：

- 扫描/爆发异常流量可被 deny
- TTL 到期能自动恢复

### 12.6 Phase 5：老化与回收

目标：

- 自动规则可根据真实使用情况自动回收

要做的事：

1. baseline/periodic：
   - 长期无命中则删除
2. anomaly：
   - TTL 到期删除
3. 使用现有 `MatchCntr/LastMatchAt`

验收标准：

- 自动规则总量不会单调膨胀

---

## 13. REST 与状态可观测设计

### 13.1 只读接口

建议新增：

- `GET /v1/policy/auto/status`
- `GET /v1/policy/auto/rule`
- `GET /v1/policy/auto/rule/:id`

返回内容应包括：

- 引擎模式
- 当前候选 feature 数量
- baseline/periodic/anomaly 规则数量
- 最近 promotion / delete 次数
- 每条规则的：
  - rule id
  - class
  - confidence
  - periodic slots
  - expires at
  - reason codes

### 13.2 设计原则

- 第一版只做只读
- 不提供人工编辑入口
- 所有配置通过环境变量或内部默认值控制

### 13.2.1 与现有 `/v1/policy/rule` 的关系

由于自动规则本体仍以 `CfgType = Learned` 存在于通用 policy store 中，因此它们会天然出现在现有 `/v1/policy/rule` 列表中。

第一版建议：

1. 允许 `/v1/policy/rule` 将 auto rule 作为普通 learned rule 展示
2. 但对带有 auto metadata 的规则，通用修改/删除入口应视为只读或直接拒绝修改

原因：

- 若通过通用 REST 修改 auto rule，本体与 metadata 很容易失去一致性
- 这会导致编译分类、周期激活、TTL 清理和老化逻辑全部变得不可靠

因此建议 future implementation 在以下入口增加 auto-rule guard：

- `handlerPolicyRuleAction`
- `handlerPolicyRuleConfig`
- `handlerPolicyRuleDelete`

若 `ruleID` 存在于 `autoPolicyMetaMap` 中，则返回：

- 只读
- 或 `operation not allowed`

这是第一版中非常值得做的一层保护。

### 13.3 演示与可视化建议

仅有 REST JSON 接口虽然足够开发，但对毕业答辩展示不够直观。

建议至少准备以下一种轻量可视化方式：

1. 一个简单的只读状态页
   - 展示 baseline / periodic / anomaly 规则数量
   - 展示最近一次窗口处理时间
   - 展示当前候选 feature 数量
2. 或者一个本地脚本
   - 调用 `/v1/policy/auto/status`
   - 输出图表或表格

不建议第一版大改现有前端，但建议准备“最小可演示界面”，这对论文答辩价值很高。

---

## 14. 测试与验证方案

### 14.1 单元测试

新增测试文件：

- `controller/cache/auto_policy_test.go`

测试场景：

1. baseline promotion
   - 连续稳定流量应 promotion 为 allow

2. periodic promotion
   - 跨 7 天固定时间窗流量应 promotion 为 periodic allow

3. anomaly promotion
   - 突发扫描流量应 promotion 为 deny

4. compile ordering
   - anomaly deny 必须在 baseline allow 前

5. aging
   - 长期未命中的 baseline 规则应删除
   - TTL 到期的 anomaly 规则应删除

### 14.2 集成测试

建议在 k3s / 本地测试环境执行：

1. `frontend -> backend -> redis/mysql`
   - 学成 baseline

2. `CronJob -> backup -> db`
   - 学成 periodic

3. `nmap / 多端口 burst`
   - 学成 anomaly deny

### 14.2.1 实验时间加速建议

由于 baseline 和 periodic 的判定天然依赖“跨天数”和“周期观察期”，若直接使用真实时间，实验周期会过长。

因此建议：

- 开发与实验阶段启用时间加速参数
- 例如：
  - `AUTO_POLICY_DISTINCT_DAY_DURATION=60s`
  - `AUTO_POLICY_WINDOW_SECONDS=5`
  - `AUTO_POLICY_SLOT_MINUTES=1`

这样可以在分钟级完成：

- baseline 的跨“3天”观测
- periodic 的跨“7天”观测

论文中应说明：

- 这是实验加速机制
- 仅改变统计窗口与实验时间尺度
- 不改变规则分类逻辑本身

### 14.3 论文实验分组建议

为了保证实验更公平，建议至少设置以下实验组：

- A 组：人工基准规则集（Ground Truth）
- B 组：原系统 learned 结果
- C 组：新系统 `shadow` 输出结果
- D 组：新系统 `enforce` 实际生效结果

如果时间允许，可增加：

- E 组：手工编写的 Kubernetes NetworkPolicy

实验意义：

- `A vs B/C/D`：衡量规则质量是否接近人工最优
- `B vs C/D`：衡量自动学习优化效果
- `A vs E`：说明自动化相对手工配置的价值

### 14.4 核心指标

- baseline 规则数
- periodic 规则数
- anomaly deny 规则数
- `any` 规则比例
- 策略计算耗时
- promotion 成功率
- 黑名单误报率
- 老化回收率

同时建议补充：

- Precision / Recall / F1
- 周期规则识别准确率
- deny 误报率与漏报率
- 不同评分维度的消融实验结果

### 14.5 shadow 模式验证

shadow 模式必须先做以下验证：

- 新引擎学出的规则与现有人工预期是否一致
- 周期判断是否稳定
- anomaly 误报是否可接受

通过后再切 `enforce`

---

## 15. 风险与回滚

### 15.1 风险

1. 自动 deny 误杀
2. 周期规则误判导致放行时段过宽
3. baseline 规则学得过多
4. 与 legacy learned 并存时顺序冲突
5. 观察状态未持久化，leader 切换后丢失候选特征
6. 若不做时间加速，周期实验周期过长，影响开发与验证节奏
7. 若 TTL 清理频率过低，异常拒绝规则会明显滞留

### 15.2 风险控制

1. deny 加 TTL
2. 先启用 shadow 模式
3. 周期规则要求最小观察天数
4. 编译时明确 auto rule 的顺序
5. 第一版允许候选状态丢失，但正式规则必须落盘
6. 使用实验时间加速参数缩短验证周期
7. 为 anomaly deny 单独使用高频 TTL 清理 ticker

### 15.3 回滚方案

通过环境变量回滚：

- 设置 `AUTO_POLICY_MODE=legacy`

效果：

- 停止自动观察引擎生效
- 恢复旧 learned 流程
- 自动规则不再新增

可选回滚动作：

- 清理所有带 auto metadata 的 learned 规则
- 删除 `config/auto_policy/*`

---

## 16. 里程碑

### M1：影子模式基础框架

- 完成新 endpoint、缓存、状态接口、observer
- 不改现网策略行为

### M2：baseline allow

- 稳定流量自动 allow

### M3：periodic allow

- 固定时间窗流量自动 allow

### M4：anomaly deny

- 异常流量自动 deny

### M5：老化与回收

- 自动规则生命周期闭环完成

### M6：完整实验验证

- 输出论文数据与图表

---

## 17. 推荐最终论文表述

建议将本文方案概括为：

> 面向 MicroSegX 网络策略系统，本文设计并实现了一套基于行为稳定性、时间周期性与启发式威胁行为识别的全自动网络策略生成框架。该框架在保留原有策略编译与下发链路的前提下，将网络流量自动分类为基线允许流量、周期性允许流量和异常拒绝流量，并通过规则生命周期管理机制实现了自动生成、自动激活与自动淘汰的闭环能力。

论文正文中建议统一使用以下措辞：

- `baseline allow`：自动学习得到的基线允许规则，可在说明性文字中类比“自动白名单”
- `periodic allow`：自动学习得到的时间约束允许规则
- `anomaly deny`：基于启发式威胁行为识别得到的临时拒绝规则，可在说明性文字中类比“自动黑名单”

不建议直接写：

- “本文实现了机器学习异常检测算法”
- “本文实现了增量策略计算”
- “本文修改了原系统固定阈值端口算法”

### 17.1 星号部分推荐写法

如果你的论文总述中已有如下句子：

> 本项目围绕 Kubernetes 集群场景下的安全防护需求，设计并实现了一套云主机微隔离系统。针对集群内部通信控制需求，该系统基于开源端到端容器安全平台 NeuVector 进行二次开发，在保留原有模块结构的基础上改进微隔离策略生成机制，*******。

建议星号部分写成：

> 将原有逐连接即时学习机制改造为基于滑动窗口聚合的自动策略生成引擎，通过流量稳定性评分、时间周期性分析和启发式威胁行为识别，实现了基线允许规则、时间约束允许规则和异常拒绝规则的自动分类生成，并引入规则生命周期管理机制完成策略的自动老化与淘汰。

这个版本的优点是：

- 与当前设计文档完全一致
- 术语上比较稳，不容易在答辩时被抓住“异常检测算法”“白名单系统”这些表述
- 能直接体现你在内部板块的核心工作量

### 17.2 整篇论文统一表述建议

对于整篇论文，建议使用如下统一表述：

> 本项目围绕 Kubernetes 集群场景下的安全防护需求，设计并实现了一套云主机微隔离系统。针对集群内部通信控制需求，系统基于开源端到端容器安全平台 NeuVector 进行二次开发，在保留原有模块结构的基础上改进微隔离策略生成机制，将原有逐连接即时学习机制改造为基于滑动窗口聚合的自动策略生成引擎，通过流量稳定性评分、时间周期性分析和启发式威胁行为识别，实现了基线允许规则、时间约束允许规则和异常拒绝规则的自动分类生成，并引入规则生命周期管理机制完成策略的自动老化与淘汰。对于集群外部访问控制，系统在端口扫描与识别基础上，引入零信任网络安全模型，通过开放端口治理、访问入口收敛以及身份认证和授权控制，实现集群内部服务的安全对外访问，有效减少了传统端口直接暴露带来的风险。

---

## 18. 第一版最终交付定义

第一版完成后，系统必须达到以下效果：

1. 可以在 `shadow` 模式观察并输出三类自动规则候选
2. 可以在 `enforce` 模式自动生成 baseline allow
3. 可以自动生成 periodic allow，并按时间窗激活
4. 可以自动生成 anomaly deny，并带 TTL
5. 可以自动回收长期无用规则
6. 不需要修改 agent 协议
7. 不破坏现有策略编译主链路

这即为本项目的第一阶段可交付成果。

---

## 19. 整篇论文建议章节结构

建议的章节组织如下：

1. 绪论
   - 研究背景
   - 国内外研究现状
   - 问题定义
   - 研究内容与贡献
2. 相关技术
   - Kubernetes 容器网络与微隔离
   - NeuVector 架构
   - Kubernetes Service 与暴露面治理
   - 零信任网络与 OpenZiti
3. 集群内部微隔离策略自动生成
   - 这是核心章节
   - 重点写窗口聚合、baseline、periodic、anomaly、编译优先级、生命周期
4. 集群外部暴露面治理与零信任访问控制
   - 重点写扫描、归因、治理、受控暴露与零信任接入
5. 系统实现
   - 内部模块实现
   - 外部模块实现
   - 部署与集成
6. 测试与实验
   - 内部板块对照实验
   - 外部板块功能验证
7. 总结与展望

其中建议重点篇幅分配为：

- 第 3 章内部微隔离：核心章节
- 第 4 章外部暴露治理：系统章节
- 第 6 章实验：必须和第 3 章强绑定

---

## 20. 项目执行优先级建议

如果你的目标是“既把项目做出来，又能顺利完成毕业论文”，推荐优先级如下：

1. 先完成内部板块的 `Phase 0 ~ Phase 3`
   - 也就是脚手架、observer、关闭即时学习、baseline allow 自动生成
   - 这是最核心的论文贡献来源
2. 外部板块论文正文可以并行写
   - 因为该部分更偏系统实现和工程治理，如果代码已经较成熟，可以提前整理
3. 再做 `periodic allow`
   - 这是对论文很加分的板块，因为熵公式和时间槽模型比较适合学术表达
4. `anomaly deny` 做一个基础可运行版本即可
   - 第一版重点是“可解释、可验证”，不追求复杂机器学习
5. 最后补规则老化、实验、图表和演示材料

如果时间明显不够，最小可保底范围建议是：

- 外部板块完整
- 内部板块完成 `baseline allow`
- `shadow / enforce` 模式可切换
- 至少有一组对照实验和一套可展示的状态界面或脚本

达到这个程度，论文已经具备本科毕设答辩所需的完整性。
