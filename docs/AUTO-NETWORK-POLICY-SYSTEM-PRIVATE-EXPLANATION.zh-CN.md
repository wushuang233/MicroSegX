# MicroSegX 自动策略与零信任功能个人理解说明

> 本文档只用于你自己理解当前系统，不建议直接原样放进论文。论文里应使用更正式、更克制的表达。

## 1. 现在整个功能算写完了吗

从“第一版工程交付”的角度看，核心功能已经写完并部署过。

已经完成的部分包括：

- 自动网络策略后端框架
  - 已经接入连接事件观察。
  - 已经关闭 `shadow / enforce` 模式下的旧式逐连接即时学习。
  - 已经实现窗口聚合、候选特征、三类评分、规则生成、metadata、生命周期清理。
  - 已经复用原来的策略编译与下发主链路。

- 三类自动策略
  - `baseline allow`：稳定业务流量的基线允许规则。
  - `periodic allow`：只在固定时间槽出现的时间约束允许规则。
  - `anomaly deny`：高风险异常流量的临时拒绝规则。

- 前端可视化
  - 自动策略工作台已经有状态总览、规则视图、观察视图、事件流、详情抽屉。
  - 网络规则页可以展示自动规则来源和分类。
  - 网络活动页可以联动自动策略观察信息。
  - 端口暴露页已经嵌入零信任工作区。
  - OpenZiti 零信任页面已经可以管理 router、service、identity、config、policy。

- 端口暴露与零信任接入
  - port-audit 后端已经接入 manager 页面。
  - OpenZiti controller/router/host identity/terminator 当前已经跑通。
  - 服务挂到 router 时会自动补齐 Dial、Bind、edge-router-policy、service-edge-router-policy 等必要策略。

- 打包与部署
  - manager 前端已经重新构建并打进 manager 镜像。
  - port-audit/OpenZiti 后端修复已经固化到 stack 镜像。
  - 当前集群里 `microsegx`、`openziti`、`port-audit` 主要 Pod 均为 Running。

但要注意：当前集群实际启用的是 `AUTO_POLICY_MODE=shadow`。

这意味着：

- 系统会观察流量、计算候选、展示分数。
- 系统不会真正自动写入 allow/deny 策略。
- 如果要验证真实自动落规则，需要切换到 `AUTO_POLICY_MODE=enforce` 并重启或重新部署 controller。

所以更准确的说法是：

> 第一版功能链路已经实现完成；当前部署为了安全演示和避免误封禁，运行在 shadow 模式，只观察不强制生成策略。

## 2. 还有哪些不是第一版目标

这些不算没做完，而是第一版明确不做或只做基础版：

- 不是完整机器学习异常检测系统。
  - 当前 anomaly 是启发式评分，不是训练模型。

- 不是多 controller 候选状态热同步系统。
  - 候选特征保存在 controller 内存里。
  - 正式自动规则和 metadata 会落 KV。

- 零信任接入不等于自动关闭所有公网入口。
  - OpenZiti 通了以后，只代表“可以通过身份和服务策略安全访问”。
  - NodePort、LoadBalancer、Ingress、主机监听如果还开着，直接暴露面仍然存在。
  - 所以端口暴露页仍需要继续治理开放端口。

- 前端目前是工程演示型工作台，不是最终商业级运维界面。
  - 主要目标是把规则生成过程、状态和实验指标讲清楚。

## 3. 自动策略总体流程

现在的自动策略流程可以理解成：

```text
连接事件
  -> 规范化为组级别通信特征
  -> 放入短时间观察窗口
  -> 周期性汇总窗口
  -> 更新候选特征状态
  -> 计算 baseline / periodic / anomaly 三个分数
  -> 判断是否只是继续观察，还是生成自动规则
  -> enforce 模式下写入规则和 metadata
  -> 策略编译时按自动规则类别重新排序
  -> 下发给 agent 和数据面执行
```

这个系统的核心不是“看到一条连接就写一条规则”，而是“先观察一段时间，再判断这是不是稳定、周期或异常行为”。

## 4. 什么是一个候选特征

系统不会直接把每个连接都当成一条规则，而是先把连接归并成“候选特征”。

