# 打包执行手册（给本地 Agent）

这份文档只给未来继续在本仓库工作的本地 agent 用。

目标只有一个：

**在不误判、不乱改版本、不产出错误交付包的前提下，正确完成 `MicroSegX + OpenZiti + Port-Audit` 的打包。**

## 1. 默认原则

### 1.1 默认交付目标

除非用户明确要求只做本地 `k3s` 联调包，否则默认交付目标是：

- 普通 Kubernetes 集群
- 节点运行时是 `containerd`
- 通过离线 bundle 交付

默认主线命令：

```bash
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

### 1.2 不要做的事

- 不要随意改 `CORE_TAG`、`SCANNER_TAG`、`UPDATER_TAG`
- 不要只因为想省时间就复用旧包并声称“已包含最新代码”
- 不要把本地 `k3s` 一体化 bundle 当成最终三节点集群交付包
- 不要假设“只在一台节点导入镜像就够了”
- 不要对 dirty worktree 视而不见

## 2. 每次打包前必须做的检查

### 2.1 先看工作区

```bash
git status --short
```

如果有未提交改动：

- 先判断是不是本次要包含的改动
- 如果是用户已有改动，不要覆盖
- 如果是和打包无关的改动，只记录，不要回滚

### 2.2 前置命令检查

```bash
for c in docker helm go make node npm java sbt python3 tar gzip sha256sum ctr kubectl; do
  printf '%-10s' "$c"
  command -v "$c" || true
done
```

```bash
docker info >/dev/null
```

### 2.3 脚本语法检查

```bash
bash -n \
  ops/full-release/build-and-package.sh \
  ops/full-release/build-k8s-containerd-suite.sh \
  ops/microsegx-local/build-and-package.sh \
  openziti/build-openziti-offline-bundle.sh \
  openziti/install-openziti-k8s.sh \
  openziti/deploy-openziti-k8s.sh \
  k8s-node-surface/scripts/build-containerd-bundle.sh \
  k8s-node-surface/scripts/build-stack-image-bundle.sh
```

### 2.4 `Port-Audit` 项目结构检查

```bash
./k8s-node-surface/scripts/verify-project.sh
```

## 3. 怎么判断该打哪一种包

### 3.1 用户要最终交付到普通 Kubernetes 集群

直接打总包：

```bash
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

### 3.2 只改了 `MicroSegX core`

先打：

```bash
bash ops/full-release/build-and-package.sh ops/full-release/full-release.k8s-delivery.env
```

这条链明显比 `OpenZiti` 和 `Port-Audit` 慢，agent 需要预留较长时间，不要跑了几十秒就误判成“卡死”。

如果用户要最终完整交付，再补打总包。

### 3.3 只改了 `Port-Audit`

先打：

```bash
bash k8s-node-surface/scripts/build-containerd-bundle.sh
```

如果用户要最终完整交付，再补打总包。

### 3.4 只改了 `OpenZiti`

先打：

```bash
OPENZITI_BUNDLE_TAG=<建议与 CORE_TAG 一致> bash openziti/build-openziti-offline-bundle.sh
```

如果用户要最终完整交付，再补打总包。

### 3.5 用户明确说只做本地 `k3s` 联调或演示

才走：

```bash
bash ops/microsegx-local/build-and-package.sh ops/full-release/full-release.env
```

## 4. 真实需要记住的仓库事实

### 4.1 `OpenZiti` 安装入口现在依赖 env 文件导出的变量

`openziti/install-openziti-k8s.sh` 已经修正为：

- 读取 env 文件
- 自动导出变量
- 再执行 `deploy-openziti-k8s.sh`

所以未来 agent 应继续使用：

```bash
bash openziti/install-openziti-k8s.sh /path/to/openziti.k8s.env
```

不要自己绕过这层再另写一套命令，除非用户明确要求。

### 4.2 `build-and-package.sh` 不能用进程替换当 env 文件

错误示例：

```bash
bash ops/full-release/build-and-package.sh <(sed '...')
```

脚本会先做文件存在性检查，这种方式不稳。

如果确实要临时改 env 值：

1. 先复制出一个真实临时文件
2. 修改临时文件
3. 把真实路径传给脚本

### 4.3 本地一体化 bundle 现在复制的是现有部署文档

不要再假设仓库根目录有独立的中文说明文件。

当前 `ops/microsegx-local/build-and-package.sh` 已改成从 `docs/IMPORT-DEPLOYMENT.md` 复制说明文档。

## 5. 推荐的安全执行顺序

### 5.1 最终总包

1. 检查工作区和前置命令
2. 确认 `ops/full-release/full-release.k8s-delivery.env`
3. 执行总包命令
4. 校验产物和校验和
5. 记录：
   - 使用的 env 文件
   - `CORE_TAG`
   - `PORT_AUDIT_VERSION`
   - `OPENZITI_BUNDLE_TAG`
   - 产物路径

### 5.2 组件单包

1. 只改某一块时先打对应单包
2. 单包通过后再决定是否需要总包
3. 不要只打单包却对用户说“完整交付包已更新”

## 6. 打包成功后的最小验证

### 6.1 总包

```bash
ls -lh artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
sha256sum artifacts/k8s-delivery/microsegx-suite-${CORE_TAG}.tar.gz
```

### 6.2 `MicroSegX core`

```bash
find artifacts/full-release/${CORE_TAG}/bundle -maxdepth 1 -type f | sort
```

### 6.3 `Port-Audit`

```bash
ls -lh k8s-node-surface/dist/k8s-port-audit-containerd-*.tar.gz
```

### 6.4 `OpenZiti`

```bash
ls -lh openziti/dist/openziti-k8s-offline-*.tar.gz
```

## 7. 多节点交付时一定要提醒用户的事

只要某个节点可能调度：

- `MicroSegX`
- `OpenZiti`
- `Port-Audit`

就必须先在那个节点导入对应镜像 tar。

否则最典型错误就是：

```text
ErrImageNeverPull
```

这是交付问题，不是业务代码问题。

## 8. 未来 agent 的默认回答边界

如果你已经完成打包，应明确告诉用户：

- 打的是哪条路径
- 生成了哪些产物
- 是否做了真实构建还是仅语法/预检
- 如果没有完整跑完，要如实说明卡在哪一步

不要把“脚本看起来没问题”说成“已经成功出包”。
