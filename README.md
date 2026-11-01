# 星闪悦动本地驱动

将 [hub.xsyd.top](https://hub.xsyd.top/) 的已发布前端资源保存到本机，并改为开放设备准入。原站版本为 `1.3.0`，本地改动可通过补丁脚本复现。

**当前状态：可以启动首页，设备准入逻辑已完成，完整离线资源尚未补齐。** 原站资源主机在下载期间开始拒绝连接，部分动态功能页的 JS/CSS 和图片无法取得。详细列表见 `missing-assets.txt` 和 `web/local/resource-status.json`。请不要把当前状态理解为所有驱动功能均已完成验证。

## 本地启动

需要 Python 3.9 或更高版本。运行不需要 Node、npm 或联网安装依赖。

- macOS：双击 `启动本地驱动.command`。
- Windows：安装 Python 3 后，双击 `启动本地驱动.bat`。
- macOS / Linux 命令行：`python3 serve.py --open`。

使用 Chrome 或 Edge 打开 <http://127.0.0.1:8765>。默认浏览器如果是 Safari，请将地址复制到 Chrome / Edge。不能直接双击 HTML：WebHID 需要浏览器认可的安全上下文，回环地址满足这个条件。

服务只监听本机 `127.0.0.1`。按 `Ctrl+C` 停止。端口占用时可用 `python3 serve.py --port 8766 --open`。

## 连接设备

1. 连接 USB 设备或其接收器。
2. 顶部选择驱动协议，默认自动选择；未知设备默认键盘 V2，可手动指定键盘 V3 或鼠标。
3. 点击「添加设备」，在浏览器设备选择弹窗中选择并授权。
4. 在设备卡片中进入驱动。

已移除前端 VID/PID、品牌、设备接口 usage 白名单和在线设备目录准入限制。已授权设备不会因为不在原站目录中而从列表消失，多个驱动候选也不会造成冲突拦截。原驱动的协议握手仍用于确认通信能力。

**开放准入不等于通用硬件兼容。** 设备需要支持星闪悦动的相应协议；Chrome 对受保护 HID 接口的限制和操作系统权限仍然有效。普通蓝牙设备或其他私有协议设备不会因此变成可配置的设备。本任务没有连接或修改实物设备，也没有执行固件刷写。

鼠标未知芯片默认使用原协议查询探测目标地址 `0–3`。不同芯片地址可通过「使用说明 → 自定义设备目录」导入原站格式的 JSON。自定义配置只存放在本机浏览器。

## 已本地化的部分

- 首页及三种驱动的主体运行时：键盘 V2、键盘 V3、鼠标。
- 公开设备目录：564 个 VID/PID 定义，其中包含 14 个鼠标定义。
- 通用轴体列表、图标字体、已下载的样式和图片。
- 网络接口基址改为本机接口；`connect-src` 限制为本机。
- 本地协议选择、自定义设备目录导入、回环服务器和启动脚本。
- 账号入口、营销活动、在线更新轮询关闭。

社区、EchoRGB、延时测试等外部网页链接保留为原站入口，打开这些链接需要网络。原站账号、云端同步、在线固件服务没有在本地复制。板卡专属轴体列表需要对应型号数据，当前没有缓存的型号返回空列表，不会编造型号参数。固件使用原驱动已有的本地文件入口；在线接口不会自动下载或刷写固件。

## 资源恢复后补齐

`tools/mirror_site.py` 只下载公开前端资源，复用已存在的文件。原站恢复访问后执行：

```sh
python3 tools/mirror_site.py --extra /keyboard/ --extra /mouse/ --extra /keyboardv3/ --extra /keyboard/preload-manifest.json --extra /mouse/preload-manifest.json --extra /keyboardv3/preload-manifest.json
python3 tools/apply_local_patches.py
python3 tools/check_assets.py
```

最后一条只有所有引用资源都存在时才成功。不要用空文件替代缺失模块。

原始已修改文件保存在 `upstream-originals.zip`；`upstream-manifest.json` 记录下载文件的哈希。原站未提供本任务使用的 Vue 工程源代码，此目录包含公开构建产物和可读的本地适配代码。

## 验证

需要 Node 18 或更高版本运行准入模拟测试：

```sh
node --test tests/*.test.mjs
```

已通过未知 VID/PID、多设备、协议选择、取消与拒绝授权、本地目录、HID 接口选择的 10 项测试。首页已进行浏览器验证。真实设备配置与完整功能页验证仍待资源补齐和实物设备测试。

## 键盘 V2 宏探测（只读）

`web/local/macro-probe.html` 是只读探测页，用于确认 V2 键盘的宏协议细节（状态位含义、模式值、偏移单位）。启动本地服务后打开 <http://127.0.0.1:8765/local/macro-probe.html>，选择键盘并读取宏空间、模式和数据。页面只会发送读取帧，发送前由 `isReadOnlyFrame` 白名单校验。协议编码在 `web/local/macro-protocol.mjs`，`tests/macro-protocol.test.mjs` 会与原站 `esm-BSNVEyo2.js` 中的编码器逐字节比对。组合序列编辑与写入尚未实现。

### 组合序列编辑器（试运行，不写入设备）

`web/local/macro-editor.html` 把一串组合键（如 `ctrl+c 50`）转换为 V2 宏帧并显示将要写入的字节；页面没有任何设备访问代码，不会向键盘发送数据。已在 Carotmas Mer68 MAX 上通过只读探测确认：`status 1` 为按下、`0` 为抬起，键码为 USB HID 用途码，每帧 15 个动作。延迟单位、偏移单位和模式值尚未在设备上实测，页面会给出提示。
