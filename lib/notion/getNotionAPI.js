import { NotionAPI as NotionLibrary } from 'notion-client'
import BLOG from '@/blog.config'
import path from 'path'
import { RateLimiter } from './RateLimiter'
import { getTenantId, getAPIHeaders, useWorkerAPI } from '@/lib/api/multi-tenant'

// 限流配置，打包编译阶段避免接口频繁，限制频率
const useRateLimiter = process.env.BUILD_MODE || process.env.EXPORT
const lockFilePath = path.resolve(process.cwd(), '.notion-api-lock')
const rateLimiter = new RateLimiter(200, lockFilePath)

const globalStore = { notion: null, inflight: new Map() }

/**
 * 获取 API 基础 URL
 * 如果启用自定义 API，使用 Worker API，否则使用 Notion API
 */
function getAPIBaseUrl() {
  if (BLOG.USE_CUSTOM_API && BLOG.CUSTOM_API_BASE_URL) {
    return BLOG.CUSTOM_API_BASE_URL
  }
  return BLOG.API_BASE_URL || 'https://www.notion.so/api/v3'
}

function getRawNotion() {
  if (!globalStore.notion) {
    const apiBaseUrl = getAPIBaseUrl()
    
    globalStore.notion = new NotionLibrary({
      apiBaseUrl,
      activeUser: BLOG.NOTION_ACTIVE_USER || null,
      authToken: BLOG.NOTION_TOKEN_V2 || null,
      userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      kyOptions: {
        mode: 'cors',
        hooks: {
          beforeRequest: [
            (request) => {
              // 多租户模式：添加租户信息到请求头
              if (useWorkerAPI()) {
                const tenantId = getTenantId()
                request.headers.set('X-Tenant-ID', tenantId)
                
                // 添加 API Key（如果配置）
                if (process.env.NEXT_PUBLIC_API_KEY) {
                  request.headers.set('X-API-Key', process.env.NEXT_PUBLIC_API_KEY)
                }
              }
              
              // 处理 URL 参数中的租户信息
              if (typeof window !== 'undefined') {
                const urlParams = new URLSearchParams(window.location.search)
                const tenant = urlParams.get('_tenant')
                if (tenant) {
                  request.headers.set('X-Tenant-ID', tenant)
                }
              }
              
              const url = request.url.toString()
              if (url.includes('/api/v3/syncRecordValues')) {
                return new Request(
                  url.replace('/api/v3/syncRecordValues', '/api/v3/syncRecordValuesMain'),
                  request
                )
              }
              return request
            }
          ]
        }
      }
    })
  }
  return globalStore.notion
}

async function callNotion(methodName, ...args) {
  const notion = getRawNotion()
  const original = notion[methodName]
  if (typeof original !== 'function') throw new Error(`${methodName} is not a function`)

  const key = `${methodName}-${JSON.stringify(args)}`

  if (globalStore.inflight.has(key)) return globalStore.inflight.get(key)

  const execute = async () => original.apply(notion, args)
  const promise = useRateLimiter
    ? rateLimiter.enqueue(key, execute)
    : execute()

  globalStore.inflight.set(key, promise)
  promise.finally(() => globalStore.inflight.delete(key))
  return promise
}

export const notionAPI = {
  getPage: (...args) => callNotion('getPage', ...args),
  getBlocks: (...args) => callNotion('getBlocks', ...args),
  getUsers: (...args) => callNotion('getUsers', ...args),
  __call: callNotion
}

export default notionAPI
