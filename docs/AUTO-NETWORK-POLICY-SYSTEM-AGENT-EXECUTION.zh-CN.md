# MicroSegX 全自动网络策略系统改造执行手册

## 1. 文档目的

本文档是给本地开发 agent 使用的执行手册，不讨论论文写法，专门用于指导实际落地开发。

要求：

- 按阶段实施
- 每一步都可验证
- 不跨阶段做大改
- 不擅自修改协议和主链路结构
- 任何高风险改动必须有回滚点

本手册默认目标是完成第一版可交付系统：

- 自动 baseline allow
- 自动 periodic allow
- 自动 anomaly deny
- 自动规则老化
- shadow / enforce / legacy 三模式

---

## 2. 开发总原则

### 2.1 必须遵守的约束

1. 不修改 `agent` protobuf
   - 不改 `share/controller_service.proto`
   - 不改 `share/enforcer_service.proto`
   - 不改生成的 `.pb.go`

2. 不破坏现有策略编译主链路
   - `calculateIPPolicyFromCache()` 必须继续返回 `[]CLUSGroupIPPolicy`
   - `rules[0]` 必须仍是默认地址表

3. 自动规则本体必须继续使用 `CLUSPolicyRule`
   - `CfgType = Learned`
   - `Action = allow/deny`

4. 自动规则分类信息放入 metadata，不塞进现有 rule 主结构

5. 任何规则写入必须复用：
   - `CLUSLockPolicyKey`
   - `cluster.Transact()`

6. 锁顺序不能违反现有约束
   - 允许 `graphMutex -> cacheMutex`
   - 禁止 `cacheMutex -> graphMutex`

7. 运行时编译顺序与存储顺序必须区分
   - `policyCache.ruleHeads` 是存储顺序
   - `calculateIPPolicyFromCache()` 输出的 `[]CLUSGroupIPPolicy` 才是运行时生效顺序
   - 第一版优先保证运行时顺序正确，不强制要求 rule head 展示顺序完全同步

### 2.2 决策冻结

以下决策在第一版中视为“已冻结”，后续 coding agent 不应擅自改动：

1. 自动规则本体继续使用 `CLUSPolicyRule`
   - `CfgType = Learned`
   - `Action = allow/deny`

2. 自动规则分类信息单独存 metadata
   - 不新增新的通用 `CfgType`
   - 不把分类信息塞进 `Comment`、`Ports`、`Applications`

3. 模式切换仅支持：
   - `legacy`
   - `shadow`
   - `enforce`

4. `shadow -> enforce` 第一版通过重启 controller 切换
   - 不实现运行时热切换

5. 编译顺序通过 `calculateIPPolicyFromCache()` 内的稳定分桶实现
   - 不强依赖 rule head 重排

6. anomaly deny 的 TTL 清理使用独立高频 ticker
   - 不挂在 1 小时 aging ticker 上

7. 第一版实验允许使用时间加速参数
   - 但只改变实验时间尺度，不改变判定逻辑

8. 最终小型集群验证默认单 controller 实例
   - 不实现多 controller 候选态热同步

9. 自动规则与旧 learned 内存态必须隔离
   - auto rule 可以复用 `CfgType = Learned` 存储
   - 但不能进入 `lprWrapperMap`
   - 也不能进入旧 learned 的 graph hot sync learned rule 集合

### 2.3 不允许做的事

- 不引入新的通用 `CfgType`
- 不为了省事直接修改现有 REST `/v1/policy/rule` 语义
- 不把自动规则做成一套并行的 agent 下发协议
- 不跳过 shadow 模式直接 enforce
- 不先做复杂机器学习训练流水线
- 不在 `graphMutex` 持有期间做评分、聚合、排序或阻塞 channel 写入

---

## 3. 开发模式与切换

### 3.1 模式定义

必须实现三种模式：

- `legacy`
  - 完全走旧 learned 流程

- `shadow`
  - 新自动引擎运行
  - 只观察、打分、生成候选
  - 不向 policy KV 写正式自动规则

- `enforce`
  - 新自动引擎运行
  - 正式写自动规则
  - 参与策略编译与下发

### 3.2 模式来源

建议通过环境变量读取：

