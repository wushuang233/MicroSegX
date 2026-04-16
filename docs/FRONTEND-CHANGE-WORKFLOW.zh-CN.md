# MicroSegX 前端页面修改与重部署手册

这份文档只覆盖一类工作：

- 修改 `manager` 的前端页面
- 重新构建前端
- 重新打 `manager` 的本地镜像
- 导入本机 `k3s` 的 containerd
- 滚动更新 `microsegx-manager-pod`
- 验证页面已经真正生效

适用前提：

- 当前源码目录是 `/home/wushuang/MicroSegX`
- 集群是本机 `k3s`
- `manager` 使用本地镜像名 `local.microsegx/microsegx/manager:<tag>`
- 这次改动只涉及前端，不改 controller / enforcer / scanner

## 1. 先搞清楚前端代码改哪里

常见位置如下：

- 页面路由：`manager/admin/webapp/websrc/app/routes/`
- 通用组件：`manager/admin/webapp/websrc/app/routes/components/`
- 顶栏和侧栏：`manager/admin/webapp/websrc/app/frame/`
- 全局样式：`manager/admin/webapp/websrc/styles.scss`
- 公共样式：`manager/admin/webapp/websrc/app/common/styles/`
- 中文文案：`manager/admin/webapp/websrc/assets/i18n/zh_cn-common.json`
- 英文文案：`manager/admin/webapp/websrc/assets/i18n/en-common.json`

不要直接改这些生成物：

- `manager/admin/webapp/root/`
- `manager/admin/target/`

原因：

- `root/` 是 Angular 生产构建产物
- `admin-assembly-1.0.jar` 会把 `root/` 里的静态资源打进 jar
- 直接改生成物，下一次构建会被覆盖

## 2. 这条链路为什么不能只改前端文件

`manager` 的前端静态资源最终不是直接从源码目录提供，而是被打进 `admin-assembly-1.0.jar`。

关键事实：

- Angular 构建输出目录是 `manager/admin/webapp/root/`
- `manager/admin/build.sbt` 把 `admin/webapp` 作为资源目录打包进 jar
- 运行中的 `manager` Pod 实际提供的是 jar 里的静态资源

结论：

- 只改 `websrc/` 不够
- 只跑 `npm run build` 也不够
- 必须重新生成 `admin-assembly-1.0.jar`
- 必须重新打 `manager` 镜像并重新部署

## 3. 标准操作流程

### 3.1 设定本次发布变量

每次前端改动都必须使用一个全新的镜像 tag，不要复用旧 tag。

```bash
cd /home/wushuang/MicroSegX

export NS=microsegx
export DEPLOY=microsegx-manager-pod
export UI_TAG=2026.04.16-ui57
export POD_TAG=$(echo "${UI_TAG}" | tr '.@_' '-')
export WORKDIR=/home/wushuang/MicroSegX
export BASE_IMAGE=$(kubectl get deployment ${DEPLOY} -n ${NS} -o jsonpath='{.spec.template.spec.containers[0].image}')
export NEW_IMAGE=local.microsegx/microsegx/manager:${UI_TAG}
```

注意：

- `UI_TAG` 每次都要递增
- 不要重复使用已经导入过 `k3s` 的 tag
- `BASE_IMAGE` 取当前正在运行的 manager 镜像，最快也最稳

### 3.2 修改前端源码

直接改你要改的源码文件，例如：

```bash
manager/admin/webapp/websrc/app/routes/...
manager/admin/webapp/websrc/app/frame/...
manager/admin/webapp/websrc/assets/i18n/zh_cn-common.json
```

### 3.3 先做一次前端生产构建校验

这一步是快速检查，尽早发现 TS / 模板 / SCSS 报错。

```bash
cd /home/wushuang/MicroSegX/manager/admin/webapp
npm run build -- --configuration production
```

说明：

- 这一步成功后，产物会进入 `manager/admin/webapp/root/`
- 如果只是快速验证页面结构，这一步很有用
- 但它还没有重新生成 jar，所以不能代替后面的 `make_jar.sh`

### 3.4 重新生成 manager jar

```bash
cd /home/wushuang/MicroSegX/manager
bash ./make_jar.sh
```

这一步会做三件事：

- `npm install`
- `npm run build`
- `sbt admin/assembly`

最终产物：

```bash
manager/admin/target/scala-3.3.5/admin-assembly-1.0.jar
```

### 3.5 用新的 jar 重打 manager 镜像

纯前端改动时，使用本仓库现有的“快速重打包”方式即可：

```bash
cd /home/wushuang/MicroSegX
docker build \
  --build-arg BASE_IMAGE="${BASE_IMAGE}" \
  -f manager/package/Dockerfile.local-repack \
  -t "${NEW_IMAGE}" \
  manager
```

这个 Dockerfile 只做一件事：

