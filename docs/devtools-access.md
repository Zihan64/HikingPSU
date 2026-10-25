# 开发工具访问控制与部署

同一仓库保留正式功能和开发工具，但它们使用不同的启动命令、构建产物、身份配置与数据。**知道开发站点地址、注册正式账号或拥有 GitHub contributor 身份，都不自动获得开发权限。**

## 当前状态

实现默认关闭。没有完整配置和授权名单时，不会启动可用的开发服务。仓库不预设任何真实的获准人员，也没有免登录后门。首次启用需要项目管理员在 Auth0 创建独立应用/API，并配置明确的用户 ID 名单。

## 配置 Auth0（由管理员一次性完成）

可以沿用现有 Auth0 tenant，但新建独立的 **Regular Web Application** 和独立 **API**：

1. Web Application 用于开发者真实登录。其 Client ID 必须不同于正式 SPA；Client Secret 只保留在开发服务端。
2. 新 API 的 Identifier 必须不同于正式 API。启用 **RBAC** 和 **Add Permissions in the Access Token**，添加：
   - `devtools:access`：访问开发页面与私有资源。
   - `simulation:use`：使用模拟器及其测试接口。
   - `testdata:reset`：重置自己的测试数据。
3. 创建角色并赋给明确允许的 Auth0 用户。访问权限同时要求 **令牌中的权限** 和 **服务端名单中的权限**；两者取交集。
4. 将获准用户的 Auth0 `user_id` 写入服务端允许名单，不使用姓名、邮箱、浏览器自报角色或 GitHub commit 作者名。建议为开发应用启用 MFA。
5. Allowed Callback URLs 设置为开发 origin 加 `/devtools/callback`，例如本地 `http://127.0.0.1:5176/devtools/callback`。设置开发站点实际 origin 的 Web Origins。远程环境必须使用 HTTPS。
6. 本地使用 `127.0.0.1` 时，从这个地址完整访问，不在 `localhost` 与 `127.0.0.1` 间混用；服务严格匹配所配置的 origin/host。

服务器使用 Authlib 的 OIDC Authorization Code + PKCE 流程，校验登录 state、nonce 和 ID token；同时独立校验 API token 的 RS256 签名、issuer、独立 audience、应用 ID、到期时间和 permissions。身份令牌与访问令牌的 subject 必须一致。

参考：[Auth0 PKCE](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce)、[访问令牌校验](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens)。

## 本地启用

```powershell
cd backend
.venv/Scripts/python.exe -m pip install -r requirements-devtools.txt
Copy-Item .env.devtools.example .env.devtools.local
New-Item -ItemType Directory -Force .devtools
Copy-Item devtools.allowlist.example.json .devtools/allowlist.json
```

填写 `.env.devtools.local`，不要在聊天、PR 或 `VITE_*` 变量里放 Client Secret/Session Secret。

| 配置 | 内容 |
| --- | --- |
| `HIKINGPSU_ENV` / `DEVTOOLS_ENABLED` | `development` / `1`，两者必须同时满足 |
| `DEVTOOLS_ORIGIN` | 本地 `http://127.0.0.1:5176`；远程使用独立 HTTPS origin |
| `DEVTOOLS_AUTH0_DOMAIN` | Auth0 tenant 或受信任自定义域名，不含协议和路径 |
| `DEVTOOLS_AUTH0_CLIENT_ID` / `_CLIENT_SECRET` | 新建 Regular Web Application 的配置 |
| `DEVTOOLS_AUTH0_AUDIENCE` | 新建开发 API 的 Identifier |
| `DEVTOOLS_PRODUCTION_AUDIENCE` / `_CLIENT_ID` | 正式 API Identifier 和 SPA Client ID，用于拒绝混用 |
| `DEVTOOLS_SESSION_SECRET` | 至少 32 个随机字符，仅用于服务端签名预登录会话 |
| `DEVTOOLS_ALLOWLIST_FILE` | 允许名单文件路径；默认 `.devtools/allowlist.json` |
| `DEVTOOLS_ASSET_DIR` | 私有构建路径；默认 `../frontend/.devtools-dist` |

允许名单格式（下面的 ID 只是示例，必须换成真实获准人员；仓库模板是空名单）：

```json
{
  "users": {
    "auth0|REPLACE_WITH_APPROVED_USER_ID": {
      "enabled": true,
      "permissions": ["devtools:access", "simulation:use", "testdata:reset"]
    }
  }
}
```