- `AUTO_POLICY_MODE`
- `AUTO_POLICY_WINDOW_SECONDS`
- `AUTO_POLICY_SLOT_MINUTES`
- `AUTO_POLICY_DISTINCT_DAY_DURATION`
- `AUTO_POLICY_TTL_CHECK_SECONDS`

解析位置：

- `controller/cache/cache.go`

推荐默认值：

- 未设置时为 `legacy`

实验环境建议：

- k3s 或本地快速验证时可使用：
  - `AUTO_POLICY_WINDOW_SECONDS=5`
  - `AUTO_POLICY_SLOT_MINUTES=1`
  - `AUTO_POLICY_DISTINCT_DAY_DURATION=60s`
  - `AUTO_POLICY_TTL_CHECK_SECONDS=60`
- 最终小型 Kubernetes 集群验证时，可根据实验节奏保留或适当放宽这些参数

模式切换建议：

- `shadow -> enforce` 不建议做运行时热切换
- 第一版推荐通过修改环境变量后重启 controller 进程或重新部署 controller Pod 完成模式切换
- 这样可以避免旧 learned 路径和新自动策略写入路径短时间并存，降低 Learned ID 段竞争和状态交叠风险

---

## 4. 文件改动清单

## 4.1 新增文件

必须新增：

- `microsegx/controller/cache/auto_policy_types.go`
- `microsegx/controller/cache/auto_policy_observer.go`
- `microsegx/controller/cache/auto_policy_engine.go`
- `microsegx/controller/cache/auto_policy_periodic.go`
- `microsegx/controller/cache/auto_policy_anomaly.go`
- `microsegx/controller/cache/auto_policy_store.go`
- `microsegx/controller/cache/auto_policy_compile.go`
- `microsegx/controller/cache/auto_policy_status.go`
- `microsegx/controller/cache/auto_policy_test.go`
- `microsegx/controller/rest/auto_policy.go`

如需拆分更多文件，可额外增加，但必须保证职责清晰。

## 4.2 需要修改的已有文件

- `microsegx/share/clus_apis.go`
- `microsegx/controller/cache/object.go`
- `microsegx/controller/cache/cache.go`
- `microsegx/controller/cache/connect.go`
- `microsegx/controller/cache/learn.go`
- `microsegx/controller/cache/policy.go`
- `microsegx/controller/rest/rest.go`
- `microsegx/controller/rest/mock_test.go`

尽量不要修改其他文件。

### 4.3 建议固定的函数与全局对象命名

为减少后续 agent 在实现时的命名漂移，第一版建议尽量使用以下命名：

- 初始化与配置
  - `autoPolicyInit()`
  - `loadAutoPolicyConfig()`
- observer 与窗口处理
  - `observeAutoPolicyEvent(...)`
  - `drainObservedEvents()`
  - `processObservationWindow()`
- promotion 与写入
  - `promoteBaselineRule(...)`
  - `promotePeriodicRule(...)`
  - `promoteAnomalyRule(...)`
  - `applyAutoPolicyChanges(...)`
- 编译
  - `compileActiveAutoRules(now time.Time)`
  - `bucketAutoPolicyRules(...)`
- 清理
  - `cleanupExpiredAnomalyRules()`
  - `cleanupAutoPolicyRules()`

建议固定的全局对象或缓存命名：

- `autoPolicyMetaMap`
- `autoPolicyFeatureMap`
- `observedEvents`
- `autoPolicyConfig`

如果后续实现确需调整命名，应在提交说明中明确写出“旧名 -> 新名”的映射关系。

---

## 5. 阶段执行计划

## Phase 0：脚手架与状态面

### 目标

建立 auto policy 的基础数据结构、配置入口和只读状态接口。

### 必做任务

1. 在 `share/clus_apis.go` 中新增 endpoint 常量

必须新增：

- `CFGEndpointAutoPolicy`
- `CLUSConfigAutoPolicyStore`

命名风格必须与现有：

- `CFGEndpointCustomRule`
- `CLUSConfigCustomRuleStore`

保持一致。

2. 在 `share/clus_apis.go` 中新增结构

至少新增：

- `CLUSAutoPolicyMeta`
- `CLUSAutoPolicyEngineConfig`
- `CLUSAutoPolicyStatus`

3. 在 `controller/cache/object.go` 的 `configUpdate()` 中加分发

新增：