一个候选特征大致由这些信息组成：

- 源组：例如 `frontend`。
- 目标组：例如 `backend`。
- 协议：例如 TCP 或 UDP。
- 端口集合：例如 `tcp/80`、`tcp/8080-8082`。
- 应用识别：如果系统识别到了应用，则按应用维度记录。
- 源工作负载集合：哪些具体 workload 发起过这类通信。
- 出现过的时间窗口和时间槽。
- 是否出现过违反、威胁、严重等级等安全信号。

第一版的端口型特征是：

> 源组 + 目标组 + 协议，再收集这个组对下出现过的端口集合。

这样做比旧的逐连接 learned 更稳，也能避免端口数量一多就直接退化成 `any`。

## 5. 三类自动策略是什么意思

### baseline allow

`baseline allow` 表示稳定业务基线流量。

直观理解：

> 这类流量持续出现、跨多个观察周期出现、来自源组内较多 workload，并且没有明显异常信号，所以可以认为是正常业务通信。

它生成的是允许规则。

当前 promotion 条件大致是：

- baseline 分数大于等于 `0.75`
- 观察周期数大于等于 `3`
- anomaly 分数小于等于 `0.30`

### periodic allow

`periodic allow` 表示周期性业务流量。

直观理解：

> 这类流量不是一直出现，而是集中在某些固定时间槽出现，例如定时任务、备份任务、CronJob。

它生成的是允许规则，但不是一直注入策略。

编译时会判断：

- 当前时间槽在规则 metadata 的周期槽里：规则生效。
- 当前时间槽不在周期槽里：规则不注入到运行时策略。

当前 promotion 条件大致是：

- 观察周期数大于等于 `7`
- periodic 分数大于等于 `0.70`
- 有明确的周期槽
- 且它不像普通 baseline 那样“全天候稳定”

### anomaly deny

`anomaly deny` 表示高风险异常流量。

直观理解：

> 这类流量可能是新出现的、短时间多端口、多目标、出现在异常时间，或者伴随违反、威胁 ID、较高严重等级。

它生成的是拒绝规则，并且带 TTL。

当前 promotion 条件大致是：

- anomaly 分数大于等于 `0.80`
- 或者出现高置信威胁信号，例如 ThreatID 存在且 Severity 较高

anomaly deny 默认是临时规则，不是永久封禁。

## 6. 三个分数怎么算

### baseline 分数

baseline 分数表示“像不像稳定业务基线”。

公式是：

```text
S_baseline =
  0.30 * f_consecutive +
  0.25 * f_total +
  0.20 * f_days +
  0.15 * f_srccov +
  0.10 * f_safe
```

各项含义：

- `f_consecutive`
  - 连续观察窗口数。
  - 当前实现里满分参考值是 `6` 个连续窗口。

- `f_total`
  - 保留期内命中过的窗口总数。
  - 当前实现里满分参考值是 `12` 个窗口。

- `f_days`
  - 观察周期数。
  - 当前实现里 baseline 满分参考值是 `3` 个观察周期。

- `f_srccov`
  - 源工作负载覆盖率。
  - 例如源组里有 2 个 workload，其中 1 个发起过该通信，则为 `1/2 = 50%`。

- `f_safe`
  - 安全性。
  - 计算方式是 `1 - anomaly 分数`。
  - anomaly 越低，safe 越高。

### periodic 分数

periodic 分数表示“像不像固定时间出现的周期流量”。

核心思想是看流量是否集中在少数时间槽。

先计算时间槽分布熵：

```text
p_i = 第 i 个时间槽命中次数 / 总命中次数
H = -Σ(p_i * log(p_i))
S_concentration = 1 - H / log(总槽数)
```

如果流量分散在很多槽，熵高，周期性弱。

如果流量集中在少数槽，熵低，周期性强。

最终 periodic 分数是：

```text
S_periodic =
  0.45 * S_concentration +
  0.25 * f_days +
  0.20 * f_repeat +
  0.10 * f_outside
```

各项含义：

- `S_concentration`
  - 时间槽集中程度。

- `f_days`
  - 观察周期数。
  - periodic 满分参考值是 `7` 个观察周期。

