# manager

`manager` 目录保存管理端相关代码，包括后端接口、前端页面、打包脚本和镜像构建文件。

## 目录说明

- `admin`
  Scala 后端工程，负责 API、静态资源装载和管理端服务启动。

- `admin/webapp`
  Angular 前端工程，页面样式、路由、组件和国际化资源主要都在这里。

- `common`
  `manager` 侧公共模块。

- `package`
  `manager` 镜像构建目录，包含 Dockerfile、requirements 和入口脚本。

- `scripts`
  运维和支持脚本。

- `images`
  界面定制相关示意资源。

## 常用流程

前端本地开发：

```bash
cd admin/webapp
npm ci
npm run start
```

前端生产构建：

```bash
cd admin/webapp
npm run build
```

构建后端 assembly：

```bash
make jar
```

构建 `manager` 镜像：

```bash
make build-image TAG=<tag> REPO=<repo>
```

## 说明

- 前端静态资源最终由 `admin/src/main/scala/com/microsegx/web/StaticResources.scala` 装入后端服务。
- 前端页面修改、重打包和重部署流程请看 `../docs/FRONTEND-CHANGE-WORKFLOW.zh-CN.md`。
- 整体打包与部署主流程请看 `../docs/DEPLOYMENT.md` 和 `../docs/PACKAGING.md`。
