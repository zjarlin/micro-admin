import { chromium } from 'playwright-core'

const base = process.env.APP_URL || 'http://127.0.0.1:5174'
const executablePath = process.env.CHROMIUM_BIN
if (!executablePath) throw new Error('CHROMIUM_BIN is required')

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(error.message))

const evidence = []
try {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '登录控制台' }).waitFor()
  evidence.push({ step: 'login-page', title: await page.title() })
  await page.screenshot({ path: '/tmp/micro-admin-login.png', fullPage: true })

  await page.getByRole('button', { name: /进入系统/ }).click()
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.locator('.hero h1').filter({ hasText: '超级管理员' }).waitFor({ timeout: 15000 })
  await page.locator('.metric-card').first().waitFor({ timeout: 15000 })
  await page.locator('.health-card').waitFor({ timeout: 15000 })
  await page.locator('.health-grid').waitFor({ timeout: 15000 })
  await page.locator('.el-table__body tbody tr .el-tag').first().waitFor({ timeout: 15000 })
  if ((await page.locator('body').innerText()).includes('[object Promise]')) throw new Error('slot component resolved as a Promise')
  evidence.push({ step: 'logged-in', url: page.url(), heading: await page.locator('.hero h1').innerText() })

  const sidebar = page.locator('nav[aria-label="主导航"]')
  await sidebar.getByText('系统管理', { exact: true }).waitFor()
  evidence.push({ step: 'plugin-menus', menus: await sidebar.locator('a.menu-item').count() })
  await page.screenshot({ path: '/tmp/micro-admin-dashboard.png', fullPage: true })

  await sidebar.getByRole('link', { name: '用户管理' }).click()
  await page.waitForURL('**/system/user')
  await page.getByRole('heading', { name: '用户管理' }).waitFor()
  await page.getByRole('button', { name: /新增用户/ }).click()
  const dialog = page.locator('.el-dialog')
  await dialog.getByPlaceholder('登录账号').fill('e2e_user')
  await dialog.getByPlaceholder('显示名称').fill('端上验收用户')
  await dialog.getByPlaceholder('name@example.com').fill('e2e@example.com')
  await dialog.getByRole('button', { name: '保存' }).click()
  await page.getByText('用户已创建').waitFor({ timeout: 10000 })
  await page.getByPlaceholder('搜索用户名或昵称').fill('e2e_user')
  await page.getByRole('button', { name: '查询' }).click()
  await page.getByText('端上验收用户').waitFor({ timeout: 10000 })
  evidence.push({ step: 'user-created', rows: await page.locator('.el-table__body tbody tr').count() })
  await page.screenshot({ path: '/tmp/micro-admin-users.png', fullPage: true })

  await sidebar.getByRole('link', { name: '插件中心' }).click()
  await page.waitForURL('**/plugins')
  await page.getByRole('heading', { name: '插件中心' }).waitFor()
  evidence.push({ step: 'plugin-center', topology: await page.locator('.topology code').allInnerTexts() })
  await page.screenshot({ path: '/tmp/micro-admin-plugins.png', fullPage: true })

  const businessPages = [
    ['/system/role', '角色管理'],
    ['/system/menu', '菜单管理'],
    ['/system/dept', '部门管理'],
    ['/system/post', '岗位管理'],
    ['/system/dict', '字典管理'],
    ['/system/config', '参数设置'],
    ['/system/notice', '通知公告'],
    ['/monitor/online', '在线用户'],
    ['/monitor/job', '定时任务'],
    ['/monitor/server', '服务监控'],
    ['/monitor/cache', '缓存监控'],
    ['/profile', '个人中心'],
    ['/p/demo.device', '设备台账'],
  ]
  for (const [path, title] of businessPages) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: title, exact: true }).waitFor({ timeout: 15000 })
  }
  evidence.push({ step: 'all-business-pages', count: businessPages.length + 2 })

  await page.locator('.user-chip').click()
  await page.getByText('退出登录').click()
  await page.getByRole('button', { name: '退出' }).click()
  await page.waitForURL('**/login')
  evidence.push({ step: 'logged-out', url: page.url() })

  await page.getByRole('button', { name: /auditor/ }).click()
  await page.getByRole('button', { name: /进入系统/ }).click()
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.locator('.hero h1').filter({ hasText: '审计员' }).waitFor({ timeout: 15000 })
  await page.locator('.metric-card').first().waitFor({ timeout: 15000 })
  const limitedMenus = await sidebar.locator('a.menu-item').allInnerTexts()
  evidence.push({ step: 'auditor-permissions', menus: limitedMenus.map((text) => text.trim()) })
  if (limitedMenus.some((text) => text.includes('菜单管理'))) throw new Error('auditor must not see menu management')

  await page.goto(`${base}/system/menu`, { waitUntil: 'networkidle' })
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  evidence.push({ step: 'auditor-route-guard', url: page.url() })
  await page.screenshot({ path: '/tmp/micro-admin-auditor.png', fullPage: true })

  if (errors.length > 0) throw new Error(`browser console errors: ${errors.join(' | ')}`)
  console.log(JSON.stringify({ ok: true, evidence }, null, 2))
} finally {
  await browser.close()
}