- `case share.CFGEndpointAutoPolicy:`
  - `autoPolicyConfigUpdate(nType, key, value)`

4. 新增缓存与初始化函数

在 `controller/cache/cache.go` 中：

- 新增 `autoPolicyInit()`
- 在 `Init()` 中调用
- 在此统一读取 auto policy 环境变量配置

重要顺序要求：

- `autoPolicyInit()` 必须在 `startPolicyThread()` 之前完成 metadata bootstrap
- 否则 `SyncLearnedPolicyFromCluster()` 无法区分 auto rule 与 legacy learned rule

5. 新增只读 REST

在 `controller/rest/auto_policy.go` 中实现：

- `handlerAutoPolicyStatus`
- `handlerAutoPolicyRuleList`
- `handlerAutoPolicyRuleShow`

在 `controller/rest/rest.go` 中注册：

- `GET /v1/policy/auto/status`
- `GET /v1/policy/auto/rule`
- `GET /v1/policy/auto/rule/:id`

### 本阶段验收

- `go test` 可通过相关包测试
- 新接口能返回空状态
- `legacy` 模式下现有策略行为不变

本阶段额外要求：

- 需要明确 `autoPolicyMetaMap` 的 bootstrap 时机
- 需要为 future implementation 预留 `isAutoPolicyRuleID(id uint32)` 或等价判断函数

### 本阶段禁止项

- 不接入真实连接观察
- 不改 `addConnectToGraph()`
- 不写任何自动规则到 policy KV

---

## Phase 1：观察面接入

### 目标

把连接事件接入 auto policy observer，但不改变当前正式策略行为。

### 必做任务

1. 在 `auto_policy_types.go` 中定义观察特征

必须包含：

- `autoFeatureKey`
- `autoFeatureState`
- `AutoPolicyClass`

2. 在 `auto_policy_observer.go` 中实现：

- `observeAutoPolicyEvent(conn, ca, sa, stip)`
- `normalizeAutoPolicyFeature(...)`

规范化规则：

- `from/to` 使用组级别，不直接用 workload id
- 组转换必须复用 `node2Group()`，不要自己写新的 group 解析器
- port 字符串必须复用 `utils.GetPortLink()`

实现约束：

- observer 只允许做轻量归一化和 `append`
- 不允许在 observer 中做 map 聚合、评分、熵计算、TTL 判断
- 优先使用预分配切片或环形缓冲区
- 不要在 observer 内做可能阻塞的 channel 发送

3. 在 `connect.go` 的 `UpdateConnections()` 中接入 observer

位置要求：

- 在 `preQualifyConnect()` 和 `postQualifyConnect()` 通过之后
- 在 `addConnectToGraph()` 之前或之后都可以
- 但必须保证 graph 行为不变

推荐顺序：

1. `calNetPolicyMet(conn)`
2. `CalculateGroupMetric(conn)`
3. `observeAutoPolicyEvent(...)`
4. `addConnectToGraph(...)`

4. 只在 `shadow/enforce` 模式下启用 observer

`legacy` 模式必须不进入新引擎。

5. 必须提供安全的 drain 方式

推荐实现：

- `observeAutoPolicyEvent()` 在 `graphMutex` 持有期间向 `observedEvents` 追加
- `drainObservedEvents()` 先在 `graphMutex` 保护下复制切片并清空
- 后续聚合、评分、promotion 在锁外完成

### 本阶段验收

- 连接观察缓存有数据
- UI 和 graph 无回归
- `legacy` 模式下和旧版本行为一致

### 本阶段禁止项

- 不关闭旧 learned 流程
- 不生成任何正式自动规则

---

## Phase 2：关闭即时 learned，改为候选观察

### 目标

让自动规则生成不再逐连接即时触发。

### 必做任务

1. 在 `learn.go` 中为 `addConnectToGraph()` 加模式判断

要求：

- `legacy` 模式：保持当前完整行为
- `shadow/enforce` 模式：
  - 保留 graph 更新
  - 禁止即时 `learnAppPort()`

2. 实现“graph 更新”和“old learn”逻辑拆分

推荐做法：

- 把当前 `addConnectToGraph()` 中：
  - graph 节点属性维护
  - policyLink / graphLink 更新
  - learned rule 触发
  分成清晰的小函数

建议最少拆成：

