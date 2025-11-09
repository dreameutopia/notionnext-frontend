# 完整部署指南：NotionNext + Cloudflare Worker 多租户方案

本指南将帮助你完整部署基于 Cloudflare Worker + D1 数据库的多租户 NotionNext 博客系统。

## 目录

1. [系统架构](#系统架构)
2. [前置要求](#前置要求)
3. [后端部署（Cloudflare Worker）](#后端部署)
4. [前端部署（Vercel/Cloudflare Pages）](#前端部署)
5. [数据迁移](#数据迁移)
6. [多租户配置](#多租户配置)
7. [域名配置](#域名配置)
8. [常见问题](#常见问题)

---

## 系统架构

```
用户浏览器
    │
    ↓
子域名解析 (blog1.yourdomain.com)
    │
    ↓
Next.js 前端 (Vercel/CF Pages)
    │  └─ Middleware: 解析租户
    │  └─ 主题限制: heo/gitbook/typography
    │
    ↓
Cloudflare Worker API
    │  └─ Notion API 兼容层
    │  └─ 多租户管理 API
    │  └─ 内容管理 API
    │
    ↓
Cloudflare D1 数据库
    │  └─ blocks, collections, tenants 表
    │
    └─ R2 存储桶 (文件/图片)
```

---

## 前置要求

### 必需

- Cloudflare 账号（免费版即可）
- Node.js 18+
- Git
- Vercel/Cloudflare Pages 账号（前端部署）

### 可选

- 自定义域名
- Notion 账号（用于数据导入）

---

## 后端部署

### 第一步：安装 Wrangler CLI

```bash
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

### 第二步：创建 D1 数据库

```bash
cd worker

# 生产环境
wrangler d1 create notionnext-db

# 复制输出的 database_id，更新 wrangler.toml
```

输出示例：
```
✅ Successfully created DB 'notionnext-db'
database_id = "xxxx-xxxx-xxxx-xxxx"
```

更新 `worker/wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "notionnext-db"
database_id = "你的database_id"  # 替换这里
```

### 第三步：初始化数据库

```bash
# 执行 schema.sql
wrangler d1 execute notionnext-db --file=./schema.sql
```

### 第四步：创建 KV 和 R2

```bash
# KV 命名空间（缓存）
wrangler kv:namespace create CACHE

# R2 存储桶（文件存储）
wrangler r2 bucket create notionnext-storage
```

更新 `wrangler.toml` 中的 KV ID。

### 第五步：安装依赖并部署

```bash
npm install

# 本地测试
npm run dev

# 部署到生产环境
npm run deploy
```

部署成功后，你会得到一个 Worker URL：
```
https://notionnext-api-worker.your-account.workers.dev
```

### 第六步：创建测试租户

```bash
curl -X POST https://your-worker-url/api/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "demo",
    "title": "Demo Blog",
    "description": "My demo blog",
    "author": "Your Name",
    "theme": "heo"
  }'
```

---

## 前端部署

### 方式一：Vercel 部署（推荐）

#### 1. 配置环境变量

在 Vercel 项目设置中添加：

```bash
NEXT_PUBLIC_USE_CUSTOM_API=true
NEXT_PUBLIC_WORKER_API=https://your-worker-url
NEXT_PUBLIC_THEME=heo
```

#### 2. 连接 GitHub 仓库

1. 访问 [Vercel Dashboard](https://vercel.com/dashboard)
2. Import Git Repository
3. 选择你的 NotionNext 仓库
4. Deploy

#### 3. 配置自定义域名

在 Vercel 项目设置中添加域名：
- `yourdomain.com` (主站)
- `*.yourdomain.com` (泛域名，支持子域名)

**注意**：泛域名需要 Vercel Pro 计划。

### 方式二：Cloudflare Pages 部署

#### 1. 构建配置

在 Cloudflare Pages 中设置：

```bash
Build command: npm run build
Build output directory: .next
Root directory: /

Environment variables:
  NEXT_PUBLIC_USE_CUSTOM_API=true
  NEXT_PUBLIC_WORKER_API=https://your-worker-url
  NEXT_PUBLIC_THEME=heo
```

#### 2. 添加 Worker 路由

为了支持子域名路由，需要创建一个额外的 Worker：

```javascript
// pages/_middleware.js
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const hostname = url.hostname;
  
  // 提取子域名
  const parts = hostname.split('.');
  if (parts.length >= 3) {
    const subdomain = parts[0];
    url.searchParams.set('_tenant', subdomain);
  }
  
  return context.next(url);
}
```

---

## 数据迁移

### 从现有 Notion 数据库导入

#### 1. 获取 Notion 页面 ID

从 Notion 页面 URL 中获取 ID：
```
https://www.notion.so/username/Page-Title-02ab3b8678004aa69e9e415905ef32a5
                                             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                       这就是 Page ID
```

#### 2. 运行迁移脚本

```bash
# 设置环境变量
export WORKER_API=https://your-worker-url
export NOTION_TOKEN_V2=your_token  # 可选

# 运行迁移
node scripts/migrate-notion-to-d1.js \
  --tenant-id=demo \
  --notion-id=02ab3b8678004aa69e9e415905ef32a5
```

#### 3. 验证导入

```bash
# 查询租户数据
curl https://your-worker-url/api/tenants/by-subdomain/demo

# 获取页面数据
curl -X POST https://your-worker-url/getPage \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: demo" \
  -d '{"pageId": "root-page-id"}'
```

---

## 多租户配置

### 创建新租户

```bash
curl -X POST https://your-worker-url/api/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "blog1",
    "custom_domain": "blog1.example.com",
    "title": "Blog 1",
    "description": "First blog",
    "author": "Author 1",
    "theme": "heo",
    "config": {
      "LANG": "zh-CN",
      "POSTS_PER_PAGE": 10
    }
  }'
```

### 访问租户博客

- 子域名访问：`https://blog1.yourdomain.com`
- 自定义域名访问：`https://blog1.example.com`

### 更新租户配置

```bash
curl -X PUT https://your-worker-url/api/tenants/{tenant-id} \
  -H "Content-Type: application/json" \
  -d '{
    "theme": "gitbook",
    "title": "Updated Title"
  }'
```

### 删除租户（软删除）

```bash
curl -X DELETE https://your-worker-url/api/tenants/{tenant-id}
```

---

## 域名配置

### DNS 配置

#### 主域名

添加 A/CNAME 记录：
```
yourdomain.com -> Vercel/Cloudflare Pages
```

#### 泛域名（子域名支持）

添加通配符记录：
```
*.yourdomain.com -> Vercel/Cloudflare Pages
```

#### 自定义域名

租户可以配置自定义域名，在他们的 DNS 中添加：
```
blog.example.com -> CNAME -> your-domain.com
```

然后在租户配置中设置 `custom_domain`。

### Cloudflare DNS 示例

```
Type    Name                  Content
A       @                     76.76.21.21 (Vercel IP)
CNAME   *                     your-domain.com
CNAME   www                   your-domain.com
```

---

## 主题限制

系统已配置为只允许三个主题：

1. **heo** (默认)
2. **gitbook**
3. **typography**

### 如何修改允许的主题

编辑 `blog.config.js`:

```javascript
ALLOWED_THEMES: ['heo', 'gitbook', 'typography', 'hexo'], // 添加更多主题
ENABLE_THEME_SWITCH: true, // 启用/禁用主题切换
```

---

## API 端点说明

### Notion API 兼容端点

```bash
# 获取页面
POST /getPage
Body: { "pageId": "xxx" }

# 获取多个 blocks
POST /getBlocks
Body: { "blockIds": ["id1", "id2"] }

# 查询数据库
POST /queryCollection
Body: { "collectionId": "xxx", "collectionViewId": "xxx" }
```

### 租户管理 API

```bash
# 列出租户
GET /api/tenants?status=active&limit=50

# 创建租户
POST /api/tenants
Body: { "subdomain": "xxx", "title": "xxx", ... }

# 获取租户
GET /api/tenants/:id
GET /api/tenants/by-subdomain/:subdomain
GET /api/tenants/by-domain/:domain

# 更新租户
PUT /api/tenants/:id
Body: { "theme": "heo", ... }

# 删除租户
DELETE /api/tenants/:id
```

### 内容管理 API

```bash
# Blocks
POST /api/blocks
GET /api/blocks/:id
PUT /api/blocks/:id
DELETE /api/blocks/:id
GET /api/blocks/tenant/:tenantId

# Collections
POST /api/collections
GET /api/collections/:id
PUT /api/collections/:id
DELETE /api/collections/:id

# 导入
POST /api/import/notion
Body: { "tenant_id": "xxx", "notion_page_id": "xxx" }
```

---

## 常见问题

### Q1: Worker 部署后访问 404

**A**: 检查 `wrangler.toml` 中的路由配置，确保绑定正确。

### Q2: 数据库查询失败

**A**: 确认 D1 数据库已初始化：
```bash
wrangler d1 execute notionnext-db --command="SELECT * FROM tenants"
```

### Q3: 子域名无法访问

**A**: 
1. 确认 DNS 泛域名配置正确
2. Vercel 需要 Pro 计划支持泛域名
3. 检查中间件是否正确解析子域名

### Q4: 主题切换不生效

**A**: 检查 `blog.config.js` 中的 `ALLOWED_THEMES` 和 `ENABLE_THEME_SWITCH` 配置。

### Q5: 数据导入失败

**A**: 
1. 确认 Notion 页面是公开的或提供了 `token_v2`
2. 检查 Worker API 是否可访问
3. 查看迁移脚本的错误日志

### Q6: 图片无法显示

**A**: 
1. 确认 R2 存储桶已创建并绑定
2. 检查图片 URL 是否正确
3. Notion 图片可能需要重新上传到 R2

---

## 性能优化建议

### 1. 启用缓存

```javascript
// 在 Worker 中使用 KV 缓存
const cached = await env.CACHE.get(cacheKey)
if (cached) return JSON.parse(cached)

// 缓存结果
await env.CACHE.put(cacheKey, JSON.stringify(data), {
  expirationTtl: 3600 // 1小时
})
```

### 2. CDN 配置

在 Cloudflare 中启用：
- 自动缓存静态资源
- 图片优化
- Brotli 压缩

### 3. 数据库索引

schema.sql 已包含必要的索引，如需优化可添加：
```sql
CREATE INDEX idx_blocks_tenant_type ON blocks(tenant_id, type);
```

---

## 监控和日志

### 查看 Worker 日志

```bash
wrangler tail
```

### 查看 D1 数据库统计

```bash
wrangler d1 execute notionnext-db --command="
  SELECT 
    COUNT(*) as total_blocks,
    type,
    tenant_id
  FROM blocks 
  WHERE alive = 1
  GROUP BY type, tenant_id
"
```

### 活动日志

访问数据库查看操作记录：
```bash
wrangler d1 execute notionnext-db --command="
  SELECT * FROM activity_logs 
  ORDER BY created_at DESC 
  LIMIT 50
"
```

---

## 备份和恢复

### 备份数据库

```bash
wrangler d1 export notionnext-db --output=backup-$(date +%Y%m%d).sql
```

### 恢复数据库

```bash
wrangler d1 execute notionnext-db --file=backup-20241110.sql
```

---

## 升级指南

### 更新 Worker

```bash
cd worker
git pull
npm install
npm run deploy
```

### 更新前端

```bash
git pull
# Vercel 会自动重新部署
# 或手动触发部署
```

### 数据库迁移

如有新的数据库字段或表：
```bash
wrangler d1 execute notionnext-db --file=migrations/001_add_field.sql
```

---

## 支持与反馈

如遇到问题，请检查：
1. [GitHub Issues](https://github.com/tangly1024/NotionNext/issues)
2. [Worker 文档](./worker/README.md)
3. Cloudflare D1 文档

---

## 总结

通过以上配置，你已经拥有了：

✅ 完整的多租户博客系统  
✅ Notion API 兼容的自建后端  
✅ 三个精选主题（heo/gitbook/typography）  
✅ 灵活的子域名支持  
✅ 可扩展的数据库架构  
✅ 高性能的 CDN 分发  

享受你的博客系统吧！🎉