- `f_repeat`
  - 高命中槽占活跃槽的比例。

- `f_outside`
  - 非主要周期槽之外的命中越少，这项越高。

### anomaly 分数

anomaly 分数表示“像不像异常或攻击行为”。

公式是：

```text
S_anomaly =
  0.25 * f_novelty +
  0.20 * f_portburst +
  0.20 * f_dstburst +
  0.15 * f_time_deviation +
  0.20 * f_violation
```

各项含义：

- `f_novelty`
  - 新颖性。
  - 首次出现或刚出现不久的流量更可疑。

- `f_portburst`
  - 多端口爆发。
  - 同一源组短时间访问多个端口会升高。

- `f_dstburst`
  - 多目标爆发。
  - 同一源组短时间访问多个目标组会升高。

- `f_time_deviation`
  - 时间偏移。
  - 如果历史上没在当前时间槽出现过，现在突然出现，会升高。

- `f_violation`
  - 安全信号。
  - 包括违反、deny、ThreatID、Severity。

## 7. 当前页面上的指标是什么意思

你给出的例子是：

```text
连续观察窗口
1
每个窗口 5 秒

保留期内命中窗口
2
候选特征保留 14 分钟

观察周期数
2
实验时间口径：1 个观察周期 = 1 分钟

源工作负载覆盖率
50% (1/2)

基线
0.38
周期
0.36
异常
0.23

活跃槽
2, 3
```

下面逐项解释。

### 连续观察窗口 = 1

意思是：

> 这个候选特征最近只在 1 个连续窗口中出现。

当前环境中每个窗口是 `5 秒`。

如果某个流量在第 1 个窗口出现，第 2 个窗口没出现，第 3 个窗口又出现，那么连续窗口会重新从 1 开始。

它不是历史总数，而是最近连续程度。

### 每个窗口 5 秒

这是当前实验环境的窗口长度。

当前 controller 环境变量是：

```text
AUTO_POLICY_WINDOW_SECONDS=5
```

意思是：

> 系统每隔 5 秒把这段时间内收到的连接事件汇总一次。

窗口越短，实验反馈越快；窗口越长，生产环境里更稳。

### 保留期内命中窗口 = 2

意思是：

> 在当前候选特征保留期内，这个特征一共出现在 2 个不同观察窗口里。

它不是事件条数。

例如某 5 秒窗口里出现了 20 条同类连接，也只会让“命中窗口”增加 1。

这个指标用于说明“这个行为是不是反复出现”。

### 候选特征保留 14 分钟

候选特征不是永久保留。

当前环境是实验加速模式：

```text
AUTO_POLICY_DISTINCT_DAY_DURATION=60s
```

候选特征默认保留：

```text
14 * 观察周期
```

所以当前就是：

```text
14 * 60 秒 = 14 分钟
```

如果 14 分钟内这个特征没有再出现，它会从候选状态中清理掉。

这项修复是为了避免之前出现“历史窗口数几千、观察天数几百”这种不可信的累计数字。

### 观察周期数 = 2

这个名字在当前实验环境里不要理解成真实自然日。

当前配置是：

```text
1 个观察周期 = 60 秒
```

所以“观察周期数 2”表示：

> 这个候选特征跨过了 2 个逻辑观察周期。

在生产默认配置里，观察周期可以是 24 小时，这时它才更接近“观察天数”。

当前为了实验演示，把 24 小时压缩成 1 分钟。

### 源工作负载覆盖率 = 50% (1/2)

意思是：

> 源组里目前识别到 2 个 workload，其中 1 个 workload 产生过这个候选特征。

所以：

```text
覆盖率 = 1 / 2 = 50%
```

这个指标的意义是：

- 如果源组里多数 workload 都有这个通信，更像稳定业务行为。
- 如果只有单个 workload 偶然出现，更可能只是个体行为、测试流量或异常流量。

如果后端暂时拿不到源组规模，会按 1 兜底估算，前端会提示“组规模暂按 1 估算”。

### 基线 = 0.38

这是 baseline 分数。

用你给出的数字可以大致还原：

