# Revision Lens

一个让 AI 改写过程可解释、可对比、可逐条接受的中文写作编辑器。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`，选中编辑器中的任意一段文字，点击浮动按钮里的“诊断并改写”。

## AI 接入

项目已经预留 Vercel Serverless API：

```text
api/revision/analyze.ts
```

没有配置环境变量时，前端会自动使用 mock 结果，保证演示体验稳定。部署到 Vercel 后可以添加：

```text
DASHSCOPE_API_KEY=你的阿里百炼 API Key
DASHSCOPE_MODEL=qwen-turbo
```

## 部署

这是一个 Vite + React 项目，可以直接部署到 Vercel。生产构建命令：

```bash
npm run build
```
