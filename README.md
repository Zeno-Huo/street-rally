# STREET RALLY｜街头网球

一个单文件 HTML5 街头网球小游戏（Three.js），带可跨玩家共享的 TOP 10 排行榜。

**在线试玩**：https://street-rally.app.workbuddy.host/?sharecode=J5MZF5T4WL

> 链接必须带完整的 `?sharecode=...`，只访问域名会被网关拒绝（403）。
> 试玩链接由 WorkBuddy 应用发布提供，与本项目源码相互独立。

## 本地运行

只需 Node.js，无第三方依赖：

```bash
npm start          # 等价于 node server.js
```

打开 http://127.0.0.1:3000 。换端口：`PORT=8080 node server.js`。

打完一局会弹出上榜表单：名字（<=12 字）+ 个性签名（小字，<=24 字），提交后直接显示 TOP 10，自己那行高亮 `YOU`；没进前十会如实告诉排第几。首页和结算页各有 `TOP 10` 入口，名字与签名记在浏览器本地，下次自动回填。

榜单数据写在 `data/leaderboard.json`（首次提交自动生成，已加入 `.gitignore`），重启服务不会丢失。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查；前端据此决定是否显示榜单入口 |
| GET | `/api/leaderboard` | 返回 `{ ok, total, list }`，`list` 为前十 |
| POST | `/api/leaderboard` | 提交 `{ name, sign, score, perfects }`，返回名次与最新前十 |

服务端校验：名字 12 字、签名 24 字、分数上限 200000、最多保留 100 条；同 IP 10 秒最多 3 次提交；排序为分数降序、时间升序。玩家输入全部用 `textContent` 渲染，不拼 HTML。仅对外暴露页面与 `/api/*`，源码和数据文件不可直接访问。

## 说明

- `index.html` 约 4.4 MB：Three.js、字体（Anton / Permanent Marker）与音频素材全部内嵌，**无外部网络依赖**；游戏跑起来之后不再向服务器发请求，流量只发生在打开页面时。
- 纯静态托管时 `/api/*` 不存在，前端探针会自动隐藏 `TOP 10` 入口（游戏本体仍可玩），不会留下点不动的坏按钮。
- 这是无登录的网页，服务端只做基础限频与分数上限，**不是防作弊系统**。
- 内嵌字体与音频素材的授权请自行核对后再用于商业用途；Three.js 使用 MIT 许可。

## 许可

MIT — 见 [LICENSE](LICENSE)。