```text
f_consecutive = 1 / 6 = 0.17
f_total       = 2 / 12 = 0.17
f_days        = 2 / 3 = 0.67
f_srccov      = 1 / 2 = 0.50
f_safe        = 1 - 0.23 = 0.77
```

代入 baseline 公式：

```text
S_baseline =
  0.30 * 0.17 +
  0.25 * 0.17 +
  0.20 * 0.67 +
  0.15 * 0.50 +
  0.10 * 0.77
≈ 0.38
```

所以这个数是合理的。

它还没有达到 baseline promotion 阈值 `0.75`，所以不会被提升为正式 baseline allow。

### 周期 = 0.36

这是 periodic 分数。

当前环境里：

- 1 个观察周期 = 1 分钟。
- 1 个周期时间槽 = 1 分钟。
- 1 个逻辑周期里只有 1 个槽。
- 一周模型共有 7 个槽。

活跃槽是 `2, 3`，说明它分布在两个槽里。

如果两个槽命中比较均匀，说明它不是特别集中在单一固定时间槽，所以周期性不会很高。

因此 `0.36` 属于“有一点时间集中迹象，但远远不够 promotion”的状态。

periodic promotion 阈值是 `0.70`，而且至少需要 `7` 个观察周期。

### 异常 = 0.23

这是 anomaly 分数。

这个数不高。

它通常来自这些信号的叠加：

- 流量比较新。
- 可能有轻微安全信号。
- 或者短时间内出现了一点端口/目标变化。

如果只是新流量，分数一般不会直接很高。

只有出现多端口爆发、多目标爆发、严重威胁信号或高 Severity 时，才会快速接近 anomaly deny 阈值。

anomaly promotion 阈值是 `0.80`。

所以 `0.23` 表示：

> 当前不认为它是高置信异常，只是在观察阶段保留一定风险分。

### 活跃槽 = 2, 3

活跃槽表示：

> 这个候选特征在哪些周期时间槽里出现过。

当前实验配置下：

```text
1 个逻辑观察周期 = 1 分钟
1 个 slot = 1 分钟
7 个逻辑观察周期组成一组周期模型
```

所以槽 `2, 3` 可以理解为：

> 它在第 2 和第 3 个逻辑周期槽中出现过。

生产配置中更直观：

```text
1 个自然日 = 24 小时
1 个 slot = 30 分钟
一周 = 7 * 48 = 336 个 slot
```

那时活跃槽就可以理解成“每周哪些半小时段出现过”。

## 8. 为什么现在这些数字看起来小

这些数字小是正常的，因为当前例子还处于早期观察阶段。

它只有：

- 连续窗口 `1`
- 命中窗口 `2`
- 观察周期 `2`
- 覆盖率 `50%`

这说明：

> 它出现过，但还不够稳定，也不够周期，异常风险也不高。

系统此时最合理的决策就是：

> 继续观察，不生成正式规则。

这正是新系统和旧系统的区别。

旧系统可能看到几条连接就立刻写 learned rule。

新系统会等它足够稳定、足够周期或足够异常，再做 promotion。

## 9. 自动规则写入和编译是怎么做的

自动规则本体仍然复用原来的策略规则。

也就是说：

- allow/deny 动作仍走原来的策略规则结构。
- rule ID 仍使用 learned rule 段。
- agent 和数据面协议没有改。
- 现有策略下发链路没有被推翻。

新增的是一层 metadata。

metadata 记录：

- 这个规则是 baseline、periodic 还是 anomaly。
- 置信度是多少。
- 观察时间是什么。
- periodic 的生效槽是什么。
- anomaly 的过期时间是什么。
- promotion 原因是什么。

编译时不再简单按原 rule head 顺序直接遍历，而是做稳定分桶：

```text
Federal
Ground
auto anomaly deny
UserCreated
auto periodic allow
auto baseline allow
legacy learned
```

这样做的原因是：

- 平台治理规则优先。
- anomaly deny 要高于自动 allow。
- periodic allow 比 baseline allow 更精确。
- legacy learned 放在自动 allow 后面，便于逐步替换旧学习逻辑。

## 10. shadow 模式和 enforce 模式的区别

当前部署是 shadow 模式。

shadow 模式下：