- `updateGraphByConnection(...)`
- `legacyLearnFromConnection(...)`

3. 确保 `shadow/enforce` 模式下：

- 不再即时增加 learned allow 规则
- graph 仍然记录连接关系

4. enforce 模式启动时增加一次 sanity check

建议检查：

- 旧 learned 路径是否已经被模式分支彻底关闭
- 是否存在待处理的 legacy learned 写入状态
- 当前 policy store 中已有 learned 规则是否需要视为 legacy learned 继续保留
- `SyncLearnedPolicyFromCluster()` 是否已经明确跳过带 auto metadata 的规则

### 本阶段验收

- `shadow/enforce` 模式下连接不会再直接学成旧 learned rule
- graph 和连接展示仍正常

### 本阶段禁止项

- 不要重写 `wlGraph`
- 不要删现有 learned 代码
- 只做条件分支切换，保留回滚能力

---

## Phase 3：baseline allow 自动生成

### 目标

实现稳定业务流量自动转 baseline allow。

### 必做任务

1. 在 `auto_policy_engine.go` 中实现窗口缓存和处理

建议接口：

- `drainObservedEvents()`
- `processObservationWindow()`
- `updateFeatureState()`

2. 观察窗口默认 30 秒

不要修改已有：

- `policyProcTimer`
- `policyCalculatingTimer`

而是在 `startPolicyThread()` 中新增：

- `autoPolicyWindowTicker`

注意：

- 窗口大小必须可通过 `AUTO_POLICY_WINDOW_SECONDS` 配置
- 不要把窗口大小硬编码在代码中，否则实验无法做时间加速

3. baseline 评分逻辑

最少需要这些维度：

- 连续窗口数
- 总窗口数
- 连接次数
- 源 workload 覆盖率
- 异常分低

推荐默认公式：

```text
f_consecutive = min(ConsecutiveWindows / 6, 1.0)
f_total       = min(TotalWindows / 12, 1.0)
f_days        = min(DistinctDays / 3, 1.0)
f_srccov      = min(SrcWorkloadSeen / max(SrcGroupSize, 1), 1.0)
f_safe        = 1 - S_anomaly

S_baseline =
    0.30 * f_consecutive +
    0.25 * f_total +
    0.20 * f_days +
    0.15 * f_srccov +
    0.10 * f_safe
```

推荐默认 promotion 条件：

- `S_baseline >= 0.75`
- `DistinctDays >= 3`
- `S_anomaly <= 0.30`

4. baseline promotion

必须实现：

- `promoteBaselineRule(feature)`

promotion 的输出：

- 正式 `CLUSPolicyRule`
- `CfgType = Learned`
- `Action = allow`
- metadata：`Class = baseline`

5. 正式写入策略 KV

必须复用：

- `CLUSLockPolicyKey`
- `cluster.Transact()`

建议参考：

- `procLearnedPolicy()`

但不能直接污染 `lprWrapperMap`

建议新建独立写入函数：

- `applyAutoPolicyChanges(...)`

写入约束：

- auto rule 本体写入 policy store 后，必须同步写入 metadata
- 若是删除 auto rule，也必须同步删除 metadata
- `applyAutoPolicyChanges(...)` 不得读写 `lprWrapperMap`

### 本阶段验收

- 稳定的业务流量在数轮窗口后能生成正式 allow 规则
- 这些规则出现在 `/v1/policy/rule`
- metadata 在 `/v1/policy/auto/rule` 中可见

### 本阶段禁止项

- 不要先实现 periodic/anomaly
- 不要在本阶段尝试重排全局 rule head

---

## Phase 4：周期规则学习

### 目标

学习固定时间窗内重复出现的正常流量。

### 必做任务

1. 在 `auto_policy_periodic.go` 中实现时间槽统计

建议：

- 30 分钟槽
- 一周 336 个槽

2. 在 `autoFeatureState` 中增加：

- `SlotCounts`
- `DistinctDays`

3. 实现周期评分函数

建议接口：

- `scorePeriodicFeature(state *autoFeatureState) (score float64, slots []uint16)`

推荐默认模型：

- 时间槽：30 分钟一槽，一周 336 槽
- 先统计每个槽的计数 `c_i`
- 再计算：

