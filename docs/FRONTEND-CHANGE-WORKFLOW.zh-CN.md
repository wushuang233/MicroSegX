# MicroSegX 前端页面修改与重部署手册

这份手册只覆盖：

- 修改 `manager` 的前端页面
- 重新生成前端构建产物
- 重新打 `manager` 镜像
- 在本机 `k3s` 验证页面
- 把同一份改动重新纳入正式的 Kubernetes 集群交付链

## 1. 先明确边界

前端源码主要改这里：

- `manager/admin/webapp/websrc/app/routes/`
- `manager/admin/webapp/websrc/app/routes/components/`
- `manager/admin/webapp/websrc/app/frame/`
- `manager/admin/webapp/websrc/app/common/styles/`
- `manager/admin/webapp/websrc/styles.scss`
- `manager/admin/webapp/websrc/assets/i18n/zh_cn-common.json`

不要直接改这些生成物：

- `manager/admin/webapp/root/`
- `manager/admin/target/`

原因：

- Angular 产物最终会被打进 `admin-assembly-1.0.jar`
- 运行中的 `manager` 实际提供的是 jar 里的静态资源

所以结论只有一句：

- 改前端源码后，必须重新做 `jar -> manager 镜像 -> 部署`

## 2. 本机 `k3s` 验证流程

### 2.1 准备新 tag

每次都用新 tag，不要复用旧 tag。

```bash
cd /home/wushuang/MicroSegX

export NS=microsegx
export DEPLOY=microsegx-manager-pod
export UI_TAG=2026.04.17-ui01
export POD_TAG="$(echo "${UI_TAG}" | tr '.@_' '-')"
export WORKDIR=/home/wushuang/MicroSegX
export BASE_IMAGE="$(kubectl get deployment ${DEPLOY} -n ${NS} -o jsonpath='{.spec.template.spec.containers[0].image}')"
export NEW_IMAGE="local.microsegx/microsegx/manager:${UI_TAG}"
```

### 2.2 改源码

直接改 `websrc/` 下的源码文件。

### 2.3 先做一次 Angular 生产构建校验

```bash
cd /home/wushuang/MicroSegX/manager/admin/webapp
npm run build -- --configuration production
```

这一步只用于尽早发现 TS / 模板 / SCSS 报错，不能替代后面的 jar 重建。

### 2.4 重新生成 manager jar

```bash
cd /home/wushuang/MicroSegX/manager
bash ./make_jar.sh
```

最终 jar：

```text
manager/admin/target/scala-3.3.5/admin-assembly-1.0.jar
```

### 2.5 只重打 `manager` 镜像

纯前端改动时，直接用本仓库现成的快速重打包方式：

```bash
cd /home/wushuang/MicroSegX
docker build \
  --build-arg BASE_IMAGE="${BASE_IMAGE}" \
  -f manager/package/Dockerfile.local-repack \
  -t "${NEW_IMAGE}" \
  manager
```

### 2.6 导出镜像 tar

```bash
mkdir -p "${WORKDIR}/tmp/${UI_TAG}-import"
docker save \
  -o "${WORKDIR}/tmp/${UI_TAG}-import/microsegx-manager-${UI_TAG}.tar" \
  "${NEW_IMAGE}"
```

### 2.7 用一次性 helper Pod 导入到本机 `k3s`

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
      image: busybox:1.36
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

```bash
kubectl apply -f "${WORKDIR}/tmp/${UI_TAG}-import/import-manager.yaml"
kubectl wait --for=condition=Ready "pod/import-manager-${POD_TAG}" -n "${NS}" --timeout=120s
kubectl exec -n "${NS}" "import-manager-${POD_TAG}" -- \
  /host/bin/k3s ctr -a /run/k3s/containerd/containerd.sock -n k8s.io images import --all-platforms \
  "/hostfs${WORKDIR}/tmp/${UI_TAG}-import/microsegx-manager-${UI_TAG}.tar"
kubectl delete pod "import-manager-${POD_TAG}" -n "${NS}" --wait=true
```

### 2.8 更新 Deployment

```bash
kubectl set image deployment/${DEPLOY} -n ${NS} ${DEPLOY}=${NEW_IMAGE}
kubectl rollout status deployment/${DEPLOY} -n ${NS} --timeout=180s
```

### 2.9 验证 jar 确实已经生效

本地 jar：

```bash
sha256sum /home/wushuang/MicroSegX/manager/admin/target/scala-3.3.5/admin-assembly-1.0.jar
```

Pod 内 jar：

```bash
kubectl exec -n ${NS} deploy/${DEPLOY} -- sh -lc 'sha256sum /usr/local/bin/admin-assembly-1.0.jar'
```

两边 SHA256 必须一致。

### 2.10 让本机重启后仍能找到新 `manager` 镜像

如果你这台机器也要长期离线运行，发布后再执行：

```bash
cd /home/wushuang/MicroSegX
bash ops/microsegx-local/setup-k3s-offline-auto-import.sh
```

## 3. 这份前端改动怎么回到“正式 Kubernetes 集群交付”

如果最终目标是普通 Kubernetes 集群，不要只停留在本机 `k3s` 已验证。

推荐路径：

### 3.1 改动确认后，重新生成正式交付包

```bash
cd /home/wushuang/MicroSegX
bash ops/full-release/build-k8s-containerd-suite.sh ops/full-release/full-release.k8s-delivery.env
```

然后按：

- [K8S-CONTAINERD-DELIVERY-MANUAL.md](./K8S-CONTAINERD-DELIVERY-MANUAL.md)

把新的总包发到目标集群。

### 3.2 如果只是临时热修复集群里的 `manager`

也可以最小化处理：

- `docker save` 当前精确的 `manager:<tag>`
- 在每个目标节点导入这张镜像
- 更新目标集群的 `microsegx-manager-pod` image

但这只是临时修法。
后续正式迁移时，仍然建议把这次改动纳入新的离线交付包。

## 4. 最容易踩的坑

- 只改了 `websrc/`，没重新跑 `make_jar.sh`
- 直接改 `root/` 里的生成物
- 复用旧 tag
- 只看 `rollout status`，不比对 jar SHA256
- 本机验证通过后，没有把改动重新纳入正式集群交付包

如果页面看起来还是旧的，排查顺序建议固定成：

1. 本地源码是不是对的
2. 本地 jar SHA256 是不是新的
3. Pod 内 jar SHA256 是不是同一份
4. Deployment image tag 是不是这次新 tag
5. 最后再考虑浏览器缓存