- 会观察。
- 会聚合。
- 会算分。
- 会展示候选。
- 不会写正式规则。
- 不会真的下发自动 allow/deny。

enforce 模式下：

- 满足 promotion 条件后会写入正式策略规则。
- 同时写入 auto metadata。
- 策略编译会把这些规则注入到运行时策略。
- anomaly deny 到期会自动删除。
- baseline/periodic 长期无命中会自动老化删除。

legacy 模式下：

- 自动策略引擎关闭。
- 走旧 learned 逻辑。

## 11. 前端自动策略页面各部分是什么

### 顶部状态卡

用于回答：

> 自动策略系统现在有没有在工作？

它展示：

- 当前模式：legacy / shadow / enforce。
- 当前候选特征数量。
- 自动 baseline / periodic / anomaly 规则数量。
- 最近窗口处理时间。
- 最近 promotion / delete 时间。

### 规则视图

用于回答：

> 哪些自动规则已经生成了？

它展示：

- 规则 ID。
- 类型：baseline / periodic / anomaly。
- 当前是否 active。
- 编译状态。
- 置信度。
- TTL 或周期槽。
- 对应原始策略规则。

在 shadow 模式下，这里可能没有规则，因为 shadow 不落规则。

### 观察视图

用于回答：

> 系统当前观察到了哪些候选通信行为？

它展示：

- from / to。
- 端口或应用。
- 三个分数。
- 连续窗口、命中窗口、观察周期。
- 源工作负载覆盖率。
- 活跃槽。
- 当前阶段：observing / candidate / promoted。

你现在看到的那些数字主要都来自这里。

### 事件流

用于回答：

> 自动策略引擎最近做过什么动作？

例如：

- 处理了一个窗口。
- 清理了过期候选特征。
- promotion 了 baseline。
- promotion 了 anomaly。
- 删除了过期规则。

### 详情抽屉

用于解释某一条规则或某一个候选特征。

主要用于答辩和调试：

- 为什么它被判为 baseline？
- 为什么它还没 promotion？
- 它的周期槽是什么？
- 它的分数来源是什么？

## 12. 网络规则页里的自动规则是什么意思

自动规则本体仍然是普通策略规则，所以它会出现在网络规则页。

区别是：

- 普通 learned rule 没有 auto metadata。
- 自动规则有 auto metadata。

前端会根据 metadata 识别：

- baseline allow
- periodic allow
- anomaly deny

这类规则不应该被普通编辑入口随便修改。

原因是：

> 如果只改规则本体，不同步改 metadata，编译顺序、周期激活、TTL 和老化都会出问题。

所以现在页面上对自动规则做了只读保护。

## 13. 端口暴露页和零信任页是什么关系

端口暴露页解决的是：

> 当前 Kubernetes 集群有哪些端口直接暴露在外面？

它关注：

- NodePort。
- LoadBalancer。
- Ingress。
- 主机监听。
- 哪些端口是业务暴露。
- 哪些端口是平台组件暴露。
- 哪些服务可以治理。

零信任页解决的是：

> 能不能把服务访问收敛到 OpenZiti 的身份认证和授权通道里？

它关注：

- OpenZiti controller。
- edge router。
- identity。
- service。
- hosting config。
- Dial / Bind policy。
- terminator。

两者关系是：

> 先用端口暴露页发现和治理直接暴露面，再用零信任页为需要访问的服务建立受控访问入口。

零信任通了以后，不代表端口自动关了。

你还需要回到端口暴露治理里关闭对应直接暴露入口，才能完成“最小暴露”。

## 14. 零信任页面按钮现在的逻辑

### 部署 Router

这个按钮用于：

> 把 OpenZiti edge router 部署成 Kubernetes 工作负载。

只有 router 工作负载存在并在线，service 才能稳定挂到它上面。

### 挂到 Router

这个按钮用于：

> 让某个 OpenZiti service 由某个 router 承载。

它会补齐：

- router tunnel 托管能力。
- router host identity 的 Bind 权限。
- dial identity 到 router 的 edge-router-policy。
- service 到 router 的 service-edge-router-policy。
- 必要时触发 router 重启，让 terminator 建立。

现在前端只允许选择已经部署到 Kubernetes 的 router。

