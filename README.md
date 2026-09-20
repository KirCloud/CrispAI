# CrispAI

Crisp 智能客服助手的自部署版：关键词自动回复、AI 回复（带知识库检索）、选项卡片、欢迎语，
以及把每个 Crisp 会话同步到 Telegram 话题群，客服直接在 Telegram 里回复。

单用户、多项目。一个 `docker compose up` 起全套：

| 服务 | 说明 |
|---|---|
| `app` | Bun + Hono。Webhook、BullMQ worker、管理后台 API，以及管理页面的静态文件 |
| `postgres` | `pgvector/pgvector`，知识库检索用 vector 扩展 |
| `redis` | BullMQ 队列 |

## 部署

需要一个能被公网通过 **https** 访问的域名（Crisp 和 Telegram 的 Webhook 都要回调它）。

```bash
cp .env.example .env     # 按文件里的注释填写
docker compose up -d
```

然后用反向代理（Caddy / Nginx / Traefik 等）把域名指到 `127.0.0.1:3000`，打开
`https://你的域名/`，用 `ADMIN_USER` / `ADMIN_PASSWORD` 登录。数据库表在首次启动时自动创建。

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

后端源码（本仓库中除 `public/` 以外的全部内容）以 [GNU AGPL-3.0](LICENSE) 授权，
Copyright (C) 2026 DyAxy。

简单说：你可以自由使用、修改和部署，包括商用。但如果你修改了代码并把它作为网络服务提供给别人使用，
就必须以同样的许可证向这些用户公开你修改后的完整源码。只是自己部署自己用，没有任何额外义务。

两点例外：

- **`public/` 不适用 AGPL。** 它是预编译的管理页面，源码不在本仓库，版权保留；
  允许随本项目原样使用和分发，条款见 [public/LICENSE.txt](public/LICENSE.txt)。
  其中包含的第三方开源组件见 [public/THIRD-PARTY-NOTICES.txt](public/THIRD-PARTY-NOTICES.txt)。
- **名称和图标不随代码授权。** 你可以说明自己的服务“基于 CrispAI”，但不要让人误以为是官方提供的服务。

需要在闭源产品里使用、或者不方便遵守 AGPL 的，可以联系作者获取商业授权。

Crisp 是 Crisp IM SAS 的商标，本项目是独立的第三方集成，与 Crisp 官方无关。

