import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import { randomBytes, randomUUID } from 'node:crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
import session from 'express-session'
import { initializeDatabase, readDatabase, updateDatabase } from './store.js'

const app = express()
const port = Number(process.env.PORT) || 4000
const sessionSecret = process.env.SESSION_SECRET || randomBytes(48).toString('hex')
const allowedOrigin = process.env.APP_ORIGIN || 'http://localhost:5173'

app.disable('x-powered-by')
app.use(cors({ origin: allowedOrigin, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(session({
  name: 'yemzor.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  },
}))

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Ro‘yxatdan o‘tish urinishlari ko‘payib ketdi. Birozdan keyin qayta urinib ko‘ring.' },
})

function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode })
}

function normalizeLogin(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US') : ''
}

function validateEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US') : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, 'To‘g‘ri email manzilini kiriting.')
  }
  return email
}

function validateLogin(value) {
  const login = normalizeLogin(value)
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) fail(400, 'Login 3–40 ta belgi bo‘lsin; lotin harfi, raqam, nuqta, chiziqcha ishlating.')
  return login
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 200) {
    fail(400, 'Parol kamida 10 ta belgidan iborat bo‘lishi kerak.')
  }
}

function validateName(value, label = 'Ism') {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name.length < 2 || name.length > 80) fail(400, `${label} 2–80 ta belgi orasida bo‘lishi kerak.`)
  return name
}

function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    fail(400, 'Sanani YYYY-MM-DD shaklida kiriting.')
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(400, 'Sanani tekshiring.')
  return value
}

function positiveAmount(value, label = 'Summa') {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount <= 0) fail(400, `${label} musbat butun so‘m bo‘lishi kerak.`)
  return amount
}

function currentBillingPeriod() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

function subscriptionStatus(database, company, period = currentBillingPeriod()) {
  const currentRate = database.subscriptionRates.find((item) => item.companyId === company.id && item.period === period) || null
  const dueBefore = database.subscriptionRates
    .filter((item) => item.companyId === company.id && item.period < period)
    .reduce((sum, item) => sum + item.amount, 0)
  const dueThroughPeriod = database.subscriptionRates
    .filter((item) => item.companyId === company.id && item.period <= period)
    .reduce((sum, item) => sum + item.amount, 0)
  const paidThroughPeriod = database.subscriptions
    .filter((item) => item.companyId === company.id && item.period <= period)
    .reduce((sum, item) => sum + item.amount, 0)
  const paidAmount = currentRate
    ? Math.min(currentRate.amount, Math.max(paidThroughPeriod - dueBefore, 0))
    : 0
  return {
    period,
    requiredAmount: currentRate?.amount || 0,
    paidAmount,
    creditBalance: Math.max(paidThroughPeriod - dueThroughPeriod, 0),
    paidAt: database.subscriptions
      .filter((item) => item.companyId === company.id && item.period <= period)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0]?.paidAt || null,
    active: Boolean(currentRate && currentRate.amount > 0 && paidThroughPeriod >= dueThroughPeriod),
    amountConfigured: Boolean(currentRate && currentRate.amount > 0),
  }
}

function companyAccessStatus(database, company) {
  if (!company.isDemo) return subscriptionStatus(database, company)
  const expiresAt = company.demoExpiresAt
  const remainingMs = new Date(expiresAt).getTime() - Date.now()
  return {
    active: Number.isFinite(remainingMs) && remainingMs > 0,
    demo: true,
    expiresAt,
    remainingMs: Math.max(remainingMs, 0),
    expired: !Number.isFinite(remainingMs) || remainingMs <= 0,
  }
}

function requirePaidSubscription(request, _response, next) {
  try {
    const database = readDatabase()
    const company = requireCompany(request, database)
    const access = companyAccessStatus(database, company)
    if (!access.active) {
      return next(Object.assign(new Error(company.isDemo
        ? 'Demo muddati tugadi. Yangi demo uchun boshqa email bilan ro‘yxatdan o‘ting.'
        : 'Joriy oy uchun obuna to‘lovi tasdiqlanishi kerak.'), {
        statusCode: 423,
        subscription: access,
        companyName: company.name,
      }))
    }
    next()
  } catch (error) {
    next(error)
  }
}