这样可以避免用户选择一个逻辑上存在、但没有实际 workload 的 router，导致 `NO_EDGE_ROUTERS_AVAILABLE`。

### 编辑 / 删除 policy

普通用户创建的 policy 可以编辑或删除。

MicroSegX 自动维护的系统 policy 不允许手动编辑或删除。

原因是：

> 这些 policy 是服务挂载闭环的一部分，手动改掉可能让 service 看起来存在，但实际没有可用 edge router。

## 15. 当前 `mc-service` 零信任为什么已经通了

之前失败信息是：

```text
NO_EDGE_ROUTERS_AVAILABLE
```

这个错误的含义不是 router Pod 一定没跑，而是：

> 对这个 service 来说，当前 dial identity 和 service 没有共同可用的在线 edge router。

修复后现在有：

- router 在线。
- service-edge-router-policy 允许 service 使用该 router。
- edge-router-policy 允许 dial identity 使用该 router。
- Bind policy 允许 router host identity 承载 service。
- terminator 已经建立。

所以 `mc-client -> mc-service` 现在通过 policy-advisor 检查。

## 16. 当前系统在论文里应该怎么讲

不要讲成：

> 我做了机器学习异常检测。

更稳的讲法是：

> 我将原有逐连接即时学习机制改造为基于滑动窗口聚合的自动策略生成引擎，通过稳定性评分、时间周期性分析和启发式威胁行为识别，实现了 baseline allow、periodic allow、anomaly deny 三类策略候选与自动规则生成，并通过 metadata、编译分桶和生命周期管理形成闭环。

对于零信任和端口暴露部分，可以讲成：

> 系统通过端口扫描和 Kubernetes Service 归因识别直接暴露面，并结合 OpenZiti 构建身份驱动的受控访问入口。端口暴露治理负责发现和收敛直接暴露，零信任访问负责提供认证授权后的替代访问路径。

## 17. 你看到分数时应该怎么判断

可以按这个思路看：

- baseline 高、anomaly 低
  - 稳定业务流量。
  - enforce 下可能生成 baseline allow。

- periodic 高、活跃槽少、跨 7 个观察周期
  - 定时任务流量。
  - enforce 下可能生成 periodic allow。

- anomaly 高
  - 高风险行为。
  - enforce 下可能生成临时 anomaly deny。

- 三个分数都不高
  - 继续观察。
  - 这是正常状态，不是系统没工作。

你给出的例子属于：

> 出现次数少、跨 2 个实验观察周期、覆盖率 50%、风险不高，因此继续观察。

这正好体现了新系统相对旧 learned 的改进：

> 不再因为几条偶发连接就立刻写正式策略。

## 18. 现在规则列表为什么多了治理能力

你现在看到的自动策略规则，大致分成两类：

1. 真实自动规则
   - `baseline`
   - `periodic`
   - `anomaly`

2. 系统默认保护规则
   - `system_guard`

真实自动规则是系统从流量里学习出来并落到策略存储里的规则。

系统默认保护规则不是业务学习结果，而是为了保护 MicroSegX、OpenZiti、port-audit 这些平台自身组件，避免进入 `Protect` 后把控制台、controller、scanner、ziti controller/router 等基础链路误拦掉。

所以：

- 删除 `baseline / periodic / anomaly`
  - 含义是删除真实自动规则。
  - 系统会移除规则本体和对应 metadata。

- 删除 `system_guard`
  - 含义是抑制这条默认保护规则。
  - 因为它本来就是编译阶段虚拟生成的规则，不存在普通 policy rule 本体。
  - 系统会记录一条 suppression metadata，之后不再注入这条默认保护规则。

这就是为什么现在自动策略页需要分页、搜索、业务筛选、多选删除：

> 自动化系统不能只会生成规则，也必须让人能看懂、筛选、纠偏和回收规则。

当前页面里的筛选建议：

- 想看业务学习结果：
  - 过滤 `baseline / periodic / anomaly`。

- 想看系统默认保护：
  - 过滤 `system_guard`。

- 想清理某个命名空间或业务：
  - 使用业务/命名空间筛选。