实际配置 `.env.devtools.local`、`backend/.devtools/` 和私有构建均被 Git 忽略。生产数据库地址、Auth0 Management 凭据和真实 LLM key 不需要提供给开发服务。

回到项目根目录启动：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-badge-lab.ps1
```

脚本先创建私有产物，再启动单个 `127.0.0.1:5176` 服务。旧的 8010 免登录后端与独立 Vite 服务已退役。访问根地址显示通用登录页；成功登录且通过名单/权限检查后才返回开发 HTML、JS 和配置。

停止：`powershell -ExecutionPolicy Bypass -File scripts/stop-badge-lab.ps1`。

## 独立远程开发站点

- 使用独立服务/origin。不要把私有产物上传到公开 Amplify 分支或公开对象存储。
- 构建：在 `frontend` 执行 `npm ci` 和 `npm run build:devtools`，保留 `.devtools-dist`；服务端安装 `backend/requirements-devtools.txt`。
- 服务端填写完整 `DEVTOOLS_*` 环境配置，并挂载允许名单文件；设置资产目录为私有构建目录的实际绝对路径。
- 在 `backend` 启动：`uvicorn dev.badge_lab:create_app --factory --host 0.0.0.0 --port $PORT --no-access-log`。通过平台 HTTPS 入口访问，Host 必须与 `DEVTOOLS_ORIGIN` 相符。
- 关闭普通 access log 是为了避免把 OAuth callback 的短期 code/state 放入 URL 日志；应用自行记录经过哈希处理的操作者、请求路径、方法和结果，不记录密码、令牌、cookie 或查询参数。
- 目前会话、测试库和模拟时间保存在内存中，部署**一个 worker/实例**。重启即清空，不能直接横向扩容；将来如需持久化/多实例，应接入独立的开发会话库和数据库，不能复用正式连接或凭据。

## 撤权与会话

- 每个受保护请求都会重新读取允许名单。删除用户、设 `enabled:false` 或移除某项权限，会对后续请求生效，不必等待旧 cookie/token 到期。
- 名单文件丢失或格式错误时，拒绝访问，不回退为允许。推荐先写临时文件，再原子替换名单，避免更新期间短暂的 JSON 读取错误。
- Auth0 token 只放服务端。浏览器获得 HttpOnly、SameSite=Lax 的不透明 cookie；HTTPS 环境附加 Secure。开发会话最长 15 分钟，且不超过 Auth0 token 剩余寿命；注销后旧 cookie 失效。
- POST/PATCH/PUT/DELETE 还需要精确匹配的 Origin 和会话绑定的 CSRF capability，单独复制前端 token 或伪造角色请求头不能调用接口。
- Auth0 角色变更不会改写已经签发的 JWT。需要立即撤权时必须更新服务端允许名单；只修改 Auth0 角色可能要等旧会话到期。
- 已下载到获准用户电脑上的源码或资源无法被“收回”。拥有源码且能改动自己电脑的人可以运行自己的副本；这里保护的是项目托管的开发服务、接口与数据。

## 测试数据与正式环境隔离

- 正式应用仍为 `uvicorn app.main:app`，不导入开发模块、注册开发路由或接受开发会话。正式前端仍由普通 `npm run build` 产生 `dist/`。
- 新 Authlib 等依赖放在 `requirements-devtools.txt`，不进入正式应用的依赖入口。
- 私有构建固定使用同源 `/__badge_lab_api`，不读取 `.env.local` 中的正式 API 地址。操作者真实登录后，页面内部的测试用户仍可模拟。
- 模拟器新建 `mongomock.MongoClient`，忽略任何 `MONGODB_URI`；不连接生产 MongoDB。各开发者映射到不同测试用户和不同模拟时钟。重置只删除自己的测试记录，不清空其他 contributor 的记录。
- 距离、精度、最低时长和每日限制继续复用正式规则。快进只影响测试时钟，不影响授权会话的真实有效期。
- 正式构建包含发布检查：发现模拟器入口、测试身份或测试 API 字符串时立即失败。`.devtools-dist` 与 `dist` 分开；旧版免登录构建/启动配置直接拒绝运行。

## 验证命令

```powershell
cd backend
.venv/Scripts/python.exe -m pytest -q
cd ../frontend
npm test
npm run build
npm run build:devtools
```

只安装正式依赖时，Authlib 专用测试会跳过。完整 CI/开发验证应安装 `requirements-devtools.txt`。测试使用本地签名密钥、模拟 Auth0 discovery/token/JWKS 服务和临时允许名单；不创建真实 Auth0 用户、不发送真实登录凭据、不写生产数据。