function validatePhone(value) {
  if (typeof value !== 'string') fail(400, 'Telefon raqamini matn shaklida yuboring.')
  const phone = value.trim()
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (!/^[+()\d -]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    fail(400, 'Telefon raqamini tekshiring: 7–15 ta raqam kiriting.')
  }
  return phone
}

function findUniqueLogin(database, login) {
  return database.users.some((user) => user.login === login)
}

function currentUser(request) {
  if (!request.session.userId) return null
  const user = readDatabase().users.find((entry) => entry.id === request.session.userId && entry.active)
  if (user) request.user = user
  return user || null
}

function requireAuth(request, _response, next) {
  if (!currentUser(request)) return next(Object.assign(new Error('Avval tizimga kiring.'), { statusCode: 401 }))
  next()
}

function requirePlatformAdmin(request, _response, next) {
  if (request.user?.role !== 'platform_admin') return next(Object.assign(new Error('Bu amal faqat platforma egasiga ruxsat etilgan.'), { statusCode: 403 }))
  next()
}

function requireCompanyUser(request, _response, next) {
  if (!['company_owner', 'employee'].includes(request.user?.role)) {
    return next(Object.assign(new Error('Bu amal do‘kon akkaunti uchun.'), { statusCode: 403 }))
  }
  next()
}

function requireCompanyOwner(request, _response, next) {
  if (request.user?.role !== 'company_owner') {
    return next(Object.assign(new Error('Bu amal faqat do‘kon boshlig‘iga ruxsat etilgan.'), { statusCode: 403 }))
  }
  next()
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    role: user.role,
    companyId: user.companyId,
    monthlySalary: user.monthlySalary || 0,
  }
}

function companyRecords(database, companyId, collection) {
  return database[collection].filter((item) => item.companyId === companyId)
}

function requireCompany(request, database) {
  const company = database.companies.find((item) => item.id === request.user.companyId)
  if (!company) fail(403, 'Do‘kon akkaunti topilmadi yoki faolsizlantirilgan.')
  return company
}

function ensureUniqueLogin(database, login) {
  if (findUniqueLogin(database, login)) fail(409, 'Bu login boshqa akkauntda ishlatilgan. Boshqa login tanlang.')
}

app.get('/api/status', (request, response) => {
  const database = readDatabase()
  const user = currentUser(request)
  const company = user && ['company_owner', 'employee'].includes(user.role)
    ? database.companies.find((item) => item.id === user.companyId)
    : null
  response.json({
    setupRequired: !database.users.some((user) => user.role === 'platform_admin'),
    user: user ? safeUser(user) : null,
    company: company ? { id: company.id, name: company.name } : null,
    subscription: company ? companyAccessStatus(database, company) : null,
  })
})

app.get('/api/public/settings', (_request, response) => {
  const { phone } = readDatabase().platformSettings
  response.json({ phone, telegram: 'naziroff1' })
})

app.get('/api/public/landing', (_request, response) => {
  const database = readDatabase()
  const demoCompanyIds = new Set(database.companies.filter((company) => company.isDemo).map((company) => company.id))
  const activeBrands = database.companies
    .filter((company) => !company.isDemo && subscriptionStatus(database, company).active)
    .map((company) => ({
      name: company.name,
      salesCount: companyRecords(database, company.id, 'sales').length,
    }))
    .sort((first, second) => second.salesCount - first.salesCount || first.name.localeCompare(second.name, 'uz'))
    .slice(0, 3)
    .map(({ name }) => name)
  response.json({
    brandCount: database.companies.filter((company) => !company.isDemo).length,
    verifiedReceiptCount: database.sales.filter((sale) => !demoCompanyIds.has(sale.companyId)).length,
    activeBrands,
    registrationCount: database.demoRegistrations.length,
  })
})

app.post('/api/setup', registrationLimiter, async (request, response) => {
  const name = validateName(request.body?.name, 'Platforma egasining ismi')
  const login = validateLogin(request.body?.login)
  validatePassword(request.body?.password)
  const passwordHash = await bcrypt.hash(request.body.password, 12)
  const user = await updateDatabase((database) => {
    if (database.users.some((entry) => entry.role === 'platform_admin')) fail(409, 'Platforma egasi allaqachon yaratilgan.')
    ensureUniqueLogin(database, login)
    const created = {
      id: randomUUID(),
      name,
      login,
      passwordHash,
      role: 'platform_admin',
      companyId: null,
      monthlySalary: 0,
      active: true,
      createdAt: new Date().toISOString(),
    }
    database.users.push(created)
    return safeUser(created)
  })
  await new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()))
  request.session.userId = user.id
  response.status(201).json({ user })
})