```text
p_i = c_i / Σ c_i
H = - Σ (p_i * log(p_i))
S_concentration = 1 - H / log(336)
f_days = min(DistinctDays / 7, 1.0)
f_repeat = RepeatedTopSlots / max(ActiveSlots, 1)
f_outside = 1 - OutsideSlotHitRatio

S_periodic =
    0.45 * S_concentration +
    0.25 * f_days +
    0.20 * f_repeat +
    0.10 * f_outside
```

推荐默认 promotion 条件：

- `DistinctDays >= 7`
- `S_periodic >= 0.70`

4. 周期 rule promotion

必须实现：

- `promotePeriodicRule(feature, slots)`

输出：

- 正式 `CLUSPolicyRule`
- `Action = allow`
- metadata：`Class = periodic`
- metadata：`PeriodicSlots = slots`

5. 在 `policy.go` 编译阶段接入周期规则过滤

要求：

- 当前时间不在 `PeriodicSlots`，则不注入该规则
- 注入时不能影响 `rules[0]`

建议新增：

- `compileActiveAutoRules(now time.Time)`

### 本阶段验收

- 定时任务流量在对应时间窗生成 periodic allow
- 非时间窗内不会生效

### 本阶段禁止项

- 不要上复杂 cron 表达式解析
- 第一版只做固定时间槽模型
- 不要把“跨天”逻辑写死成真实 24 小时，必须走可配置 `AUTO_POLICY_DISTINCT_DAY_DURATION`

---

## Phase 5：异常拒绝规则

### 目标

自动发现高置信异常流量，并生成短期 deny 规则。

### 必做任务

1. 在 `auto_policy_anomaly.go` 中实现启发式威胁行为识别

至少使用以下信号：

- 新颖性
- 多端口爆发
- 多目标爆发
- 时间异常
- `PolicyAction == VIOLATE/DENY`
- `ThreatID/Severity`

2. 实现 anomaly score

建议接口：

- `scoreAnomalyFeature(feature *autoFeatureState, connHints ...)`

推荐默认公式：

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
- 或高危 `ThreatID/Severity` 满足快速 deny 条件

术语要求：

- 代码注释、日志、设计说明中优先使用“启发式威胁行为识别”或 `heuristic anomaly score`
- 不要在第一版实现说明中直接写成“机器学习异常检测算法”
- 不要在实现文档中把本阶段命名成正式的“自动黑名单系统”

3. anomaly rule promotion

必须实现：

- `promoteAnomalyRule(feature)`

输出：

- 正式 `CLUSPolicyRule`
- `CfgType = Learned`
- `Action = deny`
- metadata：`Class = anomaly`
- metadata：`ExpiresAt` 非空

4. deny TTL 清理

必须在新 ticker 中实现：

- 定时扫描异常 deny metadata
- 到期删除策略规则和 metadata

实现要求：

- 不允许把 TTL 清理挂在 1 小时 aging ticker 上
- 必须使用独立 `autoPolicyTTLTicker`，或等价的高频 schedule ticker
- 推荐默认 TTL 清理频率为 1~5 分钟

### 本阶段验收

- 异常扫描流量会被自动 deny
- TTL 到期会自动删除 deny 规则

### 本阶段禁止项

- 不要直接永久 deny
- 不要第一版就引入外部 ML 依赖

---

## Phase 6：编译顺序与完整生效

### 目标

让 baseline / periodic / anomaly 与现有规则体系一起正确编译。

### 必做任务

1. 在 `policy.go` 中新增自动规则筛选逻辑

需要区分：

- 普通规则
- `CfgType=Learned` 且存在 auto metadata 的规则

2. 编译顺序必须固定

推荐顺序：

1. Federal
2. Ground
3. auto anomaly deny
4. UserCreated
5. auto periodic allow
6. auto baseline allow
7. legacy learned
8. mixed/default

实现要求：

- 不要单纯依赖写入时的 rule head 插入位置来保证运行时顺序
- 必须在 `calculateIPPolicyFromCache()` 中做稳定分桶
- 每个 bucket 内保持原始相对顺序不变
- 第一版可以接受 `/v1/policy/rule` 的展示顺序与运行时生效顺序不完全一致
- 如果后续要追求完全一致，再单独实现 `rebuildAutoRuleHeadOrder()`，不要在本阶段一开始就做