- 用当前的 `admin-assembly-1.0.jar` 覆盖基础镜像里的 jar

所以这条链适合：

- 纯前端页面修改
- manager Scala 代码没改
- 不需要重做完整 SUSE 基础镜像链

### 3.6 导出镜像 tar

```bash
mkdir -p "${WORKDIR}/tmp/${UI_TAG}-import"
docker save \
  -o "${WORKDIR}/tmp/${UI_TAG}-import/microsegx-manager-${UI_TAG}.tar" \
  "${NEW_IMAGE}"
```

### 3.7 生成一次性导入 Pod 清单

```bash
cat > "${WORKDIR}/tmp/${UI_TAG}-import/import-manager.yaml" <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: import-manager-${POD_TAG}
  namespace: ${NS}
spec:
  restartPolicy: Never
  containers:
    - name: importer
      image: busybox:1.36.1
      command:
        - sh
        - -lc
        - sleep infinity
      securityContext:
        privileged: true
      volumeMounts:
        - name: hostfs
          mountPath: /hostfs
        - name: k3sbin
          mountPath: /host/bin/k3s
          readOnly: true
        - name: containerdsock
          mountPath: /run/k3s/containerd/containerd.sock
  volumes:
    - name: hostfs
      hostPath:
        path: /
        type: Directory
    - name: k3sbin
      hostPath:
        path: /usr/local/bin/k3s
        type: File
    - name: containerdsock
      hostPath:
        path: /run/k3s/containerd/containerd.sock
        type: Socket
EOF
```

### 3.8 把镜像导入 k3s 的 containerd

```bash
kubectl apply -f "${WORKDIR}/tmp/${UI_TAG}-import/import-manager.yaml"

kubectl wait \
  --for=condition=Ready \
  "pod/import-manager-${POD_TAG}" \
  -n "${NS}" \
  --timeout=120s

kubectl exec -n "${NS}" "import-manager-${POD_TAG}" -- \
  /host/bin/k3s ctr \
  -a /run/k3s/containerd/containerd.sock \
  -n k8s.io images import --all-platforms \
  "/hostfs${WORKDIR}/tmp/${UI_TAG}-import/microsegx-manager-${UI_TAG}.tar"

kubectl delete pod "import-manager-${POD_TAG}" -n "${NS}" --wait=true
```

### 3.9 更新 deployment

```bash
kubectl set image deployment/${DEPLOY} -n ${NS} \
  ${DEPLOY}=${NEW_IMAGE}

kubectl rollout status deployment/${DEPLOY} -n ${NS} --timeout=180s
```

## 4. 发布后必须做的验证

### 4.1 看 deployment 和 Pod 是否切到新 tag

```bash
kubectl get deployment ${DEPLOY} -n ${NS} -o wide
kubectl get pods -n ${NS} -l app=${DEPLOY} -o wide
```

### 4.2 对比 jar 的 SHA256

本地 jar：

```bash
sha256sum /home/wushuang/MicroSegX/manager/admin/target/scala-3.3.5/admin-assembly-1.0.jar
```

Pod 内 jar：

```bash
kubectl exec -n ${NS} deploy/${DEPLOY} -- \
  sh -lc 'sha256sum /usr/local/bin/admin-assembly-1.0.jar'
```

必须满足：

- 两边 SHA256 完全一致

如果不一致，说明：

- 你以为部署了新前端
- 实际 Pod 里跑的还是旧 jar

这种情况不要先怪浏览器缓存，先把镜像导入链查清楚。

### 4.3 手工看页面

推荐方式：

```bash
kubectl port-forward -n ${NS} svc/microsegx-service-webui 18443:8443
```

然后浏览器打开：

```text
https://127.0.0.1:18443/
```

再做这些动作：

- 强制刷新一次
- 登录
- 打开你修改过的页面
- 确认新文案、新布局、新按钮已经出现

## 5. 常见坑

### 5.1 只改了源码，没有重做 jar

症状：

- 本地文件已经改了
- 页面还是旧的

原因：

- 运行中 Pod 提供的是 jar 里的静态资源，不是 `websrc/`

正确做法：

- 重新跑 `bash manager/make_jar.sh`
- 重新打 manager 镜像
- 重新导入和 rollout

### 5.2 复用了旧镜像 tag

这是最容易踩的坑。

症状：

- `kubectl set image` 成功了
- Pod 看起来也更新了
- 页面仍然是旧的

原因：

- 本地 Docker 里的这个 tag 和 k3s containerd 里的同名 tag 可能不是同一份镜像
- 尤其是离线导入、本地反复打 tag 的场景，最容易出现“同名 tag 实际内容不同”

正确做法：

- 每次改前端都使用一个全新的 tag
- 不要复用旧 tag
- 发布后用 jar SHA256 再核对一遍

### 5.3 只看 rollout，不核对 jar

症状：