app.post('/api/auth/login', async (request, response) => {
  const login = normalizeLogin(request.body?.login)
  const password = request.body?.password
  if (!login || typeof password !== 'string') fail(400, 'Login va parolni kiriting.')
  const user = readDatabase().users.find((entry) => (entry.login === login || entry.email === login) && entry.active)
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) fail(401, 'Login yoki parol noto‘g‘ri.')
  const requestedRole = request.body?.role
  if ((requestedRole === 'employee' && user.role !== 'employee')
    || (requestedRole === 'company_owner' && !['company_owner', 'platform_admin'].includes(user.role))) {
    fail(401, 'Tanlangan kirish turi uchun login yoki parol mos emas.')
  }
  await new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()))
  request.session.userId = user.id
  response.json({ user: safeUser(user) })
})

app.patch('/api/account/credentials', requireAuth, requireCompanyOwner, async (request, response) => {
  const currentPassword = request.body?.currentPassword
  if (typeof currentPassword !== 'string' || !currentPassword) fail(400, 'Joriy parolni kiriting.')
  const requestedLogin = typeof request.body?.login === 'string' ? request.body.login.trim() : ''
  const login = requestedLogin.includes('@') ? validateEmail(requestedLogin) : validateLogin(requestedLogin)
  const newPassword = request.body?.newPassword
  if (newPassword !== undefined && newPassword !== '') validatePassword(newPassword)
  const passwordHash = typeof newPassword === 'string' && newPassword ? await bcrypt.hash(newPassword, 12) : null
  const user = await updateDatabase(async (database) => {
    const account = database.users.find((entry) => entry.id === request.user.id && entry.active)
    if (!account || !(await bcrypt.compare(currentPassword, account.passwordHash))) fail(401, 'Joriy parol noto‘g‘ri.')
    if (database.users.some((entry) => entry.id !== account.id && (entry.login === login || entry.email === login))) {
      fail(409, 'Bu login boshqa akkauntda ishlatilgan.')
    }
    if (login === account.login && !passwordHash) fail(400, 'Yangi login yoki yangi parol kiriting.')
    account.login = login
    if (login.includes('@')) account.email = login
    else delete account.email
    if (passwordHash) account.passwordHash = passwordHash
    account.updatedAt = new Date().toISOString()
    return safeUser(account)
  })
  response.json({ user })
})

app.post('/api/demo/register', registrationLimiter, async (request, response) => {
  const name = validateName(request.body?.name, 'Ism-familiya')
  const email = validateEmail(request.body?.email)
  validatePassword(request.body?.password)
  const passwordHash = await bcrypt.hash(request.body.password, 12)
  const result = await updateDatabase((database) => {
    if (database.demoRegistrations.some((entry) => entry.email === email)) {
      fail(409, 'Bu email bilan demo oldin ro‘yxatdan o‘tgan. Mavjud email va parol bilan kiring.')
    }
    if (database.users.some((entry) => entry.login === email || entry.email === email)) {
      fail(409, 'Bu email allaqachon ishlatilgan.')
    }
    const now = new Date()
    const createdAt = now.toISOString()
    const demoExpiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString()
    const companyId = randomUUID()
    const user = {
      id: randomUUID(),
      name,
      login: email,
      email,
      passwordHash,
      role: 'company_owner',
      companyId,
      monthlySalary: 0,
      active: true,
      createdAt,
    }
    const company = {
      id: companyId,
      name: `Demo do‘kon · ${name}`,
      ownerId: user.id,
      nextReceiptNumber: 0,
      isDemo: true,
      demoExpiresAt,
      createdAt,
    }
    database.users.push(user)
    database.companies.push(company)
    database.demoRegistrations.push({ id: randomUUID(), email, createdAt, expiresAt: demoExpiresAt })
    return { user: safeUser(user), company: { id: company.id, name: company.name }, demoExpiresAt }
  })
  await new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()))
  request.session.userId = result.user.id
  response.status(201).json(result)
})

app.post('/api/auth/logout', requireAuth, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) return next(error)
    response.clearCookie('yemzor.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
    response.status(204).end()
  })
})

