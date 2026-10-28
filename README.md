# KirCloud Console · CrispAI

基于 [Haruka-Network/CrispAI](https://github.com/Haruka-Network/CrispAI) 的自部署扩展。
保留原仪表盘和项目编辑界面，在项目顶部四个标签后增加「AI 配置」，并提供同风格的管理员登录页。
原 `public/` 文件不作修改；独立扩展在页面响应中加载，新增源码位于 `web/`，不依赖额外前端构建工具。

Crisp 智能客服助手的自部署版：关键词自动回复、AI 回复（带知识库检索）、选项卡片、欢迎语，
以及把每个 Crisp 会话同步到 Telegram 话题群，客服直接在 Telegram 里回复。

单用户、多项目。一个 `docker compose up` 起全套：

| 服务       | 说明                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| `app`      | Bun + Hono。Webhook、BullMQ worker、管理后台 API，以及管理页面的静态文件 |
| `postgres` | `pgvector/pgvector`，知识库检索用 vector 扩展                            |
| `redis`    | BullMQ 队列                                                              |

## 部署

需要一个能被公网通过 **https** 访问的域名（Crisp 和 Telegram 的 Webhook 都要回调它）。

```bash
cp .env.example .env     # 按文件里的注释填写
docker compose up -d
```

然后用反向代理（Caddy / Nginx / Traefik 等）把域名指到 `127.0.0.1:3000`，打开
`https://你的域名/`，用 `ADMIN_USER` / `ADMIN_PASSWORD` 登录。数据库表在首次启动时自动创建。

### 登录与 AI 配置

1. 打开 `/login`，使用 `.env` 中已有的管理员账号密码登录。
2. 进入项目，点击顶部新增的第五个标签 **AI 配置**。也可以使用仪表盘右上角入口，或直接访问 `/settings/ai`。
3. 填写 OpenAI 兼容 API 的 Base URL 和 API 密钥，点击「读取模型」，从服务商 `/models` 返回的列表选择对话模型。
   使用 DeepSeek 时可填写 `https://api.deepseek.com`。无需知识库时关闭向量检索即可。
4. 点击「测试连接」验证当前表单；可同时检查向量输出是否为 1536 维。
5. 点击「保存配置」。配置写入 PostgreSQL，新请求即时生效，无需重启容器。
6. 进入具体项目的「智能回复」，开启 AI 回复并保存。全局接口配置不会自动开启任何项目的 AI。

密钥只保存在服务器，读取接口不会返回它。密钥输入框留空会保留现有值；
测试连接使用当前表单，但不会保存，且会向所选服务商发送简短测试请求，可能产生少量费用。
知识库需要支持 Embeddings、输出 1536 维向量的模型，可以使用云端服务或本地部署的兼容接口。
开启「使用知识库向量检索」后，可单独填写向量 API 地址、密钥并读取其 `/models`；
向量地址留空时复用对话接口。不同服务商必须单独填写密钥，后端不会将对话密钥发送到另一家向量服务商。
已保存的向量密钥同样不会回显，留空保留。

文档保存在项目「智能回复」的知识库中。项目的「AI 配置」底部显示已索引/待索引数量，
「生成知识库向量」会依次处理待索引条目；失败后已完成的条目会保留，再次点击可继续。
更换向量模型后，勾选「重新生成全部条目」再生成。生成索引会将文档正文发送给配置的向量服务商，并产生相应 API 用量。
对话时自动检索当前项目最相关的 3 条资料并作为参考上下文传给对话模型。

同一页面的「文档自动同步」支持 V2Board 风格的 `knowledge/fetch` 接口：填写 API 地址、
Authorization 完整值和用户查看教程的地址，保存后可立即同步，或开启定时同步（15 分钟至 7 天）。
后台每分钟检查到期来源，读取目录及 `?id=...` 正文，以正文哈希比较变化。
只对新增或变化内容重新生成向量；未变条目保留索引；撤下内容保留存档但退出检索。
同步只管理带来源标识的条目，不改手动添加的知识库和项目设置。
源站共享账号访问区块、iframe、脚本和个人订阅模板不会写入检索正文。
接口访问失败时保留现有文档；向量接口失败时保留待处理条目，可再次同步或手动生成。
令牌失效后需在这里更新，密钥和令牌均不包含在项目导出文件内。

知识库状态和索引接口分别为 `GET /api/v1/knowledge?project_id=...` 和
`POST /api/v1/knowledge/index`（JSON：`project_id`、`payload_id`），均需管理员认证。
不使用知识库时，普通文字回复不依赖向量模型。

首次使用从 `.env` 读取 AI 默认值；在后台保存后，数据库配置优先于 `OPENAI_*` 环境变量。
项目导入导出不包含 API 密钥和全局接口配置，请备份完整数据库以保留这些配置。

网页登录使用 HttpOnly、SameSite=Strict 的会话 Cookie，HTTPS 部署时启用 Secure。
会话有效期为 12 小时；退出、重启应用或修改 `.env` 中的管理员凭据会使会话失效。
命令行仍可用显式 Basic 认证调用受保护接口；浏览器不会再弹出原生认证窗口。
未配置 `ADMIN_PASSWORD` 时，管理接口保持关闭。

使用反向代理时，`PUBLIC_URL` 必须与浏览器访问的地址一致，用于同源校验。
只有在代理覆盖 `X-Real-IP` 且应用端口仅对该代理开放时，才设置 `TRUST_PROXY=true`，
否则登录限流按连接来源统计。不要将应用端口直接暴露到公网。

### 开发与验证

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
```

新增页面是可编辑的 HTML、CSS 与 JavaScript（`web/`）；后端继续使用 Bun + Hono。
`web/assets/extension.js` 在原项目页挂载第五个标签，支持键盘切换、明暗主题和移动端标签滚动。
`web/ai-panel.html` 同时供嵌入面板和独立配置页使用。`public/` 保持原样，避免维护预编译文件的补丁。
认证、配置保存、配置重载、连接测试和页面路由均有自动化测试。

### 准备 Crisp 插件

这一步需要你自己在 Crisp 那边完成：

1. 在 <https://marketplace.crisp.chat> 创建一个私有插件
2. 申请需要的 scopes：会话消息的读写、会话 meta / 浏览页面的读取
3. Web Hooks 地址填 `https://你的域名/crisp`，订阅 `message:send`、`message:received`、`message:updated`
4. 把插件的 Token Identifier / Key、Web Hooks 签名密钥、URN 填进 `.env`，重启服务
5. **把插件安装到你的 Crisp 站点**：在 Marketplace 的插件页面里安装
6. 在管理后台创建项目，把该站点的 Website ID 填到「基础设置」里并启用项目

没安装插件的站点不会向 `/crisp` 推送任何消息，项目看起来就是「启用了但没反应」，排查时先确认这一步。

### 准备 Telegram

1. 找 @BotFather 创建机器人，token 填进 `.env`
2. 建一个开启了「话题」的群，把机器人拉进去并设为管理员（需要管理话题的权限）
3. 在群里发 `/ping`，机器人会回复群组 ID，填到项目的「基础设置」里

Webhook 由服务启动时自动注册到 `PUBLIC_URL/telegram`，并带 secret 校验。

### 欢迎语

在你的网站上，Crisp 脚本之后加一行（项目「基础设置」里有现成的可以复制）：

```html
<script type="text/javascript" src="https://你的域名/intro.js"></script>
```

## 日常操作

```bash
# 改了 .env：重新执行 up，compose 会用新配置重建 app 容器（数据库和 Redis 不受影响）
docker compose up -d

# 更新版本：拉代码后带 --build 重新构建镜像
git pull
docker compose up -d --build

# 看日志
docker compose logs -f app

# 备份数据库
docker compose exec postgres pg_dump -U crispai crispai > backup.sql
```

注意：

- `docker compose restart` **不会**重新读取 `.env`，改了配置要用 `up -d`
- `POSTGRES_PASSWORD` 只在数据库首次初始化时生效，之后改 `.env` 里的值不会改掉数据库的实际密码，
  反而会让 app 连不上。确实要换密码，先在数据库里执行 `ALTER USER crispai PASSWORD '新密码';` 再改 `.env`
- `docker compose down` 只删容器，数据还在；`docker compose down -v` 会连数据卷一起删掉，**数据库和图片都会丢**

## 许可证

后端及新增 `web/` 页面源码（本仓库中除 `public/` 以外的全部内容）以 [GNU AGPL-3.0](LICENSE) 授权，
Copyright (C) 2026 DyAxy。
KirCloud 扩展部分 Copyright (C) 2026 KirCloud，同样以 AGPL-3.0 授权。

简单说：你可以自由使用、修改和部署，包括商用。但如果你修改了代码并把它作为网络服务提供给别人使用，
就必须以同样的许可证向这些用户公开你修改后的完整源码。只是自己部署自己用，没有任何额外义务。

两点例外：

- **`public/` 不适用 AGPL。** 它是预编译的管理页面，源码不在本仓库，版权保留；
  允许随本项目原样使用和分发，条款见 [public/LICENSE.txt](public/LICENSE.txt)。
  其中包含的第三方开源组件见 [public/THIRD-PARTY-NOTICES.txt](public/THIRD-PARTY-NOTICES.txt)。
- **名称和图标不随代码授权。** 你可以说明自己的服务“基于 CrispAI”，但不要让人误以为是官方提供的服务。

需要在闭源产品里使用、或者不方便遵守 AGPL 的，可以联系作者获取商业授权。

Crisp 是 Crisp IM SAS 的商标，本项目是独立的第三方集成，与 Crisp 官方无关。
