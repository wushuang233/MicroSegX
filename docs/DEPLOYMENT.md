# MicroSegX 部署入口

从现在开始，部署文档分成两份：

- [打包文档](./PACKAGING.md)
- [导入与部署文档](./IMPORT-DEPLOYMENT.md)

先读 [打包文档](./PACKAGING.md)，再读 [导入与部署文档](./IMPORT-DEPLOYMENT.md)。

这两份文档已经按 2026-04-08 在单机 k3s 环境上的实操结果整理过，覆盖了下面这些已经确认过的坑：

- `controller` 持久化必须开启，否则重启后会重新走初始化流程
- 只删 `microsegx` namespace 不够，旧 CRD 和 cluster-scoped RBAC 也要清
- `scanner/data/cvedb` 是 Git LFS 指针时不能直接打镜像
- k3s 节点如果处于 `DiskPressure`，导入 helper 和业务 Pod 都会调度异常
- `load-local-images.sh` 需要固定导入到当前节点，不能让 helper Pod 随机漂到别的节点

持久化的结论可以先记住这一句：

- `controller` 只要没有 `PVC + /var/microsegx + CTRL_PERSIST_CONFIG=1` 这三件套，就不要期待“重启后密码和配置还在”。