app.get('/api/platform/companies', requireAuth, requirePlatformAdmin, (_request, response) => {
  const database = readDatabase()
  const companies = database.companies.filter((company) => !company.isDemo).map((company) => {
    const owner = database.users.find((user) => user.id === company.ownerId)
    const employees = companyRecords(database, company.id, 'users').filter((user) => user.role === 'employee')
    const latestSubscription = companyRecords(database, company.id, 'subscriptions')
      .sort((a, b) => b.period.localeCompare(a.period))[0] || null
    return {
      id: company.id,
      name: company.name,
      createdAt: company.createdAt,
      ownerLogin: owner?.login || '',
      employeeCount: employees.length,
      latestSubscription,
      currentRate: database.subscriptionRates.find((item) => item.companyId === company.id && item.period === currentBillingPeriod()) || null,
      currentSubscription: subscriptionStatus(database, company),
    }
  })
  response.json({ companies })
})

app.post('/api/platform/companies', requireAuth, requirePlatformAdmin, async (request, response) => {
  const name = validateName(request.body?.name, 'Do‘kon nomi')
  const ownerName = validateName(request.body?.ownerName, 'Boshliq ismi')
  const login = validateLogin(request.body?.login)
  validatePassword(request.body?.password)
  const monthlyFee = positiveAmount(request.body?.monthlyFee, 'Oylik obuna narxi')
  const period = typeof request.body?.period === 'string' ? request.body.period : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail(400, 'Obuna oyi YYYY-MM shaklida bo‘lishi kerak.')
  const passwordHash = await bcrypt.hash(request.body.password, 12)
  const result = await updateDatabase((database) => {
    ensureUniqueLogin(database, login)
    const now = new Date().toISOString()
    const company = { id: randomUUID(), name, ownerId: randomUUID(), nextReceiptNumber: 0, createdAt: now }
    const owner = {
      id: company.ownerId,
      name: ownerName,
      login,
      passwordHash,
      role: 'company_owner',
      companyId: company.id,
      monthlySalary: 0,
      active: true,
      createdAt: now,
    }
    database.companies.push(company)
    database.subscriptionRates.push({
      id: randomUUID(),
      companyId: company.id,
      period,
      amount: monthlyFee,
      createdAt: now,
      createdBy: request.user.id,
    })
    database.users.push(owner)
    return { id: company.id, name: company.name, monthlyFee, ownerLogin: owner.login, createdAt: company.createdAt }
  })
  response.status(201).json({ company: result })
})

app.patch('/api/platform/companies/:companyId/fee', requireAuth, requirePlatformAdmin, async (request, response) => {
  const monthlyFee = positiveAmount(request.body?.monthlyFee, 'Oylik obuna narxi')
  const period = typeof request.body?.period === 'string' ? request.body.period : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail(400, 'Obuna oyi YYYY-MM shaklida bo‘lishi kerak.')
  const company = await updateDatabase((database) => {
    const existing = database.companies.find((item) => item.id === request.params.companyId)
    if (!existing) fail(404, 'Kompaniya topilmadi.')
    const rate = database.subscriptionRates.find((item) => item.companyId === existing.id && item.period === period)
    if (rate) {
      rate.amount = monthlyFee
      rate.updatedAt = new Date().toISOString()
      rate.updatedBy = request.user.id
    } else {
      database.subscriptionRates.push({
        id: randomUUID(),
        companyId: existing.id,
        period,
        amount: monthlyFee,
        createdAt: new Date().toISOString(),
        createdBy: request.user.id,
      })
    }
    return { id: existing.id, name: existing.name, monthlyFee, period }
  })
  response.json({ company })
})

app.post('/api/platform/companies/:companyId/subscriptions', requireAuth, requirePlatformAdmin, async (request, response) => {
  const period = typeof request.body?.period === 'string' ? request.body.period : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail(400, 'Obuna oyini YYYY-MM shaklida kiriting.')
  const payment = await updateDatabase((database) => {
    const company = database.companies.find((item) => item.id === request.params.companyId)
    if (!company) fail(404, 'Kompaniya topilmadi.')
    if (!database.subscriptionRates.some((item) => item.companyId === company.id && item.period === period)) fail(409, 'Avval shu oy uchun kompaniya obuna narxini belgilang.')
    const amount = positiveAmount(request.body?.amount, 'To‘lov')
    const entry = {
      id: randomUUID(),
      companyId: company.id,
      period,
      amount,
      paidAt: new Date().toISOString(),
      createdBy: request.user.id,
    }
    database.subscriptions.push(entry)
    return entry
  })
  const database = readDatabase()
  const company = database.companies.find((item) => item.id === request.params.companyId)
  response.status(201).json({ payment, subscription: subscriptionStatus(database, company) })
})

