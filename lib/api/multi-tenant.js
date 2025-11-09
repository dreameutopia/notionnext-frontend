/**
 * 多租户 API 适配层
 * 根据配置决定是使用 Worker API 还是直接连接 Notion
 */

import BLOG from '@/blog.config'

/**
 * 从当前环境获取租户 ID
 * 支持: 子域名、自定义域名、环境变量
 */
export function getTenantId() {
  // 1. 从环境变量获取固定租户 ID（用于单租户部署）
  if (process.env.NEXT_PUBLIC_TENANT_ID) {
    return process.env.NEXT_PUBLIC_TENANT_ID
  }

  // 2. 从域名/子域名识别
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    const parts = hostname.split('.')

    // 子域名模式: tenant.yourdomain.com
    if (parts.length >= 3 && !['www', 'api', 'admin'].includes(parts[0])) {
      return parts[0]
    }

    // 自定义域名: 需要从 Worker API 查询
    // 这里返回域名，由 Worker 处理映射
    return hostname
  }

  // 3. 服务端渲染时默认租户
  return 'default'
}

/**
 * 获取 Worker API 基础 URL
 */
export function getWorkerAPIUrl() {
  return BLOG.CUSTOM_API_BASE_URL || process.env.NEXT_PUBLIC_WORKER_API || 'https://www.notion.so/api/v3'
}

/**
 * 是否使用 Worker API
 */
export function useWorkerAPI() {
  return BLOG.USE_CUSTOM_API === true
}

/**
 * 构建 API 请求头
 */
export function getAPIHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  }

  if (useWorkerAPI()) {
    const tenantId = getTenantId()
    headers['X-Tenant-ID'] = tenantId

    // 如果配置了 API Key
    if (process.env.NEXT_PUBLIC_API_KEY) {
      headers['X-API-Key'] = process.env.NEXT_PUBLIC_API_KEY
    }
  }

  return headers
}

/**
 * 获取 Notion Page ID
 * 多租户模式下从 Worker 获取，单租户模式直接使用配置
 */
export async function getNotionPageId() {
  if (!useWorkerAPI()) {
    // 传统模式：直接使用配置的 Page ID
    return BLOG.NOTION_PAGE_ID
  }

  // 多租户模式：从 Worker API 获取当前租户的 Page ID
  try {
    const tenantId = getTenantId()
    const response = await fetch(`${getWorkerAPIUrl()}/api/tenants/${tenantId}`, {
      headers: getAPIHeaders()
    })

    if (!response.ok) {
      console.error('Failed to fetch tenant info:', response.statusText)
      return BLOG.NOTION_PAGE_ID // 降级到默认配置
    }

    const tenant = await response.json()
    return tenant.notion_page_id || BLOG.NOTION_PAGE_ID
  } catch (error) {
    console.error('Error fetching tenant page ID:', error)
    return BLOG.NOTION_PAGE_ID // 降级到默认配置
  }
}

/**
 * 代理 Notion API 请求到 Worker
 */
export async function proxyNotionAPI(endpoint, body) {
  const url = `${getWorkerAPIUrl()}${endpoint}`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAPIHeaders(),
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error(`Error calling ${endpoint}:`, error)
    throw error
  }
}
