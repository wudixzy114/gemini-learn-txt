# gemini-text-learn

> **类 ChatGPT / Gemini 风格的对话式学习 Web 应用：Express 后端转发 OpenAI 兼容网关，React 18 + Vite 前端走 SSE 流式输出，支持 Markdown / KaTeX / 代码高亮。**

## 项目定位 / 背景

`gemini-text-learn` 是一个**双工程**的对话应用——`server/` 跑 Express 把 `/api/chat` 转发到任意 OpenAI 兼容端点（默认指向 Gemini gateway，可改 `.env`），`web/` 跑 Vite 6 + React 18 提供类似 ChatGPT 的左侧会话列表 + 右侧对话界面 UI。设计目标是"接哪都能跑"：换 baseUrl + model 列表就能切到 OpenAI / DeepSeek / 任何兼容网关。

服务端关键路径：`POST /api/conversations/:id/messages` 接收用户消息后，写入 `user` 消息，然后打开 SSE（`text/event-stream`）一边流一边 `POST` 到上游 LLM 端点；onDelta 回调把增量文本通过 `event: delta` 推给浏览器，streamChat 失败时仍然把已收到的部分保存进 conversation 防止丢失。流结束后服务端**自动调用一次 `completeOnce` 生成 2-6 字标题**（仅在 title 还是 "New chat" 时）。前端用 `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-highlight` 渲染回复。

会话存储用本地 JSON 文件（`server/src/store.js`），每条 conversation 单独一份；list / get / save / delete / reorder（手拖顺序）都通过文件系统实现。同一进程还能 serve 前端构建产物（`web/dist`），所以生产部署就是一份 Node 进程 + 静态资源。

## 仓库结构

```
gemini-learn-txt/
├── package.json                # gemini-text-learn v1.0.0（根）
├── .env.example
├── server/                     # Express + Node 18+ ESM
│   ├── package.json            # gemini-text-learn-server
│   ├── src/
│   │   ├── index.js            # Express 路由 + SSE 流 + 静态资源 serve
│   │   ├── config.js           # 读 .env：baseUrl / model / port / 模型白名单
│   │   ├── store.js            # 文件系统 conversation 存储
│   │   └── llm.js             # streamChat + completeOnce 包装 fetch
│   └── (package-lock.json)
├── web/                        # React 18 + Vite 6 前端
│   ├── package.json            # gemini-text-learn-web
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── store.js            # zustand 全局状态
│       ├── api.js              # fetch + EventSource 封装
│       ├── export.js           # 导出 Markdown / JSON
│       ├── styles.css
│       └── components/
│           ├── ChatView.jsx
│           ├── Composer.jsx
│           ├── Markdown.jsx    # react-markdown + KaTeX + highlight.js
│           ├── Message.jsx
│           ├── ModelPicker.jsx
│           ├── Sidebar.jsx     # 会话列表 + 拖拽排序
│           └── icons.jsx
```

## 技术栈

### 根
- `concurrently ^9.1.0` 串联 `server dev` + `web dev`

### Server（gemini-text-learn-server）
| 类别 | 选型 | 版本 |
| --- | --- | --- |
| 运行时 | Node.js（`node --watch`） | 18+ ESM |
| 框架 | express | 4.21.2 |
| 中间件 | cors、express.json（4mb limit） | 2.8.5 / 内置 |
| 配置 | dotenv | 16.4.7 |
| ID | nanoid | 5.0.9 |

### Web（gemini-text-learn-web）
| 类别 | 选型 | 版本 |
| --- | --- | --- |
| 框架 | React / react-dom | 18.3.1 |
| 构建 | Vite、@vitejs/plugin-react | 6.0.5 / 4.3.4 |
| 状态 | zustand | 5.0.2 |
| Markdown | react-markdown | 9.0.1 |
| GFM | remark-gfm | 4.0.0 |
| Math | remark-math、rehype-katex、katex | 6.0.0 / 7.0.1 / 0.16.11 |
| 代码高亮 | rehype-highlight、highlight.js | 7.0.1 / 11.11.1 |

## 核心模块 / 特性

