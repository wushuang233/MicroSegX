# scanner

`scanner` 目录保存漏洞扫描组件源码，负责漏洞库读取、镜像与运行时扫描、任务执行和扫描结果输出。

## 目录说明

- `scanner.go`
  扫描器主入口。

- `server.go`
  服务模式入口，供控制面调用。

- `standalone.go`
  独立运行模式入口。

- `cvetools`
  漏洞库、特征解析和包信息处理逻辑。

- `detectors`
  系统与软件包识别逻辑。

- `task`
  扫描任务执行逻辑。

- `monitor`
  辅助监控组件。

- `data`
  本地漏洞数据库和相关数据文件。

- `package`
  scanner 镜像打包文件。

## 常用流程

构建本地二进制：

```bash
make build
```

运行单元测试：

```bash
make test
```

构建镜像：

```bash
make build-image TAG=<tag> REPO=<repo>
```

## 说明

- `scanner` 既可以作为服务模式接入控制面，也可以独立运行做单次扫描。
- 运行时实际部署通常还会配合漏洞库更新流程一起使用，镜像和交付以仓库根目录 `ops/`、`docs/` 下流程为准。
- 当前工程里的 `scanner` 主要服务于 Kubernetes 集群内的安全评估，不再以公开产品 README 的用法说明为准。