- 想清理容器已经不存在的历史规则：
  - 使用“运行状态”筛选里的“疑似失效”。
  - 这个标记来自 controller 当前组缓存：如果规则的来源组或目标组已经没有 live endpoint，也没有 service address，页面就会标成“疑似失效”。
  - 对 `Workload:<...>` 形式的规则，系统会额外检查当前 workload 缓存和 IP 到 workload 的映射；如果对应 Pod/工作负载已经不存在，也会标成“疑似失效”。
  - `Workload:ingress` 是入口虚拟节点，不代表某个具体 Pod，因此不会因为没有 Pod 对象而被判定为失效。
  - 它不是直接删除判断，而是给人工治理提供提示。

- 想找某个服务：
  - 用搜索框输入 workload、service、namespace 或端口关键词。

## 19. 为什么 system_guard 现在被收窄

早期的 `system_guard` 偏保守，会把 MicroSegX、OpenZiti、port-audit 相关平台组之间生成较多保护规则。

这样做的好处是系统不容易把自己拦死。

缺点也明显：

> 规则太多，用户看不懂，而且有些安装器、调试容器、历史容器已经不应该继续出现在默认保护里。

现在的处理方式是：

- 只保护当前仍有 live member 或 service address 的平台组。
- 排除调试、安装器、注册、升级、临时用户测试等组。
- 不再生成跨 ServiceIP 的默认全互联。
- 保留 MicroSegX/OpenZiti/port-audit 核心组件之间的基础保护。

因此当前 `system_guard` 的定位是：

> 保护平台自身稳定运行的最小默认安全垫，而不是业务访问的长期白名单。

业务系统之间的访问，仍然应该由：

- 用户手动规则；
- 自动学习出的 `baseline`；
- 自动学习出的 `periodic`；
- 异常时的 `anomaly deny`

共同决定。

## 20. 零信任链路和普通链路现在怎么区分

这里要避免一个误解：

> 零信任链路存在，不等于系统自动关闭普通直连链路。

现在系统采用的是“分路径学习”：

- `ziti-router -> 业务服务`
  - 归类为零信任链路。
  - 前端显示为“零信任流量”。
  - 它有自己的连续窗口、观察周期、baseline/periodic/anomaly 分数。

- `Workload:ingress -> 业务服务`
  - 归类为入口链路。
  - 前端显示为“入口流量”。
  - 它独立评分、独立生成规则。

- `业务 Pod A -> 业务 Pod B`
  - 归类为普通业务链路。
  - 前端显示为“普通业务流量”。
  - 它也独立评分、独立生成规则。

也就是说，同一个目标服务可能同时出现几条链路：

```text
ziti-router.openziti -> nginx.web        零信任链路
Workload:ingress -> nginx.web            入口链路
frontend.web -> nginx.web                普通业务链路
```

这三条不会被合并成一条，也不会互相覆盖。

如果你希望“只有零信任能访问，直连不能访问”，更合理的做法不是让零信任学习结果自动生成直连 deny，而是：

- 先让零信任链路真实跑通并被学习成 allow。
- 再通过端口暴露治理关闭 NodePort、Ingress、LoadBalancer 或宿主机监听。
- 或者人工添加一条明确的 deny 规则限制直连入口。

这样论文表述会更稳：

> 系统能够区分零信任访问路径与普通网络访问路径，并分别进行观察、评分和策略生成；外部直连暴露面的收敛由端口暴露治理模块完成。

## 21. 为什么以前会看到 `Workload:<IP>` 或 `Workload:ingress`

NeuVector/MicroSegX 的连接上报有时会先把端点识别成虚拟端点，例如：

- `Workload:ingress`
- `Workload:10.42.x.x`
- `nv.ip.<service-ip>`

这不一定代表真实 Pod 名称丢了，而是连接预处理阶段还没把 IP 还原成工作负载。

现在做了一个归因修正：

> 如果连接端点是 `Workload:<IP>`，并且 controller 当前能从 Pod IP 映射表里找到真实 workload，就把它恢复成真实 workload，再进入网络活动图和自动策略观察面。

因此零信任实际打到业务服务时，理论上应能显示为：

```text
nv.ziti-router.openziti -> nv.nginx.web
```

而不是：

