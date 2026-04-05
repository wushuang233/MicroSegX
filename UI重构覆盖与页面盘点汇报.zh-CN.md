# UI重构覆盖与页面盘点汇报

## 1. 本轮结论

这轮不是只做“换蓝色”，而是已经开始把整体信息架构从旧版 NeuVector 风格里拉开。

本轮重点完成了 4 件事：

1. 把 `Workloads / Containers` 页面从旧式“上下分栏表格 + 详情”改成了新的“概览卡片 + 焦点卡片 + 左右工作台”结构。
2. 把容器详情页里旧式绿色圆形图标信息块，改成了更现代的卡片式信息分区，去掉明显的旧产品痕迹。
3. 把顶部栏、下拉菜单、AG Grid 的 `balham` / `alpine` 主题继续统一到新的蓝白 SaaS 风格，减少“只是换皮”的感觉。
4. 对整个主路由做了真实预览审计，确认**一级主页面没有缺页**，但**预览 mock 覆盖仍然不完整**，有一部分页面目前是“路由可进入，但仍有接口 404 或局部运行时错误”。

一句话总结：

- 页面“有没有”这一层，没有缺漏。
- 页面“预览得够不够完整”这一层，还需要继续补 mock。
- `Workloads` 这一类最像旧版的主页面，已经开始真正改结构了，不再只是改颜色。

---

## 2. 本轮已完成的重构内容

### 2.1 全局层

本轮继续强化了这些公共区域：

- 顶部栏：改成更轻、更浮层化的分段式头部，不再像旧版的一整条平铺导航。
- 下拉菜单 / Select：统一圆角、阴影、留白和选中态。
- AG Grid 表格主题：不仅 `alpine` 统一了，连大量遗留的 `balham` 也做了蓝白化处理，不再保留旧式灰重边框感。
- 页面标题区：补全了更多主路由的顶部标题，不再大量回退成 Dashboard。

### 2.2 重点页面：Workloads

这次 `Workloads` 页面是结构性改动最大的一个：

- 新增顶部概览卡片：总工作负载、策略覆盖、隔离数量、漏洞风险。
- 新增焦点工作负载卡：把当前选中容器的命名空间、服务、主机、应用、风险值放到页面中心区域，形成视觉焦点。
- 主工作区改成左右工作台：
  - 左侧是工作负载列表区
  - 右侧是详情工作台
- 列表区内部重新组织：
  - 工具栏改成轻量统计块 + 搜索
  - 行高、标题行、元信息密度都重新调整
  - 名称单元格不再是旧式单行文本，改成“主标题 + 元信息 + 子项展开”形式
- 详情区顶部新增 Hero 区：
  - 显示状态、扫描状态、策略模式、端口数、网卡数、风险值
  - 不再一进来就是旧式 tab + 表格

### 2.3 容器详情页

旧版容器详情页里最明显的老味道，是一排排绿色圆形图标 + 左右堆信息。

这次已经改成：

- 顶部 Hero 概览区
- 基础信息卡片网格
- 网络接口 / 端口映射 / Labels 分区展示

这样视觉上已经明显脱离旧版“控制台工具页”的样子，更接近现代 SaaS 工作台。

---

## 3. 页面盘点结果

## 3.1 一级主路由盘点

当前主路由共 27 个，代码层面没有发现“缺页”。

### 工作区与资产

- `dashboard`
- `graph`
- `platforms`
- `domains`
- `hosts`
- `workloads`
- `regScan`
- `controllers`

### 策略与控制

- `admission-control`
- `group`
- `policy`
- `response-policy`
- `dlp-sensors`
- `waf-sensors`
- `federated-policy`

### 风险与通知

- `scan`
- `cveProfile`
- `bench`
- `cisProfile`
- `event`
- `security-event`
- `audit`

### 设置与辅助

- `settings`
- `signature-verifiers`
- `support`
- `profile`
- `multi-cluster`

---

## 3.2 预览模式真实审计结果

我用浏览器在本地预览模式下，对这 27 个主路由逐个做了实际打开测试。

审计结果文件：

- `d:\vscode\nv\_ui_check\route-audit-isolated-2026-04-05.json`

### A. 预览完整度较好，未捕获错误的页面

这批页面目前适合直接看 UI：

- `dashboard`
- `domains`
- `workloads`
- `regScan`
- `scan`
- `cveProfile`
- `bench`
- `security-event`
- `settings`
- `support`
- `profile`
- `multi-cluster`

### B. 路由能进入，但预览 mock 还不完整的页面

这批页面不是“没有页面”，而是“页面存在，但当前预览数据仍不够完整”：

