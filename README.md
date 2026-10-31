# Shirone Blog Manager

面向 Windows 的 Shirone 博客管理工具。通过桌面界面写文章、整理歌单和调整博客外观，内容保存在自己的电脑里。

## 功能

- 文章编辑：可视化编辑、Markdown、插图、草稿、分类、标签、置顶。
- 文章上锁：设置阅读密码和提示，隐藏首页正文；支持修改密码、解除上锁。
- 外观资料：修改头像、名称、简介、背景与横幅文字。
- 音乐歌单：导入本地音频、编辑歌曲信息、调整播放顺序。
- 评论设置：配置主题支持的评论服务，一键打开管理后台。
- 本地预览、安装博客依赖、构建静态网站。
- 保存前自动备份，支持查看和恢复。

## 使用

在 [Releases](https://github.com/ACheekyL1ama/shirone-blog-manager/releases) 下载 EXE，双击运行，然后选择已有的 [Shirone](https://github.com/LyraVoid/Shirone) 博客目录。程序也会查找相邻的 `shirone` 文件夹。

预览和构建需要安装 Node.js 24，并能在终端中运行 `npm`。首次使用可点击“安装依赖”。EXE 是便携程序，不包含博客主题和 Node.js。

详细操作见 [使用说明](使用说明.md)。程序保存到本地后，需要重新构建、上传网站，线上内容才会更新。

文章密码与原文保存在本地 Markdown 和备份中。对外部署应只发布构建产物，避免把带密码的源文件上传到公开仓库。评论内容由所选评论服务管理，本工具提供配置和后台入口。

## 开发

```powershell
git clone https://github.com/ACheekyL1ama/shirone-blog-manager.git
cd shirone-blog-manager
npm ci
npm start
```

测试需要一份 Shirone 主题源码；默认读取相邻的 `../shirone`，也可以设置环境变量：

```powershell
git clone https://github.com/LyraVoid/Shirone.git ../shirone
$env:SHIRONE_THEME_DIR = (Resolve-Path ../shirone).Path
npm test
npm run dist
```

便携 EXE 输出到 `release/`。GitHub Actions 提供测试、构建和版本发布工作流。

当前适配的主题基线为 `LyraVoid/Shirone` 的 `dd1b782`。主题升级后建议先备份博客，并验证配置兼容性。

## 许可证

本项目以 [MIT](LICENSE) 许可证开源。Shirone 及其他依赖保留各自的许可证与版权，参见 [第三方说明](THIRD_PARTY_NOTICES.md)。本项目为独立管理工具。