```text
Workload:<IP> -> nv.nginx.web
```

但还有一个前提：

> OpenZiti 的实际请求必须真的从 ziti-router Pod 发起并成功连到目标服务。

如果零信任请求本身没有打到 nginx，那么自动策略页不会凭配置伪造这条学习结果。

## 22. 当前零信任验证状态

目前已经确认：

- `ziti-router -> MicroSegX WebUI` 是可达的。
- `microsegx-manager -> nginx` 是可达的。
- `microsegx-enforcer -> nginx Pod IP` 是可达的。
- OpenZiti 控制面里存在 `nginx-service`。
- `nginx-service` 的 host 配置指向 `nginx.web.svc.cluster.local:80`。
- `nginx-service` 的 terminator 在 `ziti-router` 上。
- policy-advisor 显示 `mc-client` 可以 Dial，`ziti-router` 可以 Bind。

但当前还观察到：

- 在 `ziti-router` 容器内直接 curl `nginx.web.svc.cluster.local:80` 会超时。
- 这说明 nginx 服务本身没坏，但 ziti-router 到 nginx 这条实际路径还需要继续排查。

所以现在最准确的状态是：

> 自动策略已经具备分开学习零信任/入口/普通链路的能力；但 nginx 的零信任业务访问还需要先跑通，页面上才会出现真实的 `ziti-router -> nginx` 学习链路。

## 23. 最新校正：零信任不负责自动关闭直连

你刚刚澄清的点非常重要：

> 零信任链路不应该自动影响或关闭非零信任链路。

所以当前实现不会做这件事：

```text
看到 ziti-router -> nginx
  -> 自动生成 direct/ingress deny
```

现在做的是“分路径学习”：

```text
nv.ziti-router.openziti -> nv.nginx.web     traffic_source = zero_trust
nv.direct-curl.web -> nv.nginx.web          traffic_source = direct
Workload:ingress -> nv.nginx.web            traffic_source = ingress
```

三条链路可以指向同一个目标，但它们是三条不同候选特征：

- 分别累计连续窗口。
- 分别累计观察周期。
- 分别计算 baseline / periodic / anomaly 分数。
- 分别 promotion 成规则。
- 前端分别按“零信任链路、入口链路、普通链路”展示。

这意味着：

- 如果直连链路稳定，它可以生成自己的 baseline allow。
- 如果零信任链路稳定，它也可以生成自己的 baseline allow。
- 如果其中某条链路出现异常，只影响那条链路的异常评分，不会自动污染另一条链路。

如果后续想实现“只允许零信任访问，不允许普通直连”，应该由两个明确动作完成：

- 端口暴露治理：关闭 NodePort、Ingress、LoadBalancer、宿主机监听等直连入口。
- 人工策略或明确的 deny 配置：由用户确认后对直连路径加拒绝规则。

不建议让自动学习系统因为观察到零信任链路，就自动封掉直连链路。这样误杀风险太高，论文里也不好解释。

## 24. 最新真实验证结果

这次已经验证到同一个 nginx 目标下存在两条分开的候选链路。

普通直连验证：

```text
nv.direct-curl.web -> nv.nginx.web
traffic_source = direct
stage = observing
```

零信任代理侧验证：

```text
nv.ziti-router.openziti -> nv.nginx.web
traffic_source = zero_trust
stage = observing
```

入口访问 OpenZiti 控制面也已修正：

```text
Workload:ingress -> nv.ziti-controller.openziti
traffic_source = ingress
```

这说明现在的分类逻辑已经不是简单“只要出现 ziti 就算零信任”，而是更接近真实语义：

- ziti-router 作为源端访问业务服务，才是零信任数据面链路。
- ingress 访问 ziti-controller，是入口/控制面访问，不是零信任业务链路。

仍然要注意：

- `ziti-router` 容器里直接访问 `nginx.web.svc.cluster.local:80` 当前仍然超时。
- 但是连接尝试已经能被 MicroSegX 学成 `ziti-router -> nginx` 候选链路。
- 所以下一步如果要演示“零信任完整访问闭环”，重点不是自动策略算法，而是继续把 OpenZiti 客户端/隧道拨号路径跑通。