app.get('/api/platform/settings', requireAuth, requirePlatformAdmin, (_request, response) => {
  response.json(readDatabase().platformSettings)
})

app.patch('/api/platform/settings', requireAuth, requirePlatformAdmin, async (request, response) => {
  const phone = validatePhone(request.body?.phone)
  const settings = await updateDatabase((database) => {
    database.platformSettings.phone = phone
    return database.platformSettings
  })
  response.json(settings)
})

app.delete('/api/platform/companies/:companyId', requireAuth, requirePlatformAdmin, async (request, response) => {
  const removed = await updateDatabase((database) => {
    const company = database.companies.find((item) => item.id === request.params.companyId)
    if (!company) fail(404, 'Do‘kon topilmadi.')
    const companyUsers = companyRecords(database, company.id, 'users')
    const userIds = new Set(companyUsers.map((user) => user.id))
    for (const collection of ['products', 'sales', 'receipts', 'movements', 'subscriptions', 'subscriptionRates', 'attendance']) {
      database[collection] = database[collection].filter((item) => item.companyId !== company.id)
    }
    database.users = database.users.filter((user) => !userIds.has(user.id))
    database.companies = database.companies.filter((item) => item.id !== company.id)
    return { id: company.id, name: company.name }
  })
  response.json({ company: removed, message: `${removed.name} do‘koni va unga tegishli barcha ma’lumotlar o‘chirildi.` })
})

app.get('/api/store', requireAuth, requireCompanyUser, requirePaidSubscription, (request, response) => {
  const database = readDatabase()
  const company = requireCompany(request, database)
  const users = companyRecords(database, company.id, 'users').filter((user) => user.active)
  const ownMovements = companyRecords(database, company.id, 'movements')
  response.json({
    company: { id: company.id, name: company.name, isDemo: Boolean(company.isDemo), demoExpiresAt: company.demoExpiresAt || null },
    products: companyRecords(database, company.id, 'products'),
    sales: companyRecords(database, company.id, 'sales').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    receipts: companyRecords(database, company.id, 'receipts'),
    movements: request.user.role === 'company_owner'
      ? ownMovements
      : ownMovements.filter((item) => item.employeeId === request.user.id),
    attendance: companyRecords(database, company.id, 'attendance').filter(
      (item) => request.user.role === 'company_owner' || item.employeeId === request.user.id,
    ),
    employees: request.user.role === 'company_owner'
      ? users.filter((user) => user.role === 'employee').map(safeUser)
      : users.filter((user) => user.id === request.user.id).map(safeUser),
  })
})

app.post('/api/products', requireAuth, requireCompanyOwner, requirePaidSubscription, async (request, response) => {
  const name = validateName(request.body?.name, 'Tovar nomi')
  const unit = request.body?.unit
  if (!['bag', 'weight'].includes(unit)) fail(400, 'Tovar birligi qop yoki vazn bo‘lishi kerak.')
  const quantity = Number(request.body?.quantity)
  const quantityUnit = request.body?.quantityUnit
  const price = positiveAmount(request.body?.price, 'Sotuv narxi')
  const minimumPrice = positiveAmount(request.body?.minimumPrice, 'Eng past narx')
  if (minimumPrice >= price) fail(400, 'Eng past narx asosiy narxdan kichik bo‘lishi kerak.')
  if (!Number.isFinite(quantity) || quantity <= 0) fail(400, 'Tovar miqdori musbat bo‘lishi kerak.')
  if (unit === 'bag' && (quantityUnit !== 'bag' || !Number.isSafeInteger(quantity))) fail(400, 'Qop miqdori butun son bo‘lishi kerak.')
  if (unit === 'weight' && !['kg', 'ton'].includes(quantityUnit)) fail(400, 'Vaznli tovar kirimida kg yoki tonnani tanlang.')
  const normalizedQuantity = quantityUnit === 'ton' ? quantity * 1000 : quantity
  if (!Number.isFinite(normalizedQuantity)) fail(400, 'Tovar miqdori juda katta.')
  const result = await updateDatabase((database) => {
    const company = requireCompany(request, database)
    if (companyRecords(database, company.id, 'products').some((item) => item.name.toLocaleLowerCase('uz') === name.toLocaleLowerCase('uz'))) {
      fail(409, 'Bunday nomdagi tovar allaqachon bor.')
    }
    const now = new Date().toISOString()
    const product = { id: randomUUID(), companyId: company.id, name, unit, quantity: normalizedQuantity, price, minimumPrice, createdAt: now, updatedAt: now }
    database.products.push(product)
    database.receipts.push({
      id: randomUUID(),
      companyId: company.id,
      productId: product.id,
      name,
      unit: unit === 'bag' ? 'bag' : 'kg',
      quantity: normalizedQuantity,
      price,
      total: Math.round(normalizedQuantity * price),
      createdAt: now,
    })
    return product
  })
  response.status(201).json({ product: result })
})