3. 周期规则编译时判断当前时间槽

4. baseline/anomaly 直接注入

5. 必须处理 generic policy REST 对 auto rule 的越权修改问题

要求：

- 带 auto metadata 的规则，在通用 `/v1/policy/rule` 修改/删除入口中应视为只读或直接拒绝
- 否则 metadata 与 rule 本体容易失去一致性

### 本阶段验收

- 编译结果顺序符合预期
- `reorgPolicyIPRulesPerNode()` 无 panic、无结构破坏
- `preparePolicySlotsCommon()` 正常工作

### 本阶段禁止项

- 不要改 `rules[0]` 的默认地址表语义
- 不要拆 slot 逻辑

---

## Phase 7：规则老化与淘汰

### 目标

让自动规则具备生命周期闭环。

### 必做任务

1. 复用现有命中统计

来自：

- `MatchCntr`
- `LastMatchAt`

2. baseline/periodic 老化条件

建议：

- 长时间无命中
- 且总命中数较低
- 才删除

3. anomaly 删除条件

- TTL 到期直接删

4. 删除时同步删除：

- `CLUSPolicyRule`
- `CLUSAutoPolicyMeta`

### 本阶段验收

- 长时间不用的自动规则会消失
- 规则总数可控

---

## 6. 具体实现要求

## 6.1 规则本体与 metadata 的关系

必须遵守：

- 自动规则本体存 `policy` store
- 自动规则 metadata 存 `auto_policy` store
- 二者通过 `RuleID` 关联

禁止：

- 在 `CLUSPolicyRule.Comment` 中塞 JSON
- 在 `Ports` 或 `Applications` 偷塞分类信息

## 6.2 Rule ID 规则

自动规则本体依然使用 `Learned` 区间 ID。

分配方式：

- 复用 `common.GetAvailablePolicyID(ids, share.Learned)`

禁止：

- 自造新的 ID 段
- 伪装成 `UserCreated/Ground/Federal`

## 6.3 Metadata 丢失时的行为

如果出现：

- `policyCache.ruleMap` 中存在规则
- 但 metadata 丢失

则应：

- 将其视为 `legacy learned`
- 不要直接删除

## 6.4 observer 特征规范化

必须复用：

- `node2Group()`
- `utils.GetPortLink()`

不要自己重新发明组名或端口编码规则。

## 6.5 周期规则编译

周期规则不需要物理创建/删除。

正确做法是：

- rule 始终存在于 policy store
- metadata 决定当前时刻是否注入编译结果

这样可以保留命中统计和规则身份稳定性。

---

## 7. 状态接口要求

### 7.1 `/v1/policy/auto/status`

最少返回：

- mode
- observed_event_count
- feature_count
- baseline_rule_count
- periodic_rule_count
- anomaly_rule_count
- pending_promotion_count
- last_window_processed_at

### 7.2 `/v1/policy/auto/rule`

最少返回：

- rule id
- class
- confidence
- from
- to
- action
- ports
- applications
- created_at
- last_observed
- expires_at
- periodic_slots
- reason_codes

---

## 8. 测试要求

## 8.1 必须新增的单元测试

至少新增以下测试：

1. `TestAutoPolicyBaselinePromotion`
2. `TestAutoPolicyPeriodicPromotion`
3. `TestAutoPolicyAnomalyPromotion`
4. `TestAutoPolicyCompileOrdering`
5. `TestAutoPolicyPeriodicActivation`
6. `TestAutoPolicyAging`
7. `TestAutoPolicyModeLegacy`
8. `TestAutoPolicyModeShadow`
9. `TestAutoPolicyModeEnforce`

## 8.2 REST 测试

必须为新接口补测试。

建议新增：

- `controller/rest/auto_policy_test.go`

或者在现有 mock test 中补路由与 handler 测试。

## 8.3 手工验证脚本建议

建议本地准备三类流量：

1. 稳定业务流量
2. 定时批处理流量
3. 扫描/突发异常流量

验证时必须先：

- `shadow`
- 再 `enforce`

## 8.4 论文实验产物要求

除通过测试外，还应为毕业论文保留以下产物：

- baseline / periodic / anomaly 数量变化曲线
- `shadow` 与 `enforce` 模式日志样本
- 周期槽分布图或热力图
- anomaly deny 触发前后的流量对比
- 与 legacy learned 的规则数量、`any` 比例、Precision/Recall/F1 对比表