- **服务端 Express 路由**（`server/src/index.js`）：
  - `GET /api/health` — `{ ok, model }` 心跳
  - `GET /api/models` — 返回 `MODELS` 列表与默认 model
  - `GET /api/conversations` / `POST /api/conversations` / `GET /:id` / `PATCH /:id` / `DELETE /:id` — 完整 CRUD
  - `PUT /api/conversations/order` — 持久化用户拖拽出的顺序
  - `POST /api/conversations/:id/messages` — **流式**主入口，写 user 消息后 `openSSE(res)` 走 `streamAssistantReply`
  - `POST /api/conversations/:id/messages/:messageId/regenerate` — 重生成最后一条 assistant
  - `DELETE /api/conversations/:id/messages/:messageId` — 删除整组对话（user+assistant 一起删，保 transcript 完整）
  - 生产模式 `app.use(express.static('web/dist'))` + `app.get('*')` SPA fallback
- **SSE 流式输出**（`server/src/index.js:106`）：`openSSE(res)` 返回一个 `send(event, data)` 闭包，事件类型 `user / reasoning / delta / error / done`。`streamAssistantReply` 监听 `res.on('close')` 用 `AbortController` 终止上游请求（**注意监听的是 `res` 不是 `req`，因为 `req` 一消费完 body 就会 close**）。流式失败时把已经收到的 content + reasoning 持久化，防止丢字。
- **自动标题**（`server/src/index.js:194`）：首次对话流结束后异步跑一次 `completeOnce` 生成 2-6 字标题，写回 `conv.title`，在 SSE `done` 帧的额外字段返回 `{ title }`，前端用来刷新 sidebar。
- **模型解析**（`resolveModel`）：优先级 `请求体里 valid 的 model > conversation.model > config.model`，避免重复。
- **`streamChat` / `completeOnce`**（`server/src/llm.js`）：薄包装 fetch + ReadableStream，吐 `{ reasoning, content }` 的 delta 回调。
- **存储层**（`server/src/store.js`）：单文件 `conv-<id>.json`，`order` 字段是用户排序用的"top 值"，`nextTopOrder` 给新会话分配一个比所有现存都大的整数。`reorderConversations` 重新派发连续的 top 值。
- **前端 Markdown 渲染**（`web/src/components/Markdown.jsx`）：`react-markdown` + `remark-gfm`（表格 / 任务列表）+ `remark-math` + `rehype-katex` + `rehype-highlight`（代码块 syntax highlight）。`katex` 同时挂在 `rehypeKatex` 与 `katex/dist/katex.min.css`。
- **前端流式接收**（`web/src/api.js` + `web/src/store.js`）：用 `fetch` + `ReadableStream` 自己解析 SSE（不是 `EventSource`，因为 `EventSource` 不支持 POST）。`Message` 组件边收边追加到 `content` / `reasoning` 字段。
- **拖拽排序**（`Sidebar.jsx`）：会话列表支持拖拽，调 `PUT /api/conversations/order` 持久化。
- **导出**（`web/src/export.js`）：单会话导出 Markdown / JSON，方便做"学习笔记"沉淀。
- **模型选择器**（`ModelPicker.jsx`）：拉 `/api/models` 拿白名单，用户切换 model 会写回 conversation（PATCH）。

## 已完成 / 进行中

- ✅ 双工程骨架（Express + React 18 + Vite 6）
- ✅ SSE 流式输出 + 失败部分持久化
- ✅ 自动标题生成
- ✅ Markdown / KaTeX / 代码高亮
- ✅ 会话 CRUD + 拖拽排序 + 导出
- ✅ 静态资源合并到 Express
- ⏳ 多轮上下文压缩 / 总结
- ⏳ 用户系统 / 鉴权
- ⏳ 工具调用（function calling）
- ❌ 单元测试

## 本地开发

```bash
# 一次性安装全部
npm run install:all   # npm install && npm --prefix server install && npm --prefix web install

# 复制 .env.example 到 server/.env，按需改 BASE_URL / MODEL / PORT
cp server/.env.example server/.env

# 并行起 server (4000) + web (5173)
npm run dev

# 单独跑
npm run dev:server
npm run dev:web

# 生产构建 + 启动
npm run build
npm start
```

## 状态

v1.0.0，**可对话、可流式、可渲染、可导出**的最小完整版；切到任意 OpenAI 兼容网关只需改 `.env`。

## License

仓库内未声明 License。
