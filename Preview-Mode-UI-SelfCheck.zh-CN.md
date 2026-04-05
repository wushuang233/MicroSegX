# Preview 模式与 UI 自检说明

## 1. 现在可以怎么预览

前端已经加入仅开发环境使用的 Preview 模式，不需要真实账号密码，也不需要先把整套后端部署起来。

访问方式：

```text
http://127.0.0.1:4200/#/login
```

进入方式：

1. 打开登录页
2. 点击 `Enter Preview`
3. 自动跳转到 Dashboard
4. 可从左侧菜单继续查看 `Security Events`

## 2. 本地启动命令

如果本地预览服务没有启动，可以在 Windows PowerShell 中执行：

```powershell
cd d:\vscode\nv\manager\admin\webapp
npm.cmd run prebuild
npx.cmd ng serve --configuration development --host 127.0.0.1 --port 4200
```

## 3. 当前 Preview 模式覆盖范围

当前已打通的预览页面：

- 登录页
- Dashboard
- Security Events

Preview 模式会在开发环境中拦截部分接口请求，返回本地模拟数据，用来支撑页面结构、样式和交互预览。

## 4. 这次自检重点

已确认：

- `ng serve` 启动正常
- `ng build --configuration development` 编译通过
- 登录页可进入 Preview
- Dashboard 可正常加载
- Security Events 可正常加载
- 1440 / 1024 / 768 三个宽度下未发现横向溢出
- 头部品牌区已针对长系统名做过压缩和防截断处理

已修复的问题：

- Angular 20 `ng serve` 所需的 `buildTarget` 配置缺失
- Security Events 页面初始化顺序问题，避免了 Preview 下进入页面时的运行时异常

## 5. 当前仍然保留的非阻断项

浏览器控制台还有两条 AG Grid warning：

- `resetRowHeights()` 与 Auto Row Height 同时使用
- `sizeColumnsToFit()` 在 grid 宽度尚未稳定时触发

这两条目前不影响 Preview 页面查看，也不阻断打包。

## 6. 和正式环境的边界

Preview 模式是为了先看 UI，不是为了替代真实联调。

它适合：

- 看整体蓝白风格是否统一
- 看卡片、头部、侧栏、事件页是否漂移
- 在没有后端的情况下先检查主要页面结构

它不适合：

- 验证真实业务接口
- 验证权限链路
- 验证完整页面覆盖率
- 替代最终在 K8s 中的整体验收
