# 多租户部署指南

## 📋 架构说明

### 传统单租户模式
```
前端 (Cloudflare Pages) 
  ↓
直接连接 Notion API
```

### 新多租户模式
```
前端 (Cloudflare Pages)
  ↓
Worker API (Cloudflare Workers)
  ↓
D1 Database (存储租户配置)
  ↓
Notion API (按租户配置访问)
```

---

## 🚀 部署配置

### **方式 1: 单租户部署（传统模式）**

适用于：只有一个博客站点，不需要多租户功能

#### Cloudflare Pages 环境变量：
```bash
# 必需
NOTION_PAGE_ID=你的Notion页面ID

# 可选
NEXT_PUBLIC_THEME=heo
NEXT_PUBLIC_LANG=zh-CN
```

#### 特点：
- ✅ 配置简单
- ✅ 直连 Notion，延迟低
- ❌ 不支持多站点
- ❌ 每个站点需要单独部署

---

### **方式 2: 多租户部署（推荐）**

适用于：需要托管多个博客站点，共享一个前端部署

#### 前端 Cloudflare Pages 环境变量：
```bash
# 必需：启用 Worker API
NEXT_PUBLIC_USE_CUSTOM_API=true
NEXT_PUBLIC_WORKER_API=https://notionnext-api.YOUR_USERNAME.workers.dev

# 可选：固定租户模式（部署多个前端实例，每个指向不同租户）
NEXT_PUBLIC_TENANT_ID=tenant-123

# 可选：API 认证
NEXT_PUBLIC_API_KEY=your-secret-key

# 传统配置（向后兼容，降级使用）
NEXT_PUBLIC_THEME=heo
NEXT_PUBLIC_LANG=zh-CN
```

#### 后端 Worker 绑定配置：
已在 `wrangler.toml` 配置，在 Cloudflare Dashboard 绑定：

1. **D1 Database**: `notionnext-db`
2. **KV Namespace**: `notionnext-cache` 
3. **R2 Bucket**: `notionnext-storage`

#### 租户访问方式：

##### A. 子域名模式（最简单）
```
tenant1.yourdomain.com → 租户 1
tenant2.yourdomain.com → 租户 2
blog.yourdomain.com    → 租户 3
```

前端会自动从子域名识别租户 ID，Worker 查询对应配置。

**设置步骤：**
1. 添加 DNS 记录：`*.yourdomain.com` → Cloudflare Pages
2. 在 Worker D1 添加租户：
```sql
INSERT INTO tenants (id, subdomain, notion_page_id, status)
VALUES ('tenant1', 'tenant1', 'notion-page-id-1', 'active');
```

##### B. 自定义域名模式
```
blog1.com → 租户 1
blog2.com → 租户 2
```

**设置步骤：**
1. 添加 DNS 记录指向 Cloudflare Pages
2. 在 Worker D1 添加租户：
```sql
INSERT INTO tenants (id, custom_domain, notion_page_id, status)
VALUES ('tenant1', 'blog1.com', 'notion-page-id-1', 'active');
```

##### C. 固定租户模式（单租户多部署）
适合为每个客户独立部署前端，但共享后端。

```bash
# 客户 A 的前端部署
NEXT_PUBLIC_TENANT_ID=customer-a

# 客户 B 的前端部署  
NEXT_PUBLIC_TENANT_ID=customer-b
```

---

## 🔧 租户管理

### 通过 D1 Console 管理

#### 1. 创建租户
```sql
INSERT INTO tenants (
  id, name, subdomain, notion_page_id, 
  theme, status, created_at
) VALUES (
  'my-blog',           -- 租户 ID
  'My Blog',           -- 显示名称
  'myblog',            -- 子域名（myblog.yourdomain.com）
  'YOUR_NOTION_PAGE_ID', -- Notion 页面 ID
  'heo',               -- 主题
  'active',            -- 状态
  strftime('%s', 'now') * 1000 -- 创建时间
);
```

#### 2. 查询租户
```sql
SELECT * FROM tenants WHERE subdomain = 'myblog';
SELECT * FROM tenants WHERE custom_domain = 'blog.com';
```

#### 3. 更新租户配置
```sql
UPDATE tenants 
SET notion_page_id = 'new-page-id', 
    theme = 'gitbook'
WHERE id = 'my-blog';
```

#### 4. 停用租户
```sql
UPDATE tenants SET status = 'inactive' WHERE id = 'my-blog';
```

### 通过 API 管理（TODO: 后台管理界面）

```bash
# 获取租户列表
curl https://notionnext-api.workers.dev/api/tenants

# 创建租户
curl -X POST https://notionnext-api.workers.dev/api/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-blog",
    "name": "My Blog",
    "subdomain": "myblog",
    "notion_page_id": "YOUR_PAGE_ID"
  }'

# 获取租户详情
curl https://notionnext-api.workers.dev/api/tenants/my-blog
```

---

## 🎯 部署步骤总结

### 1. 部署后端 Worker

```bash
cd worker
git push origin main
```

Cloudflare Pages 自动部署，然后：
1. 在 Dashboard 创建 D1 数据库
2. 执行 `schema.sql` 初始化表结构
3. 在 Worker 设置中绑定 D1/KV/R2
4. 记录 Worker URL

### 2. 部署前端

#### 单租户模式：
```bash
cd NotionNext-main
# 在 Cloudflare Pages 设置环境变量
NOTION_PAGE_ID=你的页面ID
# 推送代码，自动部署
git push origin main
```

#### 多租户模式：
```bash
cd NotionNext-main
# 在 Cloudflare Pages 设置环境变量
NEXT_PUBLIC_USE_CUSTOM_API=true
NEXT_PUBLIC_WORKER_API=https://你的worker.workers.dev
# 推送代码，自动部署
git push origin main
```

### 3. 添加租户数据

在 Cloudflare Dashboard → D1 → Console：
```sql
INSERT INTO tenants (id, name, subdomain, notion_page_id, status, created_at)
VALUES ('default', 'Default Blog', 'www', 'YOUR_NOTION_PAGE_ID', 'active', strftime('%s', 'now') * 1000);
```

### 4. 配置域名

- DNS: `*.yourdomain.com` → Cloudflare Pages
- 或: `blog.com` → Cloudflare Pages

---

## 🔍 验证部署

### 1. 检查 Worker
```bash
curl https://your-worker.workers.dev/health
# 应返回: {"status":"ok","timestamp":1699999999999}
```

### 2. 检查租户配置
```bash
curl https://your-worker.workers.dev/api/tenants/default
# 应返回租户信息
```

### 3. 检查前端
访问: `https://your-site.pages.dev`

浏览器控制台检查：
- Network 面板查看 API 请求是否指向 Worker
- 应该看到 `X-Tenant-ID` header

---

## 💡 常见问题

### Q: 为什么还需要 NOTION_PAGE_ID？
**A:** 作为降级方案。如果 Worker API 不可用，前端会降级到直连 Notion。

### Q: 能否混合模式？
**A:** 可以！部分租户用 Worker，部分直连 Notion。在 `USE_CUSTOM_API` 中按需切换。

### Q: 如何实现租户隔离？
**A:** Worker 通过 D1 查询租户配置，确保每个租户只能访问自己的 Notion 数据。

### Q: 性能如何？
**A:** Worker 边缘计算 + D1 查询 < 5ms，加上 KV 缓存，总延迟增加 < 10ms。

---

## 📚 后续优化

- [ ] 管理后台界面（租户自助管理）
- [ ] 租户级别缓存策略
- [ ] 使用量统计和限流
- [ ] 自动备份租户数据
- [ ] Webhook 支持（Notion 更新通知）