如果时间允许，建议额外做一个最小可演示页面或脚本，直接读取：

- `/v1/policy/auto/status`
- `/v1/policy/auto/rule`

用于答辩演示

---

## 9. 执行顺序约束

必须按以下顺序开发：

1. 脚手架和状态接口
2. observer 接入
3. 关闭即时 learned
4. baseline promotion
5. periodic promotion
6. anomaly promotion
7. compile ordering
8. aging
9. 测试与验证

禁止跳步先写 anomaly 或 periodic 编译。

### 9.1 面向毕业论文的优先级裁剪

如果项目时间不足，必须优先保证以下顺序：

1. `Phase 0 + Phase 1`
   - 先把脚手架、状态接口、observer 跑通
2. `Phase 2 + Phase 3`
   - 这是论文核心贡献最强的一段
   - 至少要做到 baseline allow 能自动生成
3. `Phase 4`
   - periodic allow 是重要加分项，优先级高于复杂 anomaly
4. `Phase 5`
   - anomaly deny 第一版只需基础可运行、可解释即可
5. `Phase 7`
   - 老化闭环最好补上，但若时间非常紧，可以先做基础版

如果必须收缩范围，最小可交付建议是：

- `legacy / shadow / enforce` 三模式完整
- baseline allow 自动生成可运行
- 至少一个简单周期规则识别能力
- 状态接口和演示材料可用

不建议在毕业论文时间窗口内优先投入：

- 复杂机器学习训练链路
- 多 controller 候选态热同步
- 大规模性能优化
- 完整 UI 重构

补充建议：

- 最终迁移到 `1 master + 2 worker` 的小型 Kubernetes 集群时，第一版仍建议保持单 controller 实例部署
- 这样可以避免候选态热同步和多 controller 一致性问题
- 对本科毕设的验证目标而言，这个简化是合理且有依据的

---

## 10. 每阶段完成后的检查清单

### 通用检查

- `go test` 通过
- `legacy` 模式不回归
- 新代码有日志
- 新代码有单测
- 没有修改 `.pb.go`
- 没有破坏 `rules[0]`

### 阶段完成后必须记录

- 改了哪些文件
- 新增了哪些结构
- 新增了哪些定时器
- 新增了哪些接口
- 验证结果是什么
- 当前未解决风险有哪些
- 为论文保留了哪些截图、日志、表格或规则样本

---

## 11. 日志与调试要求

必须加结构化日志，至少记录：

- observer 收到的 feature key
- 窗口处理次数
- baseline / periodic / anomaly 的打分
- rule promotion / modify / delete
- 周期规则激活/失活
- deny TTL 过期删除

日志默认级别建议：

- `Debug`：细节打分
- `Info`：promotion / delete / activation

---

## 12. 出错时的处理原则

### 12.1 写 policy KV 失败

必须：

- 保留 feature state
- 记录错误
- 下轮继续重试

### 12.2 metadata 写入失败

必须：

- 不允许只写 rule 不写 metadata
- rule 与 metadata 必须在一个事务中保持一致

### 12.3 周期槽计算异常

必须：

- 回退为普通 baseline allow
- 不允许产生空的 periodic rule

### 12.4 anomaly score 不稳定

必须：

- 先保守，不升 deny
- 留在 candidate 状态继续观察

---

## 13. 回滚要求

任何时候都必须能通过：

- `AUTO_POLICY_MODE=legacy`

恢复到旧行为。

如需回滚已生成的自动规则，必须提供内部清理函数：

- `cleanupAutoPolicyRules()`

行为：

- 删除所有带 metadata 的自动规则
- 清空 `config/auto_policy/*`

但不能删除普通 legacy learned 规则。

---

## 14. 最终完成定义

项目完成时，必须满足：

1. `legacy/shadow/enforce` 三模式完整
2. baseline allow 可自动生成
3. periodic allow 可自动生成并按时间窗生效
4. anomaly deny 可自动生成并带 TTL
5. 自动规则可老化
6. 只读状态接口可用
7. 单元测试和集成验证完成
8. 不修改 agent 协议
9. 不破坏现有编译和下发链路

以上全部满足，才算本项目第一版完成。
