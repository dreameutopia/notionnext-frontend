import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkStrIsNotionId, getLastPartOfUrl } from '@/lib/utils'
import { idToUuid } from 'notion-utils'
import BLOG from './blog.config'

/**
 * Clerk 身份验证中间件 + 多租户支持
 */
export const config = {
  // 这里设置白名单，防止静态资源被拦截
  matcher: ['/((?!.*\\..*|_next|/sign-in|/auth).*)', '/', '/(api|trpc)(.*)']
}

// 限制登录访问的路由
const isTenantRoute = createRouteMatcher([
  '/user/organization-selector(.*)',
  '/user/orgid/(.*)',
  '/dashboard',
  '/dashboard/(.*)'
])

// 限制权限访问的路由
const isTenantAdminRoute = createRouteMatcher([
  '/admin/(.*)/memberships',
  '/admin/(.*)/domain'
])

/**
 * 没有配置权限相关功能的返回
 * @param req
 * @param ev
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const noAuthMiddleware = async (req: NextRequest, ev: any) => {
  // ============================================
  // 多租户处理逻辑
  // ============================================
  const response = await handleMultiTenant(req)
  if (response) {
    return response
  }

  // 如果没有配置 Clerk 相关环境变量，返回一个默认响应或者继续处理请求
  if (BLOG['UUID_REDIRECT']) {
    let redirectJson: Record<string, string> = {}
    try {
      const response = await fetch(`${req.nextUrl.origin}/redirect.json`)
      if (response.ok) {
        redirectJson = (await response.json()) as Record<string, string>
      }
    } catch (err) {
      console.error('Error fetching static file:', err)
    }
    let lastPart = getLastPartOfUrl(req.nextUrl.pathname) as string
    if (checkStrIsNotionId(lastPart)) {
      lastPart = idToUuid(lastPart)
    }
    if (lastPart && redirectJson[lastPart]) {
      const redirectToUrl = req.nextUrl.clone()
      redirectToUrl.pathname = '/' + redirectJson[lastPart]
      console.log(
        `redirect from ${req.nextUrl.pathname} to ${redirectToUrl.pathname}`
      )
      return NextResponse.redirect(redirectToUrl, 308)
    }
  }
  return NextResponse.next()
}

/**
 * 多租户处理函数
 * 解析子域名并注入租户信息
 */
async function handleMultiTenant(req: NextRequest) {
  const hostname = req.headers.get('host') || ''
  const url = req.nextUrl.clone()
  
  // 跳过 API 路由
  if (url.pathname.startsWith('/api/')) {
    return null
  }
  
  let tenantId: string | null = null
  let subdomain: string | null = null
  
  // 从域名提取子域名
  const hostParts = hostname.split('.')
  const isLocalhost = hostname.includes('localhost') || hostname.includes('127.0.0.1')
  
  if (!isLocalhost && hostParts.length >= 3 && hostParts[0]) {
    subdomain = hostParts[0]
    
    // 排除保留子域名
    const reserved = ['www', 'api', 'admin', 'blog', 'app']
    if (subdomain && !reserved.includes(subdomain)) {
      tenantId = subdomain
    }
  }
  
  // 注入租户信息
  if (tenantId || subdomain) {
    url.searchParams.set('_tenant', tenantId || 'default')
    url.searchParams.set('_subdomain', subdomain || '')
    
    // 获取租户配置并注入主题
    try {
      const workerAPI = process.env.NEXT_PUBLIC_WORKER_API
      if (workerAPI && tenantId) {
        const response = await fetch(`${workerAPI}/api/tenants/by-subdomain/${tenantId}`, {
          next: { revalidate: 60 },
        })
        
        if (response.ok) {
          const tenantConfig = await response.json()
          const theme = tenantConfig.theme || 'heo'
          const allowedThemes = ['heo', 'gitbook', 'typography']
          url.searchParams.set('_theme', allowedThemes.includes(theme) ? theme : 'heo')
        }
      }
    } catch (error) {
      console.error('[Middleware] Failed to fetch tenant config:', error)
    }
    
    return NextResponse.rewrite(url)
  }
  
  return null
}

/**
 * 鉴权中间件
 */
const authMiddleware = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware((auth, req) => {
      const { userId } = auth()
      // 处理 /dashboard 路由的登录保护
      if (isTenantRoute(req)) {
        if (!userId) {
          // 用户未登录，重定向到 /sign-in
          const url = new URL('/sign-in', req.url)
          url.searchParams.set('redirectTo', req.url) // 保存重定向目标
          return NextResponse.redirect(url)
        }
      }

      // 处理管理员相关权限保护
      if (isTenantAdminRoute(req)) {
        auth().protect(has => {
          return (
            has({ permission: 'org:sys_memberships:manage' }) ||
            has({ permission: 'org:sys_domains_manage' })
          )
        })
      }

      // 默认继续处理请求
      return NextResponse.next()
    })
  : noAuthMiddleware

export default authMiddleware