app.post('/api/products/:id/stock', requireAuth, requireCompanyOwner, requirePaidSubscription, async (request, response) => {
  const quantity = Number(request.body?.quantity)
  const unit = request.body?.unit
  if (!Number.isFinite(quantity) || quantity <= 0 || !['bag', 'kg', 'ton'].includes(unit)) fail(400, 'Kirim miqdori va birligini tekshiring.')
  if (unit === 'bag' && !Number.isSafeInteger(quantity)) fail(400, 'Qop miqdori butun son bo‘lishi kerak.')
  const result = await updateDatabase((database) => {
    const company = requireCompany(request, database)
    const product = companyRecords(database, company.id, 'products').find((item) => item.id === request.params.id)
    if (!product) fail(404, 'Tovar topilmadi.')
    if ((product.unit === 'bag' && unit !== 'bag') || (product.unit === 'weight' && unit === 'bag')) fail(400, 'Kirim birligi tovarning hisob birligiga mos kelmaydi.')
    const normalizedQuantity = unit === 'ton' ? quantity * 1000 : quantity
    if (!Number.isFinite(normalizedQuantity)) fail(400, 'Kirim miqdori juda katta.')
    const now = new Date().toISOString()
    product.quantity += normalizedQuantity
    product.updatedAt = now
    database.receipts.push({
      id: randomUUID(),
      companyId: company.id,
      productId: product.id,
      name: product.name,
      unit: product.unit === 'bag' ? 'bag' : 'kg',
      quantity: normalizedQuantity,
      price: product.price,
      total: Math.round(normalizedQuantity * product.price),
      createdAt: now,
    })
    return product
  })
  response.json({ product: result })
})

app.patch('/api/products/:id', requireAuth, requireCompanyOwner, requirePaidSubscription, async (request, response) => {
  const { name, price, minimumPrice } = request.body || {}
  const result = await updateDatabase((database) => {
    const company = requireCompany(request, database)
    const product = companyRecords(database, company.id, 'products').find((item) => item.id === request.params.id)
    if (!product) fail(404, 'Tovar topilmadi.')
    const nextName = name === undefined ? product.name : validateName(name, 'Tovar nomi')
    const nextPrice = price === undefined ? product.price : positiveAmount(price, 'Sotuv narxi')
    const nextMinimum = minimumPrice === undefined ? product.minimumPrice : positiveAmount(minimumPrice, 'Eng past narx')
    if (nextMinimum >= nextPrice) fail(400, 'Eng past narx asosiy narxdan kichik bo‘lishi kerak.')
    if (companyRecords(database, company.id, 'products').some((item) => item.id !== product.id && item.name.toLocaleLowerCase('uz') === nextName.toLocaleLowerCase('uz'))) fail(409, 'Bunday nomdagi tovar mavjud.')
    Object.assign(product, { name: nextName, price: nextPrice, minimumPrice: nextMinimum, updatedAt: new Date().toISOString() })
    return product
  })
  response.json({ product: result })
})