- `rollout status` 显示成功
- 页面还是旧的

原因：

- rollout 只说明 Pod 重建了
- 不说明 Pod 里的 jar 一定是你这次新打的

正确做法：

- 本地 jar 和 Pod 内 jar 都做 `sha256sum`
- 这是最可靠的最终判定方式

### 5.4 直接改 `root/` 里的编译产物

症状：

- 当下似乎生效
- 下一次构建又被覆盖

正确做法：

- 只改 `websrc/`
- 不改 `root/`

### 5.5 改了中文文案，却忘了它也要重新打包

`zh_cn-common.json` 和 `en-common.json` 也属于前端资源。

只要改了这些文件，同样要完整走这条链：

- build
- make jar
- build image
- import
- rollout

### 5.6 构建时出现 SCSS budget warning

如果 Angular 生产构建最终退出码是 `0`，但有类似下面的 warning：

- `exceeded maximum budget`

这通常是告警，不一定阻断构建。

处理原则：

- 先看命令是否失败
- 如果退出码是 0，可以继续
- 但样式文件已经明显变大时，后续最好再做一次收敛

## 6. 一次完整的最小命令清单

下面这一段可以直接作为模板抄用。

```bash
cd /home/wushuang/MicroSegX

export NS=microsegx
export DEPLOY=microsegx-manager-pod
export UI_TAG=2026.04.16-ui57
export POD_TAG=$(echo "${UI_TAG}" | tr '.@_' '-')
export WORKDIR=/home/wushuang/MicroSegX
export BASE_IMAGE=$(kubectl get deployment ${DEPLOY} -n ${NS} -o jsonpath='{.spec.template.spec.containers[0].image}')
export NEW_IMAGE=local.microsegx/microsegx/manager:${UI_TAG}

cd /home/wushuang/MicroSegX/manager/admin/webapp
npm run build -- --configuration production

cd /home/wushuang/MicroSegX/manager
bash ./make_jar.sh

cd /home/wushuang/MicroSegX
docker build \
  --build-arg BASE_IMAGE="${BASE_IMAGE}" \
  -f manager/package/Dockerfile.local-repack \
  -t "${NEW_IMAGE}" \
  manager

mkdir -p "${WORKDIR}/tmp/${UI_TAG}-import"
docker save \
  -o "${WORKDIR}/tmp/${UI_TAG}-import/microsegx-manager-${UI_TAG}.tar" \
  "${NEW_IMAGE}"

cat > "${WORKDIR}/tmp/${UI_TAG}-import/import-manager.yaml" <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: import-manager-${POD_TAG}
  namespace: ${NS}
spec:
  restartPolicy: Never
  containers:
    - name: importer
      image: busybox:1.36.1
      command:
        - sh
        - -lc
        - sleep infinity
      securityContext:
        privileged: true
      volumeMounts:
        - name: hostfs
          mountPath: /hostfs
        - name: k3sbin
          mountPath: /host/bin/k3s
          readOnly: true
        - name: containerdsock
          mountPath: /run/k3s/containerd/containerd.sock
  volumes:
    - name: hostfs
      hostPath:
        path: /
        type: Directory
    - name: k3sbin
      hostPath:
        path: /usr/local/bin/k3s
        type: File
    - name: containerdsock
      hostPath:
        path: /run/k3s/containerd/containerd.sock
        type: Socket
EOF

kubectl apply -f "${WORKDIR}/tmp/${UI_TAG}-import/import-manager.yaml"
kubectl wait --for=condition=Ready "pod/import-manager-${POD_TAG}" -n "${NS}" --timeout=120s
kubectl exec -n "${NS}" "import-manager-${POD_TAG}" -- \
  /host/bin/k3s ctr -a /run/k3s/containerd/containerd.sock -n k8s.io images import --all-platforms \
  "/hostfs${WORKDIR}/tmp/${UI_TAG}-import/microsegx-manager-${UI_TAG}.tar"
kubectl delete pod "import-manager-${POD_TAG}" -n "${NS}" --wait=true

kubectl set image deployment/${DEPLOY} -n ${NS} ${DEPLOY}=${NEW_IMAGE}
kubectl rollout status deployment/${DEPLOY} -n ${NS} --timeout=180s

sha256sum /home/wushuang/MicroSegX/manager/admin/target/scala-3.3.5/admin-assembly-1.0.jar
kubectl exec -n ${NS} deploy/${DEPLOY} -- sh -lc 'sha256sum /usr/local/bin/admin-assembly-1.0.jar'
```

## 7. 建议的日常习惯

- 每次前端发布都用新 tag
- 每次发布后都对比 jar SHA256
- 不要把“页面没变”直接归因于浏览器缓存
- 不要直接改 `root/` 编译产物
- 不要跳过 `make_jar.sh`
- 只改前端时，不要去重打 controller / enforcer / scanner

