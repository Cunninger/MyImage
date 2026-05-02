<div align="center">

# AI Drawing Studio

**AI 画图工坊** — 一个基于浏览器的 AI 图像生成与编辑工作站

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)
[![Made with Capacitor](https://img.shields.io/badge/Made%20with-Capacitor-61dafb.svg)](https://capacitorjs.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](#english) · [中文](#中文)

<!-- 在此处放置截图 -->
<!--
<img src="docs/screenshot.png" width="800" alt="AI Drawing Studio Screenshot" />
-->

</div>

---

## 中文

### 亮点

- **多模型支持** — GPT-Image-2 (4K/2K)、Grok-4-Image、DALL-E 3、Flux Pro、Seedream 4.0 等
- **文生图 + 图生图** — 输入文字生成图片，或上传参考图进行 AI 编辑
- **提示词灵感库** — 内置 70+ 精选中文提示词，覆盖人像、场景、角色设计等 10 个分类
- **全平台** — 响应式 Web 应用 + Android APK，支持 PWA 离线安装
- **本地优先** — API Key 仅存储在本地设备，所有图片保存在浏览器 IndexedDB 中
- **零构建** — 纯 HTML/CSS/JS，无 Webpack/Vite 构建步骤

### 功能一览

| 功能 | 描述 |
|:---|:---|
| 文生图 | 输入提示词，选择模型、比例和数量，一键生成 |
| 图生图 | 上传 1-4 张参考图，输入编辑指令，AI 智能修改 |
| 提示词灵感 | 底部抽屉式灵感库，分类浏览，点击即用 |
| 图片管理 | 生成历史自动保存，支持搜索、筛选、下载、分享 |
| 暗色主题 | 精心设计的深色 UI，Aurora 渐变背景动效 |
| PWA 支持 | 添加到主屏幕，类原生体验 |
| Android APK | 基于 Capacitor 打包的原生 Android 应用 |

### 技术栈

```
Frontend    HTML · CSS · Vanilla JavaScript (ES2020+)
Backend     Node.js · Express
Storage     IndexedDB (客户端) · JSON (服务端)
Mobile      Capacitor 8 (Android)
API         pearapi.ai (OpenAI-compatible)
```

### 快速开始

#### 前提条件

- Node.js >= 18
- pearapi.ai API Key（[获取地址](https://pearapi.ai)）

#### 安装

```bash
# 克隆仓库
git clone https://github.com/cunninger/gpt-image.git
cd gpt-image

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 API Key

# 启动服务
npm start
```

打开浏览器访问 **http://localhost:3000**

#### 环境变量

| 变量 | 必填 | 说明 | 默认值 |
|:---|:---:|:---|:---|
| `PEARAPI_KEY` | ✓ | pearapi.ai API Key | — |
| `PEARAPI_BASE` | | API 基础地址 | `https://api.pearapi.ai` |
| `PORT` | | 服务端口 | `3000` |

### 构建 Android APK

```bash
# 同步 Web 资源到 Android 项目
npx cap sync android

# 构建调试版 APK
cd android && ./gradlew assembleDebug

# 输出路径
# android/app/build/outputs/apk/debug/app-debug.apk
```

> 需要安装 Android SDK 和 JDK 21+

### 项目结构

```
gpt-image/
├── public/                 # 前端静态资源
│   ├── index.html          # 主页面
│   ├── app.js              # 前端逻辑
│   ├── style.css           # 样式
│   ├── storage.js          # IndexedDB 存储层
│   ├── prompts.json        # 提示词灵感库数据
│   ├── manifest.json       # PWA Manifest
│   ├── sw.js               # Service Worker
│   └── icons/              # 应用图标
├── android/                # Capacitor Android 项目
├── server.js               # Express 后端服务
├── capacitor.config.json   # Capacitor 配置
├── package.json
└── LICENSE                 # GPL-3.0
```

### 支持的模型

| 模型 | 说明 |
|:---|:---|
| `gpt-image-2-4k` | GPT-Image 2 4K 高清 |
| `gpt-image-2-2k` | GPT-Image 2 2K 标清 |
| `grok-4-image` | Grok 4 图像生成 |
| `gpt-image-1` | GPT-Image 1 |
| `dall-e-3` | DALL-E 3 |
| `flux-pro` | Flux Pro |
| `seedream-4-0` | Seedream 4.0 |

### API 接口

| 路径 | 方法 | 说明 |
|:---|:---:|:---|
| `/api/generate` | POST | 文生图 |
| `/api/edit` | POST | 图编辑（支持 multipart） |
| `/api/history` | GET | 获取历史记录 |
| `/api/history/:id` | DELETE | 删除指定记录 |
| `/api/config` | GET | 获取配置状态 |

### 贡献

欢迎提交 Issue 和 Pull Request！

### 许可证

本项目基于 [GPL-3.0](LICENSE) 许可证开源。

---

<a id="english"></a>

## English

### Highlights

- **Multi-Model** — GPT-Image-2 (4K/2K), Grok-4-Image, DALL-E 3, Flux Pro, Seedream 4.0 and more
- **Text-to-Image & Image Editing** — Generate from prompts or edit uploaded images with AI
- **Prompt Library** — 70+ curated Chinese prompts across 10 categories (portrait, scene, character design, etc.)
- **Cross-Platform** — Responsive web app + Android APK + PWA support
- **Privacy-First** — API keys stored locally only, images saved in browser IndexedDB
- **Zero Build** — Pure HTML/CSS/JS, no Webpack/Vite build step required

### Quick Start

```bash
git clone https://github.com/cunninger/gpt-image.git
cd gpt-image
npm install
cp .env.example .env  # Add your pearapi.ai API key
npm start
```

Visit **http://localhost:3000**

### Build Android APK

```bash
npx cap sync android
cd android && ./gradlew assembleDebug
```

> Requires Android SDK and JDK 21+

### Tech Stack

```
Frontend    HTML · CSS · Vanilla JavaScript (ES2020+)
Backend     Node.js · Express
Storage     IndexedDB (client) · JSON (server)
Mobile      Capacitor 8 (Android)
API         pearapi.ai (OpenAI-compatible)
```

### Supported Models

`gpt-image-2-4k` · `gpt-image-2-2k` · `grok-4-image` · `gpt-image-1` · `dall-e-3` · `flux-pro` · `seedream-4-0`

### Contributing

Issues and Pull Requests are welcome!

### License

This project is licensed under the [GPL-3.0 License](LICENSE).