app.post('/api/sales', requireAuth, requireCompanyUser, requirePaidSubscription, async (request, response) => {
  const items = request.body?.items
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) fail(400, 'Chekda 1–100 ta mahsulot bo‘lishi kerak.')
  const normalizedItems = items.map((item) => {
    const productId = typeof item?.productId === 'string' ? item.productId : ''
    const quantity = Number(item?.quantity)
    const price = positiveAmount(item?.price, 'Sotuv narxi')
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) fail(400, 'Chekdagi tovar yoki miqdor noto‘g‘ri.')
    return { productId, quantity, price }
  })
  const sale = await updateDatabase((database) => {
    const company = requireCompany(request, database)
    let sellerId = request.user.id
    if (request.user.role === 'company_owner' && request.body?.sellerId) {
      const seller = companyRecords(database, company.id, 'users').find((user) => user.id === request.body.sellerId && user.role === 'employee' && user.active)
      if (!seller) fail(400, 'Tanlangan sotuvchi ushbu do‘konda faol emas.')
      sellerId = seller.id
    }
    const aggregate = new Map()
    for (const item of normalizedItems) aggregate.set(item.productId, (aggregate.get(item.productId) || 0) + item.quantity)
    const products = new Map()
    const lines = normalizedItems.map(({ productId, quantity, price }) => {
      const product = companyRecords(database, company.id, 'products').find((entry) => entry.id === productId)
      if (!product) fail(404, 'Tovar topilmadi yoki boshqa do‘konga tegishli.')
      if (product.unit === 'bag' && !Number.isSafeInteger(quantity)) fail(400, `${product.name}: qop soni butun bo‘lishi kerak.`)
      if (price <= product.minimumPrice || price > product.price) fail(400, `${product.name}: narx ${product.minimumPrice.toLocaleString('uz-UZ')} so‘mdan yuqori, ${product.price.toLocaleString('uz-UZ')} so‘mdan oshmagan bo‘lishi kerak.`)
      if (!products.has(productId)) products.set(productId, product)
      return {
        productId,
        name: product.name,
        unit: product.unit === 'bag' ? 'bag' : 'kg',
        quantity,
        price,
        lineTotal: Math.round(quantity * price),
      }
    })
    for (const [productId, totalQuantity] of aggregate) {
      const product = products.get(productId)
      if (totalQuantity > product.quantity) fail(409, `${product.name}: omborda so‘ralgan miqdor yetarli emas.`)
      product.quantity -= totalQuantity
      product.updatedAt = new Date().toISOString()
    }
    const seller = database.users.find((user) => user.id === sellerId)
    const createdAt = new Date().toISOString()
    const result = {
      id: randomUUID(),
      companyId: company.id,
      receiptNumber: String(++company.nextReceiptNumber).padStart(6, '0'),
      sellerId,
      sellerName: seller?.name || 'Hodim',
      items: lines,
      total: lines.reduce((total, line) => total + line.lineTotal, 0),
      createdAt,
    }
    database.sales.push(result)
    return result
  })
  response.status(201).json({ sale })
})

app.post('/api/employees', requireAuth, requireCompanyOwner, requirePaidSubscription, async (request, response) => {
  const name = validateName(request.body?.name, 'Hodim ismi')
  const login = validateLogin(request.body?.login)
  validatePassword(request.body?.password)
  const monthlySalary = positiveAmount(request.body?.monthlySalary, 'Oylik')
  const passwordHash = await bcrypt.hash(request.body.password, 12)
  const employee = await updateDatabase((database) => {
    const company = requireCompany(request, database)
    ensureUniqueLogin(database, login)
    const created = {
      id: randomUUID(),
      name,
      login,
      passwordHash,
      role: 'employee',
      companyId: company.id,
      monthlySalary,
      active: true,
      createdAt: new Date().toISOString(),
    }
    database.users.push(created)
    return safeUser(created)
  })
  response.status(201).json({ employee })
})

app.patch('/api/employees/:id', requireAuth, requireCompanyOwner, requirePaidSubscription, async (request, response) => {
  const name = validateName(request.body?.name, 'Hodim ismi')
  const monthlySalary = positiveAmount(request.body?.monthlySalary, 'Oylik')
  const employee = await updateDatabase((database) => {
    const company = requireCompany(request, database)
    const user = companyRecords(database, company.id, 'users').find((item) => item.id === request.params.id && item.role === 'employee')
    if (!user) fail(404, 'Hodim topilmadi.')
    Object.assign(user, { name, monthlySalary })
    return safeUser(user)
  })
  response.json({ employee })
})