- `graph`
- `platforms`
- `hosts`
- `controllers`
- `admission-control`
- `group`
- `policy`
- `response-policy`
- `dlp-sensors`
- `waf-sensors`
- `cisProfile`
- `event`
- `audit`
- `signature-verifiers`
- `federated-policy`

### C. 当前主要问题类型

这批未完全预览好的页面，问题主要集中在两类：

1. 预览接口未补齐
   - 典型表现是请求 `/graph`、`/platforms`、`/controllers`、`/policy` 之类接口时返回 404

2. 页面初始化依赖的数据结构不完整
   - 典型表现是 `hosts`、`group`、`admission-control` 一类页面出现 `undefined.length` 或某字段缺失

这说明：

- 页面本身是有的
- 路由也能进
- 但如果要把“所有页面都能像首页那样完整预览”，还需要继续补这 15 个页面的 preview mock

---

## 4. 自检结果

### 4.1 构建结果

本轮修改后，前端生产构建已实际通过：

- 执行：`npm.cmd run prebuild`
- 执行：`npx.cmd ng build --configuration production`
- 结果：通过

说明这轮结构和样式修改没有把当前前端打坏。

### 4.2 截图检查

我额外生成了本轮关键页面截图，供核对样式：

- `d:\vscode\nv\_ui_check\dashboard-refresh.png`
- `d:\vscode\nv\_ui_check\workloads-refresh.png`
- `d:\vscode\nv\_ui_check\regScan-refresh.png`
- `d:\vscode\nv\_ui_check\scan-refresh.png`
- `d:\vscode\nv\_ui_check\security-event-refresh.png`
- `d:\vscode\nv\_ui_check\support-refresh.png`
- `d:\vscode\nv\_ui_check\policy-refresh.png`
- `d:\vscode\nv\_ui_check\settings-refresh.png`

其中最值得先看的页面是：

- `workloads-refresh.png`
- `dashboard-refresh.png`
- `policy-refresh.png`

原因是这三张图最能反映：

- 新结构是否已经拉开旧版既视感
- 顶部栏和侧栏是否统一
- 未补 mock 页面当前还差在哪

---

## 5. 本轮实际改动范围

本轮主要落在 `manager/admin/webapp/websrc/` 下，重点文件包括：

### 结构与页面

- `app/routes/containers/containers.component.html`
- `app/routes/containers/containers.component.scss`
- `app/routes/containers/containers.component.ts`
- `app/routes/containers/container-details/container-details.component.html`
- `app/routes/containers/container-details/container-details.component.scss`
- `app/routes/containers/container-details/container-details.component.ts`
- `app/routes/components/container-detail/container-detail.component.html`
- `app/routes/components/container-detail/container-detail.component.scss`
- `app/routes/components/containers-grid/containers-grid.component.html`
- `app/routes/components/containers-grid/containers-grid.component.scss`
- `app/routes/components/containers-grid/containers-grid.component.ts`
- `app/routes/components/containers-grid/containers-grid-name-cell/*`

### 全局样式与导航

- `app/common/styles/app/saas-theme.scss`
- `app/common/styles/app/top-navbar.scss`
- `app/frame/header/header.component.scss`
- `app/frame/header/header.component.ts`

### 预览模式

- `app/preview/preview-data.ts`

---

## 6. 剩余问题与下一步建议

### 已确认还没彻底收口的点

1. 还有 15 个主页面没有达到“可完整预览”的程度。
2. 某些老页面虽然样式已经被全局主题覆盖，但内部信息架构仍然偏旧。
3. `controllers / policy / admission-control / group / cisProfile` 这些页如果要达到和 `workloads` 同级的观感，需要继续逐页重做，不适合只靠全局 CSS。

### 最推荐的下一步顺序

1. 先补剩余 15 个主页面的 preview mock，让“所有页面都能看”这件事先成立。
2. 再按使用频率做第二批结构性重构，优先：
   - `policy`
   - `controllers`
   - `hosts`
   - `platforms`
   - `group`
3. 最后再统一收口表格密度、空状态、Drawer、弹窗、详情页信息块。

---

## 7. 当前可直接确认的话

可以确认：

- 现在不是只改颜色了，`Workloads` 已经开始脱离原版结构。
- 代码层面没有缺少一级主页面。
- 这轮修改可以正常构建。
- 预览模式覆盖面比之前更大，顶部标题也不再大面积回退成 Dashboard。

暂时还不能说满的地方：

- 还不能说“所有页面都已经完整预览到位”。
- 还不能说“所有主页面都已经完成结构级重构”。

当前更准确的状态是：

**主页面已经全部盘点清楚，重点页面已经开始做结构级重构，预览体系已经能支撑第一批核心页面检查，但要做到“所有页面都完整、都高级、都不像旧版”，还需要继续补第二轮。**