app.delete('/api/employees/:id', requireAuth, requireCompanyOwner, requirePaidSubscription, async (request, response) => {
  const removed = await updateDatabase((database) => {
    const company = requireCompany(request, database)
    const employee = companyRecords(database, company.id, 'users').find((user) => user.id === request.params.id && user.role === 'employee')
    if (!employee) fail(404, 'Hodim topilmadi.')
    database.users = database.users.filter((user) => user.id !== employee.id)
    database.movements = database.movements.filter((item) => item.employeeId !== employee.id)
    database.attendance = database.attendance.filter((item) => item.employeeId !== employee.id)
    return { id: employee.id, name: employee.name }
  })
  response.json({
    employee: removed,
    message: 'Hodim akkaunti, davomat, avans va Abed yozuvlari o‘chirildi. Avvalgi savdo va cheklar saqlandi.',
  })
})

app.put('/api/employees/:id/attendance', requireAuth, requireCompanyOwner, requirePaidSubscription, async (request, response) => {
  const date = validateDate(request.body?.date)
  const status = request.body?.status
  if (!['present', 'absent'].includes(status)) fail(400, 'Davomat holati kelgan yoki kelmagan bo‘lishi kerak.')
  const attendance = await updateDatabase((database) => {
    const company = requireCompany(request, database)
    const employee = companyRecords(database, company.id, 'users')
      .find((user) => user.id === request.params.id && user.role === 'employee' && user.active)
    if (!employee) fail(404, 'Faol hodim topilmadi.')
    const existing = companyRecords(database, company.id, 'attendance')
      .find((item) => item.employeeId === employee.id && item.date === date)
    if (existing) {
      existing.status = status
      existing.updatedAt = new Date().toISOString()
      existing.updatedBy = request.user.id
      return existing
    }
    const record = {
      id: randomUUID(),
      companyId: company.id,
      employeeId: employee.id,
      employeeName: employee.name,
      date,
      status,
      createdAt: new Date().toISOString(),
      updatedBy: request.user.id,
    }
    database.attendance.push(record)
    return record
  })
  response.json({ attendance })
})

app.post('/api/employees/:id/movements', requireAuth, requireCompanyOwner, requirePaidSubscription, async (request, response) => {
  const kind = request.body?.kind
  if (!['advance', 'abed'].includes(kind)) fail(400, 'To‘lov turi avans yoki Abed bo‘lishi kerak.')
  const amount = positiveAmount(request.body?.amount)
  const period = typeof request.body?.period === 'string' ? request.body.period : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail(400, 'Hisob oyini YYYY-MM shaklida kiriting.')
  const date = validateDate(request.body?.date || new Date().toISOString().slice(0, 10))
  if (kind === 'abed' && date.slice(0, 7) !== period) fail(400, 'Abed puli oyi uning sanasiga mos bo‘lishi kerak.')
  const entry = await updateDatabase((database) => {
    const company = requireCompany(request, database)
    const employee = companyRecords(database, company.id, 'users').find((user) => user.id === request.params.id && user.role === 'employee')
    if (!employee) fail(404, 'Hodim topilmadi.')
    const created = {
      id: randomUUID(),
      companyId: company.id,
      employeeId: employee.id,
      employeeName: employee.name,
      kind,
      amount,
      period,
      date,
      createdAt: new Date().toISOString(),
      createdBy: request.user.id,
    }
    database.movements.push(created)
    return created
  })
  response.status(201).json({ movement: entry })
})

app.get('/api/receipts/:number', requireAuth, requireCompanyUser, requirePaidSubscription, (request, response) => {
  const number = request.params.number.replace(/\D/g, '').padStart(6, '0')
  const database = readDatabase()
  const company = requireCompany(request, database)
  const sale = companyRecords(database, company.id, 'sales').find((item) => item.receiptNumber === number)
  if (!sale) fail(404, 'Bu raqamli chek ushbu do‘konda topilmadi.')
  response.json({ sale })
})

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return response.status(400).json({ error: 'So‘rov JSON ma’lumotlarini tekshiring.' })
  }
  if ((error.statusCode || 500) >= 500) console.error(error)
  response.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : 'Serverda xatolik yuz berdi. Qayta urinib ko‘ring.',
    ...(error.subscription ? { subscription: error.subscription, companyName: error.companyName } : {}),
  })
})

initializeDatabase()
  .then(() => {
    app.listen(port, () => console.log(`Yemzor API http://localhost:${port} — database.json`))
  })
  .catch((error) => {
    console.error('database.json faylini yuklab bo‘lmadi:', error)
    process.exitCode = 1
  })
