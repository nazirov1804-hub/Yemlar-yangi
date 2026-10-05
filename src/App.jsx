import { useCallback, useEffect, useState } from 'react'
import {
  FiArrowDownLeft, FiArrowUpRight, FiBox, FiBriefcase, FiCalendar,
  FiCheck, FiChevronRight, FiClock, FiDollarSign, FiLogOut, FiPlus, FiPrinter,
  FiEye, FiEyeOff, FiMessageCircle, FiPhone, FiSearch, FiShield, FiShoppingCart, FiTrash2,
  FiTrendingUp, FiUsers, FiX,
} from 'react-icons/fi'
import { Toaster, toast } from 'sonner'
import { api, money, numberInput, readNumber } from './api'

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const startOfWeek = (date) => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}
const amountSum = (rows) => rows.reduce((total, row) => total + (Number(row.total) || 0), 0)
const movementQuantity = (rows) => {
  const bags = rows.filter((row) => row.unit === 'bag').reduce((sum, row) => sum + row.quantity, 0)
  const kilograms = rows.filter((row) => row.unit === 'kg').reduce((sum, row) => sum + row.quantity, 0)
  return `${bags.toLocaleString('uz-UZ')} qop · ${kilograms.toLocaleString('uz-UZ', { maximumFractionDigits: 3 })} kg`
}
const quantityLabel = (product, quantity = product.quantity) => product.unit === 'bag'
  ? `${Number(quantity).toLocaleString('uz-UZ')} qop`
  : `${Number(quantity).toLocaleString('uz-UZ', { maximumFractionDigits: 3 })} kg`
const dateTime = (value) => new Intl.DateTimeFormat('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function App() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState('')
  const [data, setData] = useState(null)
  const [pageSelection, setPageSelection] = useState(null)
  const [accessView, setAccessView] = useState('landing')
  const [modal, setModal] = useState('')
  const [selected, setSelected] = useState(null)
  const [publicSettings, setPublicSettings] = useState({ phone: '', telegram: 'naziroff1' })
  const user = status?.user
  const savedPage = user ? window.localStorage.getItem(`yemzor:last-page:${user.id}`) : null
  const activePage = pageSelection && pageSelection.userId === user?.id ? pageSelection.page : savedPage || 'overview'
  const setActivePage = useCallback((page) => {
    if (!user?.id) return
    window.localStorage.setItem(`yemzor:last-page:${user.id}`, page)
    setPageSelection({ userId: user.id, page })
  }, [user])

  const refreshStatus = useCallback(async () => {
    const [result, contact] = await Promise.all([api('/api/status'), api('/api/public/settings')])
    setPublicSettings(contact)
    let storeData = null
    if (result.subscription?.active && result.user && ['company_owner', 'employee'].includes(result.user.role)) {
      storeData = await api('/api/store')
    }
    setStatus(result)
    setData(storeData)
    setBootError('')
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([api('/api/status'), api('/api/public/settings')])
      .then(async ([result, contact]) => {
        const storeData = result.subscription?.active && result.user && ['company_owner', 'employee'].includes(result.user.role)
          ? await api('/api/store')
          : null
        if (!active) return
          setPublicSettings(contact)
          setStatus(result)
        setData(storeData)
        setLoading(false)
      })
      .catch((error) => {
        if (!active) return
        setBootError(error.message)
        setLoading(false)
      })
    return () => { active = false }
  }, [])

  const refreshStore = useCallback(async () => {
    let storeData
    try {
      storeData = await api('/api/store')
    } catch (error) {
      if (error.status === 423) {
        setData(null)
        setStatus((current) => current ? {
          ...current,
          subscription: error.details?.subscription || { ...current.subscription, active: false },
        } : current)
        return null
      }
      if (error.status === 401) {
        setData(null)
        setStatus((current) => current ? { ...current, user: null } : current)
      }
      throw error
    }
    setData(storeData)
    setStatus((current) => {
      if (!current?.user) return current
      const ownAccount = storeData.employees.find((employee) => employee.id === current.user.id)
      if (!ownAccount || (ownAccount.name === current.user.name && ownAccount.monthlySalary === current.user.monthlySalary)) return current
      return { ...current, user: { ...current.user, ...ownAccount } }
    })
  }, [])

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
      setStatus((current) => ({ ...current, user: null }))
      setData(null)
      setAccessView('landing')
    } catch (error) {
      toast.error(error.message)
    }
  }

  const content = loading || !status
    ? <div className="boot-screen"><img className="brand-symbol" src="/yemzor-logo.png" alt="" /><strong>Yemzor</strong><span>{bootError || 'Tizim yuklanmoqda...'}</span>{bootError && <button className="button button-secondary" onClick={() => { setLoading(true); refreshStatus().catch((error) => { setBootError(error.message); setLoading(false) }) }}>Qayta urinish</button>}</div>
    : !user
      ? accessView === 'login'
        ? <AccessPage setupRequired={status.setupRequired} onSuccess={refreshStatus} onBack={() => setAccessView('landing')} />
        : accessView === 'demo'
          ? <DemoRegistrationPage onSuccess={refreshStatus} onBack={() => setAccessView('landing')} />
          : <LandingPage phone={publicSettings.phone} telegram={publicSettings.telegram} onLogin={() => setAccessView('login')} onDemo={() => setAccessView('demo')} />
      : user.role === 'platform_admin'
        ? <PlatformPage user={user} onLogout={logout} onContactSave={setPublicSettings} />
      : status.subscription?.demo && !status.subscription.active
        ? <DemoExpiredGate onLogout={logout} onRestart={async () => { await logout(); setAccessView('demo') }} />
      : !status.subscription?.active
        ? <SubscriptionGate
            company={status.company}
            subscription={status.subscription}
            onRefresh={() => refreshStatus().catch((error) => toast.error(error.message))}
            onLogout={logout}
          />
        : data && <StoreApp
            user={user}
            data={data}
            activePage={activePage}
            setActivePage={setActivePage}
            onRefresh={refreshStore}
            onLogout={logout}
            modal={modal}
            setModal={setModal}
            selected={selected}
            setSelected={setSelected}
            onUserUpdate={(updatedUser) => setStatus((current) => ({ ...current, user: updatedUser }))}
          />
  return <>{content}<Toaster position="top-center" richColors closeButton /></>
}

function LandingPage({ phone, telegram, onLogin, onDemo }) {
  const now = useClock()
  const [stats, setStats] = useState({ brandCount: 0, verifiedReceiptCount: 0, activeBrands: [], registrationCount: 0 })
  useEffect(() => {
    let active = true
    let notified = false
    const refresh = () => api('/api/public/landing')
      .then((result) => {
        if (!active) return
        setStats(result)
        notified = false
      })
      .catch((error) => {
        if (active && !notified) toast.error(`Landing ma’lumotlarini yuklab bo‘lmadi: ${error.message}`)
        notified = true
      })
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 10000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])
  return <main className="landing">
    <header className="landing-header">
      <a href="#" className="brand"><img className="brand-symbol" src="/yemzor-logo.png" alt="" /><span><strong>Yemzor</strong><small>SAVDO VA OMBOR BOSHQARUVI</small></span></a>
      <nav className="landing-nav" aria-label="Sahifa bo‘limlari"><a href="#afzalliklar">Imkoniyatlar</a><a href={`https://t.me/${telegram || 'naziroff1'}`} target="_blank" rel="noreferrer">Bog‘lanish · @{telegram || 'naziroff1'}</a></nav>
      <button className="button button-secondary" onClick={onLogin}>Kirish <FiChevronRight /></button>
    </header>
    <section className="landing-hero">
      <div className="landing-hero-copy"><span className="landing-kicker"><i /> DO‘KONINGIZ UCHUN YAGONA NAZORAT</span><h1>Har bir qop, har bir savdo — <span>aniq hisobda.</span></h1><p>Yem do‘koningiz ombori, sotuvlari, cheklari va xodimlari hisobini bitta qulay tizimda yuriting.</p><div className="landing-actions"><button className="button button-primary" onClick={onLogin}>Tizimga kirish <FiChevronRight /></button><button className="button button-secondary" onClick={onDemo}><FiClock /> 48 soat bepul sinash</button><a className="button button-secondary" href={`https://t.me/${telegram || 'naziroff1'}`} target="_blank" rel="noreferrer"><FiMessageCircle /> Bog‘lanish · @{telegram || 'naziroff1'}</a></div><div className="landing-trust"><span><FiShield /> Do‘konlar ma’lumoti alohida</span><span><FiTrendingUp /> Savdo holati tez yangilanadi</span></div></div>
      <div className="landing-preview" aria-label="Savdo boshqaruv paneli namunasi">
        <div className="preview-window"><div className="preview-top"><span><i /><i /><i /></span><small>YEMZOR / JONLI MA’LUMOT</small></div><div className="preview-greeting"><small>YEMZOR PLATFORMASI</small><strong>Do‘konlar va tasdiqlangan cheklar</strong></div><div className="preview-metrics"><span><small>Jami brendlar</small><b>{stats.brandCount.toLocaleString('uz-UZ')}</b><i>Platformada ro‘yxatda</i></span><span><small>Tasdiqlangan cheklar</small><b>{stats.verifiedReceiptCount.toLocaleString('uz-UZ')}</b><i>Saqlangan savdolar</i></span><span><small>Ro‘yxatdan o‘tganlar</small><b>{stats.registrationCount.toLocaleString('uz-UZ')}</b><i>Demo akkauntlar jami</i></span></div><div className="preview-stock"><div><small>FAOL BRENDLAR · TOP {stats.activeBrands.length}</small>{stats.activeBrands.length ? stats.activeBrands.map((brand) => <span key={brand}>{brand} <b>Faol</b></span>) : <span>Hozircha faol brend yo‘q <b>—</b></span>}</div><div className="preview-receipt"><FiCheck /><b>{stats.brandCount.toLocaleString('uz-UZ')} ta do‘kon</b><small>Har bir brend alohida hisobda</small></div></div></div>
        <div className="preview-floating"><span><FiCheck /></span><div><strong>Qoldiq yangilandi</strong><small>Hamma sotuvchida bir xil</small></div></div>
      </div>
    </section>
    <section className="landing-features" id="afzalliklar"><div className="landing-section-head"><span className="eyebrow">SODDA BOSHQARUV</span><h2>Do‘kon ishingizga kerakli hamma narsa</h2><p>Kundalik ishlar chalkashmasin — savdo, ombor va hisob bir joyda.</p></div><div className="feature-grid"><Feature icon={FiBox} number="01" title="Umumiy ombor" text="Qop va kilogrammdagi qoldiq har bir sotuvdan keyin yangilanadi." /><Feature icon={FiShoppingCart} number="02" title="Savdo va chek" text="Mahsulotni toping, narxni tasdiqlang va chek raqami bilan savdoni kuzating." /><Feature icon={FiUsers} number="03" title="Xodimlar hisobi" text="Xodimlarga alohida kirish, davomat, oylik avansi va kunlik hisob." /><Feature icon={FiTrendingUp} number="04" title="Hisobotlar" text="Kunlik, haftalik va oylik tushum hamda tovar harakati." /></div></section>
    <section className="landing-contact" id="aloqa"><div><span className="eyebrow">SAVOLLARINGIZ BORMI?</span><h2>Bog‘laning — yordam beramiz.</h2><p>Yemzor haqida ma’lumot olish yoki tizimga ulanish bo‘yicha bizga yozing.</p></div><div className="contact-cards"><a className="contact-card telegram-contact" href={`https://t.me/${telegram || 'naziroff1'}`} target="_blank" rel="noreferrer"><span><FiMessageCircle /></span><div><small>TELEGRAM</small><strong>@{telegram || 'naziroff1'}</strong></div><FiChevronRight /></a>{phone ? <a className="contact-card" href={`tel:${phone.replace(/[^\d+]/g, '')}`}><span><FiPhone /></span><div><small>TELEFON</small><strong>{phone}</strong></div><FiChevronRight /></a> : <div className="contact-card contact-muted"><span><FiPhone /></span><div><small>TELEFON</small><strong>Telefon raqami tez orada</strong></div></div>}</div></section>
    <footer className="landing-footer"><a href="#" className="brand"><img className="brand-symbol" src="/yemzor-logo.png" alt="" /><span><strong>Yemzor</strong><small>SAVDO VA OMBOR BOSHQARUVI</small></span></a><span>Yem do‘konlari uchun qulay hisob.</span><span>© {now.getFullYear()} Yemzor</span></footer>
  </main>
}

function Feature({ icon: Icon, number, title, text }) {
  return <article className="feature-card"><div className="feature-top"><span><Icon /></span><small>{number}</small></div><h3>{title}</h3><p>{text}</p></article>
}

function DemoRegistrationPage({ onSuccess, onBack }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    if (form.get('password') !== form.get('confirmPassword')) {
      setError('Parollar bir xil emas.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api('/api/demo/register', {
        method: 'POST',
        body: { name: form.get('name'), email: form.get('email'), password: form.get('password') },
      })
      toast.success('Demo do‘kon ochildi · 48 soat foydalanishingiz mumkin')
      await onSuccess()
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSaving(false)
    }
  }
  return <main className="access-shell">
    <section className="access-aside">
      <a className="brand brand-light" href="#"><img className="brand-symbol" src="/yemzor-logo.png" alt="" /><span><strong>Yemzor</strong><small>48 SOATLIK DEMO</small></span></a>
      <div className="access-message"><span className="eyebrow">BEPUL SINAB KO‘RING</span><h1>Do‘kon ishini to‘liq sinab ko‘ring.</h1><p>Demo do‘konda tovar, savdo, hisobot va xodimlarni boshqarish imkoniyatlari bor. Demo 48 soatdan keyin avtomatik yopiladi.</p></div>
      <div className="access-foot">Email orqali ro‘yxatdan o‘ting · Alohida demo ma’lumotlari</div>
    </section>
    <section className="access-main">
      <form className="access-card" onSubmit={submit}>
        <button type="button" className="back-link" onClick={onBack}>← Bosh sahifaga</button>
        <span className="eyebrow">YANGI DEMO HISOBI</span>
        <h2>48 soat bepul sinash</h2>
        <p className="muted">Email va parol yarating. Demo do‘koningiz shu zahoti ochiladi.</p>
        <Field label="Ism-familiya"><input name="name" autoComplete="name" required minLength="2" maxLength="80" placeholder="Masalan, Ali Valiyev" /></Field>
        <Field label="Email"><input name="email" type="email" autoComplete="email" required maxLength="254" placeholder="ali@example.com" /></Field>
        <Field label="Parol"><PasswordInput name="password" autoComplete="new-password" required minLength="10" maxLength="200" placeholder="Kamida 10 ta belgi" /></Field>
        <Field label="Parolni takrorlang"><PasswordInput name="confirmPassword" autoComplete="new-password" required minLength="10" maxLength="200" placeholder="Parolni qayta kiriting" /></Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-wide" disabled={saving}>{saving ? 'Hisob yaratilmoqda...' : 'Demo do‘konni ochish'} <FiChevronRight /></button>
        <p className="security-note">Har bir email uchun bitta demo beriladi. Demo tugagach, ma’lumotlarga kirish yopiladi.</p>
      </form>
    </section>
  </main>
}

function AccessPage({ setupRequired, onSuccess, onBack }) {
  const [form, setForm] = useState({ name: '', login: '', password: '' })
  const [loginRole, setLoginRole] = useState('company_owner')
  const [saving, setSaving] = useState(false)
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api(setupRequired ? '/api/setup' : '/api/auth/login', {
        method: 'POST',
        body: setupRequired ? form : { ...form, role: loginRole },
      })
      toast.success(setupRequired ? 'Platforma akkaunti yaratildi' : 'Tizimga muvaffaqiyatli kirdingiz')
      await onSuccess()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }
  return <main className="access-shell">
    <section className={`access-aside ${!setupRequired && loginRole === 'employee' ? 'employee-role' : ''}`}>
      <a className="brand brand-light" href="#"><img className="brand-symbol" src="/yemzor-logo.png" alt="" /><span><strong>Yemzor</strong><small>YEM SAVDOSI NAZORATI</small></span></a>
      {setupRequired || loginRole === 'company_owner'
        ? <div className="access-message"><span className="eyebrow">BIR JOYDA. ANIQ HISOBDA.</span><h1>Do‘koningizni bir joydan boshqaring.</h1><p>Tovarlar, ombor qoldig‘i, savdo cheklari va xodimlar hisobi — barchasi bitta xavfsiz panelda.</p></div>
        : <div className="access-message"><span className="eyebrow">SIZNING ISH JARAYONINGIZ</span><h1>Ish jarayoningiz endi tizimda.</h1><p>Savdolaringiz, tasdiqlangan cheklaringiz va shaxsiy oylik hisobingizni ko‘ring. Umumiy ombor qoldig‘i har bir xodimda bir xil yangilanadi.</p></div>}
      <div className="access-foot">Xavfsiz kirish · Alohida do‘konlar · Jonli qoldiq</div>
    </section>
    <section className="access-main">
      <form className="access-card" onSubmit={submit}>
        <button type="button" className="back-link" onClick={onBack}>← Bosh sahifaga</button>
        <span className="eyebrow">{setupRequired ? 'BIR MARTALIK SOZLASH' : 'XUSH KELIBSIZ'}</span>
        <h2>{setupRequired ? 'Platforma egasini yarating' : 'Hisobingizga kiring'}</h2>
        <p className="muted">{setupRequired ? 'Birinchi akkaunt kompaniyalar va do‘konlarni boshqaradi.' : 'Rolingizni tanlang va login-parolingiz bilan kiring.'}</p>
        {!setupRequired && <div className="role-switch" role="group" aria-label="Kirish turi"><button type="button" className={loginRole === 'company_owner' ? 'selected' : ''} onClick={() => setLoginRole('company_owner')}>Boshliq</button><button type="button" className={loginRole === 'employee' ? 'selected' : ''} onClick={() => setLoginRole('employee')}>Hodim</button></div>}
        {setupRequired && <Field label="Ism-familiya"><input autoComplete="name" required minLength="2" maxLength="80" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Masalan, Ali Valiyev" /></Field>}
        <Field label={loginRole === 'company_owner' ? 'Email yoki login' : 'Login'}><input autoComplete="username" required minLength="3" maxLength="254" value={form.login} onChange={(event) => setForm({ ...form, login: event.target.value })} placeholder={loginRole === 'company_owner' ? 'Email yoki login' : 'login'} /></Field>
        <Field label="Parol"><PasswordInput autoComplete={setupRequired ? 'new-password' : 'current-password'} required minLength={setupRequired ? 10 : 1} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={setupRequired ? 'Kamida 10 ta belgi' : 'Parol'} /></Field>
        <button className="button button-primary button-wide" disabled={saving}>{saving ? 'Kuting...' : setupRequired ? 'Platformani sozlash' : 'Kirish'} <FiChevronRight /></button>
        {setupRequired && <p className="security-note">Parol faqat himoyalangan xesh ko‘rinishida saqlanadi.</p>}
      </form>
    </section>
  </main>
}

function SubscriptionGate({ company, subscription, onRefresh, onLogout }) {
  useEffect(() => {
    const timer = window.setInterval(() => { void onRefresh() }, 5000)
    return () => window.clearInterval(timer)
  }, [onRefresh])
  const unpaid = Number(subscription?.paidAmount) > 0 && subscription.paidAmount !== subscription.requiredAmount
  return <main className="subscription-shell">
    <a className="brand" href="#"><img className="brand-symbol" src="/yemzor-logo.png" alt="" /><span><strong>Yemzor</strong><small>OBUNA HOLATI</small></span></a>
    <section className="subscription-card">
      <span className="subscription-icon"><FiClock /></span>
      <span className={`status-pill ${subscription?.amountConfigured ? 'status-pending' : 'status-paid'}`}>{subscription?.amountConfigured ? 'TO‘LOV QILISH KERAK' : 'NARX BELGILANMAGAN'}</span>
      <h1>{company?.name || 'Do‘kon'} uchun oylik to‘lov</h1>
      <p>Do‘kon ishlashini davom ettirish uchun platforma egasi belgilagan oylik to‘lovni amalga oshiring. Tasdiqlangach, tizim avtomatik ochiladi.</p>
      <div className="subscription-amount"><span>{subscription?.period || 'Joriy oy'} uchun to‘lov</span><strong>{subscription?.amountConfigured ? money(subscription.requiredAmount) : 'Narx belgilanmoqda'}</strong></div>
      {unpaid && <div className="subscription-warning">Qayd etilgan to‘lov: {money(subscription.paidAmount)}. Davom etish uchun to‘liq belgilangan summa kerak.</div>}
      <div className="subscription-actions"><button className="button button-primary button-wide" onClick={onRefresh}><FiCheck /> To‘lov holatini tekshirish</button><button className="button button-secondary button-wide" onClick={onLogout}><FiLogOut /> Chiqish</button></div>
      <small className="subscription-note">To‘lov platforma egasi tomonidan tasdiqlanadi. Sahifa holati avtomatik yangilanadi.</small>
    </section>
  </main>
}

function DemoExpiredGate({ onLogout, onRestart }) {
  return <main className="subscription-shell">
    <a className="brand" href="#"><img className="brand-symbol" src="/yemzor-logo.png" alt="" /><span><strong>Yemzor</strong><small>DEMO HOLATI</small></span></a>
    <section className="subscription-card">
      <span className="subscription-icon"><FiClock /></span>
      <span className="status-pill status-pending">48 SOATLIK DEMO YAKUNLANDI</span>
      <h1>Demo muddati tugadi</h1>
      <p>Demo hisobingiz 48 soat ishladi. Yangi demo ochish uchun boshqa email bilan ro‘yxatdan o‘ting.</p>
      <div className="subscription-actions"><button className="button button-primary button-wide" onClick={onRestart}>Yangi demo ro‘yxatdan o‘tkazish <FiChevronRight /></button><button className="button button-secondary button-wide" onClick={onLogout}><FiLogOut /> Bosh sahifaga qaytish</button></div>
      <small className="subscription-note">Avvalgi demo ma’lumotlari hisob tarixida saqlanadi, ammo do‘kon paneliga kirish yopilgan.</small>
    </section>
  </main>
}

function PlatformPage({ user, onLogout, onContactSave }) {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState('')
  const [paymentCompany, setPaymentCompany] = useState(null)
  const [feeCompany, setFeeCompany] = useState(null)
  const [deleteCompany, setDeleteCompany] = useState(null)
  const [platformSettings, setPlatformSettings] = useState({ phone: '' })
  const [query, setQuery] = useState('')
  const todayMonth = monthKey(useClock())

  const load = useCallback(async () => {
    try {
      const [result, settings] = await Promise.all([api('/api/platform/companies'), api('/api/platform/settings')])
      setCompanies(result.companies)
      setPlatformSettings(settings)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void Promise.resolve().then(load) }, [load])

  const filtered = companies.filter((company) => company.name.toLocaleLowerCase('uz').includes(query.toLocaleLowerCase('uz')))
  async function createCompany(form) {
    form.period = todayMonth
    await api('/api/platform/companies', { method: 'POST', body: form })
    toast.success('Do‘kon yaratildi. Login va parolni xavfsiz yetkazib bering.')
    setModal('')
    await load()
  }
  async function recordPayment(form) {
    await api(`/api/platform/companies/${paymentCompany.id}/subscriptions`, { method: 'POST', body: form })
    toast.success('Oylik to‘lov qayd etildi')
    setPaymentCompany(null)
    await load()
  }
  async function setCompanyFee(form) {
    await api(`/api/platform/companies/${feeCompany.id}/fee`, { method: 'PATCH', body: form })
    toast.success(`${form.period} oyi uchun narx belgilandi`)
    setFeeCompany(null)
    await load()
  }
  async function saveContact(form) {
    const settings = await api('/api/platform/settings', { method: 'PATCH', body: form })
    setPlatformSettings(settings)
    onContactSave((current) => ({ ...current, ...settings }))
    toast.success('Aloqa raqami saqlandi')
    setModal('')
  }
  async function removeCompany() {
    const result = await api(`/api/platform/companies/${deleteCompany.id}`, { method: 'DELETE' })
    toast.success(result.message)
    setDeleteCompany(null)
    await load()
  }

  return <Shell user={user} onLogout={onLogout} platform>
    <PageHeading eyebrow="PLATFORMA BOSHQARUVI" title="Do‘konlar" description="Brendlarni yarating, oylik tarif va tushgan to‘lovlarni boshqaring." action={<div className="heading-actions"><button className="button button-secondary" onClick={() => setModal('contact')}><FiPhone /> Bog‘lanish raqami</button><button className="button button-primary" onClick={() => setModal('company')}><FiPlus /> Yangi do‘kon</button></div>} />
    <div className="metric-grid">
      <Metric label="Jami do‘kon" value={companies.length} detail="Platformada ro‘yxatdan o‘tgan" icon={FiBriefcase} />
      <Metric label="Shu oy to‘lagan" value={companies.filter((item) => item.currentSubscription.active).length} detail={todayMonth} icon={FiCheck} />
      <Metric label="To‘lov kutilmoqda" value={companies.filter((item) => !item.currentSubscription.active).length} detail="Joriy oy uchun" icon={FiClock} />
    </div>
    <section className="panel">
      <div className="panel-head"><div><h2>Kompaniyalar</h2><p>Har bir kompaniyaning do‘koni alohida ma’lumotlar bilan ishlaydi.</p></div><label className="search-box"><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Do‘kon qidirish" /></label></div>
      {loading ? <Loading /> : filtered.length ? <div className="company-grid">{filtered.map((company) => {
        const paid = company.currentSubscription.active
        const feeConfigured = Boolean(company.currentRate)
        return <article className="company-card" key={company.id}>
          <div className="company-card-top"><span className="company-icon"><FiBriefcase /></span><span className={`status-pill ${paid ? 'status-paid' : 'status-pending'}`}>{paid ? 'To‘langan' : feeConfigured ? 'To‘lov kerak' : 'Narx belgilanmagan'}</span></div>
          <h3>{company.name}</h3><p className="muted">Boshliq login: <strong>{company.ownerLogin}</strong></p>
          <div className="company-facts"><span><FiUsers /> {company.employeeCount} hodim</span><span><FiCalendar /> {todayMonth} · {feeConfigured ? money(company.currentRate.amount) : 'Narx yo‘q'}</span></div>
          <div className="company-card-footer">
            <span>{company.currentSubscription.paidAmount ? `Joriyga hisoblandi: ${money(company.currentSubscription.paidAmount)}` : company.currentSubscription.creditBalance ? `Keyingi oylar uchun avans: ${money(company.currentSubscription.creditBalance)}` : 'Joriy oy to‘lovi yo‘q'}{company.currentSubscription.creditBalance > 0 && company.currentSubscription.paidAmount > 0 ? ` · Avans: ${money(company.currentSubscription.creditBalance)}` : ''}</span>
            <div className="company-payment-actions">
              <button className="button button-tertiary button-small" onClick={() => setFeeCompany(company)}>{feeConfigured ? 'Oy narxini sozlash' : 'Oy narxini belgilash'}</button>
              <button className="button button-secondary button-small" disabled={!feeConfigured} onClick={() => setPaymentCompany(company)}>To‘lovni qayd etish</button>
              <button className="button button-danger button-small" onClick={() => setDeleteCompany(company)}>Do‘konni o‘chirish</button>
            </div>
          </div>
        </article>
      })}</div> : <Empty title="Do‘kon topilmadi" text="Boshqa nom bilan qidirib ko‘ring yoki yangi do‘kon yarating." />}
    </section>
    {modal === 'company' && <Modal title="Yangi do‘kon yaratish" subtitle="Joriy oyga tarif belgilanadi. Keyingi oy uchun narx alohida kiritiladi." onClose={() => setModal('')}><CompanyForm month={todayMonth} onSubmit={createCompany} /></Modal>}
    {modal === 'contact' && <Modal title="Bog‘lanish sozlamalari" subtitle="Landing sahifadagi telefon raqamni shu yerda yangilang." onClose={() => setModal('')}><ContactSettingsForm phone={platformSettings.phone} onSubmit={saveContact} /></Modal>}
    {paymentCompany && <Modal title={`${paymentCompany.name} — to‘lovni qayd etish`} subtitle={`${todayMonth} oyi tarifi: ${money(paymentCompany.currentRate?.amount || 0)}. Ortiqcha to‘lov keyingi oylar uchun avans bo‘lib qoladi.`} onClose={() => setPaymentCompany(null)}><PaymentForm onSubmit={recordPayment} month={todayMonth} /></Modal>}
    {feeCompany && <Modal title={`${feeCompany.name} — oylik tarif`} subtitle="Har bir tarif faqat tanlangan oy uchun amal qiladi." onClose={() => setFeeCompany(null)}><FeeForm month={todayMonth} rate={feeCompany.currentRate} onSubmit={setCompanyFee} /></Modal>}
    {deleteCompany && <Modal title={`${deleteCompany.name} do‘konini o‘chirish`} subtitle="Bu amalni bekor qilib bo‘lmaydi." onClose={() => setDeleteCompany(null)}><ConfirmCompanyRemoval company={deleteCompany} onCancel={() => setDeleteCompany(null)} onConfirm={removeCompany} /></Modal>}
  </Shell>
}

function StoreApp({ user, data, activePage, setActivePage, onRefresh, onLogout, modal, setModal, selected, setSelected, onUserUpdate }) {
  const owner = user.role === 'company_owner'
  const nav = owner
    ? [['overview', 'Umumiy ko‘rinish', FiActivity], ['sales', 'Savdo', FiShoppingCart], ['products', 'Tovarlar va kirim', FiBox], ['history', 'Cheklar va hisobot', FiClock], ['staff', 'Hodimlar va oylik', FiUsers], ['account', 'Hisob sozlamalari', FiShield]]
    : [['overview', 'Umumiy ko‘rinish', FiActivity], ['sales', 'Savdo', FiShoppingCart], ['products', 'Ombor qoldig‘i', FiBox], ['history', 'Cheklar tarixi', FiClock], ['payroll', 'Mening hisobim', FiDollarSign]]
  const products = data.products
  const sales = data.sales
  const employees = data.employees
  const now = useClock()

  useEffect(() => {
    let notified = false
    const timer = window.setInterval(() => {
      onRefresh()
        .then(() => { notified = false })
        .catch((error) => {
          if (!notified) toast.error(error.message)
          notified = true
        })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [onRefresh])

  async function submitProduct(form, editing) {
    await api(editing ? `/api/products/${editing.id}` : '/api/products', {
      method: editing ? 'PATCH' : 'POST',
      body: form,
    })
    toast.success(editing ? 'Tovar yangilandi' : 'Tovar kirimi saqlandi')
    setModal('')
    setSelected(null)
    await onRefresh()
  }
  async function submitStock(form) {
    await api(`/api/products/${selected.id}/stock`, { method: 'POST', body: form })
    toast.success('Tovar kirimi saqlandi')
    setModal('')
    setSelected(null)
    await onRefresh()
  }
  async function submitEmployee(form, editing) {
    await api(editing ? `/api/employees/${editing.id}` : '/api/employees', {
      method: editing ? 'PATCH' : 'POST',
      body: form,
    })
    toast.success(editing ? 'Hodim ma’lumoti yangilandi' : 'Hodim akkaunti yaratildi')
    setModal('')
    setSelected(null)
    await onRefresh()
  }
  async function submitMovement(form) {
    await api(`/api/employees/${selected.id}/movements`, { method: 'POST', body: form })
    toast.success(form.kind === 'advance' ? 'Oylik avansi qayd etildi' : 'Abed puli alohida qayd etildi')
    setModal('')
    setSelected(null)
    await onRefresh()
  }
  async function submitAttendance(employee, status, date) {
    await api(`/api/employees/${employee.id}/attendance`, { method: 'PUT', body: { status, date } })
    toast.success(`${employee.name}: ${status === 'present' ? 'kelgan' : 'kelmagan'} deb qayd etildi`)
    await onRefresh()
  }
  async function removeEmployee() {
    const result = await api(`/api/employees/${selected.id}`, { method: 'DELETE' })
    toast.success(result.message)
    setModal('')
    setSelected(null)
    await onRefresh()
  }

  const heading = nav.find(([id]) => id === activePage)?.[1] || nav[0][1]
  return <Shell user={user} company={data.company} onLogout={onLogout} nav={nav} activePage={activePage} setActivePage={setActivePage}>
    {activePage === 'overview' && <Overview user={user} data={data} onNavigate={setActivePage} />}
    {activePage === 'sales' && <SalesPage user={user} products={products} employees={employees} onSale={async (payload) => {
      const result = await api('/api/sales', { method: 'POST', body: payload })
      toast.success(`Savdo saqlandi · Chek № ${result.sale.receiptNumber}`)
      await onRefresh()
      return result.sale
    }} />}
    {activePage === 'products' && <ProductsPage owner={owner} products={products} onAdd={() => { setSelected(null); setModal('product') }} onStock={(product) => { setSelected(product); setModal('stock') }} onEdit={(product) => { setSelected(product); setModal('editProduct') }} />}
    {activePage === 'history' && <HistoryPage sales={sales} receipts={data.receipts} products={products} owner={owner} employees={employees} />}
    {activePage === 'staff' && owner && <StaffPage employees={employees} movements={data.movements} attendance={data.attendance} sales={sales} month={monthKey(now)} onAdd={() => { setSelected(null); setModal('employee') }} onMovement={(employee, kind) => { setSelected(employee); setModal(kind) }} onEdit={(employee) => { setSelected(employee); setModal('editEmployee') }} onRemove={(employee) => { setSelected(employee); setModal('removeEmployee') }} onAttendance={submitAttendance} />}
    {activePage === 'account' && owner && <AccountSettingsPage user={user} onUserUpdate={onUserUpdate} />}
    {activePage === 'payroll' && !owner && <MyAccountPage user={user} sales={sales} movements={data.movements} month={monthKey(now)} />}
    {!nav.some(([id]) => id === activePage) && <PageHeading eyebrow="DO‘KON" title={heading} description="Ushbu bo‘lim mavjud emas." />}
    {modal === 'product' && <Modal title="Yangi tovar kirimi" subtitle="Kelgan miqdor, sotuv narxi va eng past ruxsat etilgan narxni belgilang." onClose={() => setModal('')}><ProductForm onSubmit={(form) => submitProduct(form, null)} /></Modal>}
    {modal === 'editProduct' && selected && <Modal title="Tovarni tahrirlash" subtitle="Narx chegarasi do‘kondagi barcha sotuvchilarga bir xil qo‘llanadi." onClose={() => setModal('')}><ProductForm product={selected} onSubmit={(form) => submitProduct(form, selected)} /></Modal>}
    {modal === 'stock' && selected && <Modal title={`${selected.name} — yangi kirim`} subtitle={`Joriy qoldiq: ${quantityLabel(selected)}`} onClose={() => setModal('')}><StockForm product={selected} onSubmit={submitStock} /></Modal>}
    {modal === 'employee' && <Modal title="Yangi hodim qo‘shish" subtitle="Login faqat shu do‘konda ishlaydi. Oylik avanslari maosh hisobidan ayriladi." onClose={() => setModal('')}><EmployeeForm onSubmit={(form) => submitEmployee(form, null)} /></Modal>}
    {modal === 'editEmployee' && selected && <Modal title={`${selected.name} ma’lumotlari`} subtitle="Hodim ismi va oylik miqdorini yangilang." onClose={() => setModal('')}><EmployeeForm employee={selected} onSubmit={(form) => submitEmployee(form, selected)} /></Modal>}
    {(modal === 'advance' || modal === 'abed') && selected && <Modal title={modal === 'advance' ? `${selected.name} — oylik avansi` : `${selected.name} — Abed puli`} subtitle={modal === 'advance' ? 'Avans joriy oylikdan ushlab qolinadi.' : 'Abed alohida tarixda saqlanadi va oylikdan ayrilmaydi.'} onClose={() => setModal('')}><MovementForm kind={modal} month={monthKey(now)} onSubmit={submitMovement} /></Modal>}
    {modal === 'removeEmployee' && selected && <Modal title={`${selected.name}ni butunlay chiqarish`} subtitle="Hodim akkauntini va tegishli yozuvlarini o‘chirish qaytarilmaydi." onClose={() => setModal('')}><ConfirmEmployeeRemoval onCancel={() => setModal('')} onConfirm={removeEmployee} /></Modal>}
  </Shell>
}

function AccountSettingsPage({ user, onUserUpdate }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const newPassword = form.get('newPassword')
    if (newPassword && newPassword !== form.get('confirmPassword')) {
      setError('Yangi parollar bir xil emas.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await api('/api/account/credentials', {
        method: 'PATCH',
        body: {
          currentPassword: form.get('currentPassword'),
          login: form.get('login'),
          ...(newPassword ? { newPassword } : {}),
        },
      })
      onUserUpdate(result.user)
      formElement.reset()
      formElement.elements.login.value = result.user.login
      toast.success('Kirish ma’lumotlari xavfsiz saqlandi')
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSaving(false)
    }
  }
  return <>
    <PageHeading eyebrow="AKKAUNT XAVFSIZLIGI" title="Hisob sozlamalari" description="Do‘kon boshlig‘i loginini va parolini yangilang." />
    <section className="panel account-settings">
      <form className="modal-form" onSubmit={submit}>
        <Field label="Yangi login yoki email"><input name="login" type="text" autoComplete="username" required minLength="3" maxLength="254" defaultValue={user.login} /></Field>
        <Field label="Joriy parol"><PasswordInput name="currentPassword" autoComplete="current-password" required /></Field>
        <div className="field-row">
          <Field label="Yangi parol"><PasswordInput name="newPassword" autoComplete="new-password" minLength="10" maxLength="200" placeholder="O‘zgartirmasangiz bo‘sh qoldiring" /></Field>
          <Field label="Yangi parolni takrorlang"><PasswordInput name="confirmPassword" autoComplete="new-password" minLength="10" maxLength="200" /></Field>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="security-note">Parol ochiq matn ko‘rinishida saqlanmaydi. Yangisi himoyalangan xesh ko‘rinishida bazaga yoziladi.</div>
        <div className="modal-actions"><button className="button button-primary" disabled={saving}>{saving ? 'Saqlanmoqda...' : 'O‘zgarishlarni saqlash'} <FiCheck /></button></div>
      </form>
    </section>
  </>
}

function Shell({ user, company, onLogout, nav, activePage, setActivePage, platform = false, children }) {
  const now = useClock()
  const remainingMinutes = company?.isDemo ? Math.max(0, Math.ceil((new Date(company.demoExpiresAt).getTime() - now.getTime()) / 60_000)) : 0
  const demoTimeLeft = `${Math.floor(remainingMinutes / 60)} soat ${remainingMinutes % 60} daqiqa`
  return <div className="app-shell">
    <aside className="sidebar">
      <a href="#" className="brand" onClick={(event) => { event.preventDefault(); if (setActivePage) setActivePage(platform ? undefined : 'overview') }}>
        <img className="brand-symbol" src="/yemzor-logo.png" alt="" /><span><strong>Yemzor</strong><small>{platform ? 'PLATFORMA BOSHQARUVI' : 'SAVDO HISOBI'}</small></span>
      </a>
      <div className="side-caption">{platform ? 'BOSHQARUV' : company?.name || 'DO‘KON'}</div>
      {nav && <nav className="side-nav" aria-label="Asosiy menyu">{nav.map(([id, label, Icon]) => <button key={id} className={`nav-link ${activePage === id ? 'active' : ''}`} onClick={() => setActivePage(id)}><Icon /><span>{label}</span><FiChevronRight className="nav-chevron" /></button>)}</nav>}
      {platform && <div className="platform-note"><FiBriefcase /><span>Kompaniyalar bir-birining savdo va ombor ma’lumotlarini ko‘ra olmaydi.</span></div>}
      <div className="sidebar-spacer" />
      <div className="sidebar-user"><div className="avatar">{(user.name || 'Y').slice(0, 1).toUpperCase()}</div><div><strong>{user.name}</strong><span>{user.role === 'platform_admin' ? 'Platforma egasi' : user.role === 'company_owner' ? 'Do‘kon boshlig‘i' : 'Hodim'}</span></div></div>
      <button className="logout-button" onClick={onLogout}><FiLogOut /> Chiqish</button>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="topbar-context"><span>{platform ? 'Yemzor' : company?.name}</span><FiChevronRight /><strong>{platform ? 'Boshqaruv' : nav?.find(([id]) => id === activePage)?.[1] || 'Umumiy ko‘rinish'}</strong></div><div className="topbar-right"><span className="today-label">{new Intl.DateTimeFormat('uz-UZ', { dateStyle: 'medium' }).format(now)}</span>{company?.isDemo ? <span className="status-pill status-pending demo-countdown">Demo · {demoTimeLeft}</span> : <span className="online-state"><i /> Tizim faol</span>}</div></header>
      <div className="page-content">{children}</div>
    </main>
  </div>
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function Metric({ label, value, detail, icon: Icon, tone = '' }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}><Icon /></span><span className="metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function Overview({ user, data, onNavigate }) {
  const now = useClock()
  const month = monthKey(now)
  const today = dayKey(now)
  const sales = data.sales
  const receipts = data.receipts
  const todays = sales.filter((sale) => dayKey(new Date(sale.createdAt)) === today)
  const weekly = sales.filter((sale) => new Date(sale.createdAt) >= startOfWeek(now))
  const monthly = sales.filter((sale) => monthKey(new Date(sale.createdAt)) === month)
  const todayReceipts = receipts.filter((receipt) => dayKey(new Date(receipt.createdAt)) === today)
  const weeklyReceipts = receipts.filter((receipt) => new Date(receipt.createdAt) >= startOfWeek(now))
  const monthlyReceipts = receipts.filter((receipt) => monthKey(new Date(receipt.createdAt)) === month)
  const stock = data.products.reduce((count, product) => count + Number(product.quantity), 0)
  const recent = sales.slice(0, 5)
  return <>
    <PageHeading eyebrow={new Intl.DateTimeFormat('uz-UZ', { dateStyle: 'full' }).format(now)} title={`Xayrli kun, ${user.name.split(' ')[0]}!`} description="Bugungi savdo va ombor holati bilan tanishing." action={<button className="button button-primary" onClick={() => onNavigate('sales')}><FiShoppingCart /> Savdo boshlash</button>} />
    <div className="metric-grid">
      <Metric label="Bugungi tushum" value={money(amountSum(todays))} detail={`${todays.length} ta chek`} icon={FiArrowUpRight} tone="green" />
      <Metric label="Haftalik tushum" value={money(amountSum(weekly))} detail="Dushanbadan bugungacha" icon={FiCalendar} tone="blue" />
      <Metric label="Oylik tushum" value={money(amountSum(monthly))} detail={month} icon={FiDollarSign} tone="amber" />
      <Metric label="Bugungi kirim" value={money(amountSum(todayReceipts))} detail={`${todayReceipts.length} ta kirim · ${today}`} icon={FiArrowDownLeft} tone="blue" />
      <Metric label="Haftalik kirim" value={money(amountSum(weeklyReceipts))} detail={`${weeklyReceipts.length} ta kirim`} icon={FiArrowDownLeft} tone="violet" />
      <Metric label="Oylik kirim" value={money(amountSum(monthlyReceipts))} detail={`${monthlyReceipts.length} ta kirim · ${month}`} icon={FiArrowDownLeft} tone="amber" />
      <Metric label="Ombor qoldig‘i" value={stock.toLocaleString('uz-UZ')} detail={`${data.products.length} xil tovar`} icon={FiBox} tone="violet" />
    </div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-head"><div><h2>Ombor qoldiqlari</h2><p>Barcha xodimlarda bir xil ko‘rinadigan jonli qoldiq</p></div><button className="text-button" onClick={() => onNavigate('products')}>Omborga o‘tish <FiArrowUpRight /></button></div><ProductTable products={data.products.slice(0, 6)} readOnly /></section>
      <section className="panel"><div className="panel-head"><div><h2>So‘nggi cheklar</h2><p>Yaqinda rasmiylashtirilgan savdolar</p></div><button className="icon-button" onClick={() => onNavigate('history')} aria-label="Cheklar tarixini ochish"><FiArrowUpRight /></button></div>{recent.length ? <div className="recent-list">{recent.map((sale) => <div className="recent-row" key={sale.id}><span className="recent-icon"><FiShoppingCart /></span><div className="recent-main"><strong>Chek № {sale.receiptNumber}</strong><small>{sale.sellerName} · {dateTime(sale.createdAt)}</small></div><b>{money(sale.total)}</b></div>)}</div> : <Empty title="Hozircha savdo yo‘q" text="Birinchi savdoni boshlang." />}</section>
    </div>
  </>
}

function ProductsPage({ owner, products, onAdd, onStock, onEdit }) {
  const [query, setQuery] = useState('')
  const filtered = products.filter((product) => product.name.toLocaleLowerCase('uz').includes(query.toLocaleLowerCase('uz')))
  return <>
    <PageHeading eyebrow="OMBOR NAZORATI" title={owner ? 'Tovarlar va kirim' : 'Ombor qoldig‘i'} description={owner ? 'Tovar kiriting, kelgan mahsulotni qo‘shing va sotuv narxini boshqaring.' : 'Barcha xodimlar uchun umumiy ombor qoldig‘i.'} action={owner && <button className="button button-primary" onClick={onAdd}><FiPlus /> Yangi tovar kirimi</button>} />
    <section className="panel"><div className="panel-head"><div><h2>Mahsulotlar</h2><p>{products.length} xil tovar</p></div><label className="search-box"><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tovar nomini qidirish" /></label></div><ProductTable products={filtered} owner={owner} onStock={onStock} onEdit={onEdit} /></section>
  </>
}

function ProductTable({ products, owner, onStock, onEdit, readOnly }) {
  if (!products.length) return <Empty title="Tovarlar hali qo‘shilmagan" text={owner ? 'Birinchi mahsulotni kirim qiling.' : 'Boshliq hali mahsulot kiritmagan.'} />
  return <div className="table-wrap"><table><thead><tr><th>TOVAR</th><th>OMBORDA</th><th>SOTUV NARXI</th><th>MIN. NARX</th>{owner && !readOnly && <th>AMALLAR</th>}</tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className="product-cell"><span className="product-mark">{product.name.trim().slice(0, 1).toUpperCase()}</span><div><strong>{product.name}</strong><small>{product.unit === 'bag' ? 'Qop hisobida' : 'Vazn, kg hisobida'}</small></div></div></td><td><strong>{quantityLabel(product)}</strong>{product.quantity <= 0 && <span className="stock-empty">Tugagan</span>}</td><td>{money(product.price)} <small>/ {product.unit === 'bag' ? 'qop' : 'kg'}</small></td><td>{money(product.minimumPrice)} <small>dan yuqori</small></td>{owner && !readOnly && <td><div className="table-actions"><button className="button button-tertiary button-small" onClick={() => onStock(product)}><FiPlus /> Kirim</button><button className="button button-tertiary button-small" onClick={() => onEdit(product)}>Narxni tahrirlash</button></div></td>}</tr>)}</tbody></table></div>
}

function SalesPage({ user, products, employees, onSale }) {
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([])
  const [sellerId, setSellerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const owner = user.role === 'company_owner'
  const available = products.filter((item) => item.quantity > 0 && item.name.toLocaleLowerCase('uz').includes(query.toLocaleLowerCase('uz')))
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  function add(product) {
    setCart((current) => {
      const found = current.find((item) => item.productId === product.id)
      return found
        ? current.map((item) => item.productId === product.id ? { ...item, quantity: Math.min(item.quantity + (product.unit === 'bag' ? 1 : 0), product.quantity) } : item)
        : [...current, { productId: product.id, name: product.name, unit: product.unit, quantity: product.unit === 'bag' ? 1 : 1, price: product.price, maximum: product.price, minimum: product.minimumPrice, stock: product.quantity }]
    })
  }
  function update(productId, key, value) {
    setCart((current) => current.map((item) => item.productId === productId ? { ...item, [key]: value } : item))
  }
  async function checkout() {
    if (!cart.length || cart.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > item.stock || (item.unit === 'bag' && !Number.isSafeInteger(item.quantity)) || item.price <= item.minimum || item.price > item.maximum)) return
    setSaving(true)
    try {
      const payload = { items: cart.map(({ productId, quantity, price }) => ({ productId, quantity, price })) }
      if (owner && sellerId) payload.sellerId = sellerId
      setReceipt(await onSale(payload))
      setCart([])
      setSellerId('')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const canCheckout = cart.length > 0 && cart.every((item) => item.quantity > 0 && item.quantity <= item.stock && item.price > item.minimum && item.price <= item.maximum && (item.unit !== 'bag' || Number.isSafeInteger(item.quantity)))
  return <>
    <PageHeading eyebrow="SAVDO KASSASI" title="Yangi savdo" description="Tovar qidiring, narxni belgilang va bitta chekda rasmiylashtiring." />
    <div className="sales-layout">
      <section className="panel catalog-panel">
        <label className="search-box search-large"><FiSearch /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tovar nomini qidiring..." /></label>
        <div className="catalog-meta"><span>SOTUV UCHUN MAVJUD</span><span>{available.length} ta</span></div>
        <div className="catalog-list">{available.length ? available.map((product) => <button className="catalog-item" key={product.id} onClick={() => add(product)}><span className="product-mark">{product.name.slice(0, 1).toUpperCase()}</span><span className="catalog-info"><strong>{product.name}</strong><small>{quantityLabel(product)} mavjud</small></span><span className="catalog-price"><strong>{money(product.price)}</strong><small>/{product.unit === 'bag' ? 'qop' : 'kg'}</small></span><span className="catalog-add"><FiPlus /></span></button>) : <Empty title={query ? 'Tovar topilmadi' : 'Sotishga tovar yo‘q'} text={query ? 'Boshqa so‘z bilan qidiring.' : 'Omborga kirim qilgach mahsulotlar ko‘rinadi.'} />}</div>
      </section>
      <section className="panel cart-panel">
        <div className="panel-head"><div><h2>Savdo savati</h2><p>{cart.length} ta mahsulot</p></div><span className="cart-symbol"><FiShoppingCart /></span></div>
        {owner && <Field label="Sotuvni rasmiylashtirayotgan hodim"><select value={sellerId} onChange={(event) => setSellerId(event.target.value)}><option value="">Boshliq</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></Field>}
        {cart.length ? <div className="cart-items">{cart.map((item) => <div className="cart-row" key={item.productId}>
          <div className="cart-product"><strong>{item.name}</strong><small>Ruxsat etilgan narx: {money(item.minimum + 1)} – {money(item.maximum)}</small></div>
          <div className="cart-inputs"><label><span>{item.unit === 'bag' ? 'Qop' : 'Kg'}</span><input type="number" min={item.unit === 'bag' ? 1 : 0.001} step={item.unit === 'bag' ? 1 : 0.001} max={item.stock} value={item.quantity} onChange={(event) => update(item.productId, 'quantity', Number(event.target.value))} /></label><label><span>Narxi</span><input type="text" inputMode="numeric" value={numberInput(item.price)} onChange={(event) => update(item.productId, 'price', readNumber(event.target.value))} /></label></div>
          <div className="cart-line-total">{money(item.price * item.quantity)}<small>so‘m</small></div><button className="icon-button" onClick={() => setCart((current) => current.filter((entry) => entry.productId !== item.productId))} aria-label={`${item.name}ni olib tashlash`}><FiX /></button>
        </div>)}</div> : <Empty title="Savat bo‘sh" text="Chap tomondan tovar tanlang." />}
        <div className="cart-footer"><div className="total-line"><span>Jami</span><strong>{money(total)}</strong></div><button className="button button-primary button-wide" disabled={!canCheckout || saving} onClick={checkout}>{saving ? 'Saqlanmoqda...' : <><FiCheck /> Savdoni saqlash va chek</>}</button><small>Yakunlashda narx va ombor qoldig‘i serverda tekshiriladi.</small></div>
      </section>
    </div>
    {receipt && <Modal title={`Chek № ${receipt.receiptNumber}`} subtitle={`Sana: ${dateTime(receipt.createdAt)} · Sotuvchi: ${receipt.sellerName}`} onClose={() => setReceipt(null)}><Receipt sale={receipt} /></Modal>}
  </>
}

function Receipt({ sale }) {
  return <div className="receipt">
    <div className="receipt-brand"><img className="brand-symbol" src="/yemzor-logo.png" alt="" /><strong>Yemzor</strong></div>
    <p className="receipt-number">CHEK № {sale.receiptNumber}</p>
    <div className="receipt-lines">{sale.items.map((item, index) => <div className="receipt-line" key={`${item.productId}-${index}`}><span>{item.name}<small>{item.quantity} {item.unit === 'bag' ? 'qop' : 'kg'} × {money(item.price)}</small></span><b>{money(item.lineTotal)}</b></div>)}</div>
    <div className="total-line"><span>Jami</span><strong>{money(sale.total)}</strong></div>
    <button className="button button-secondary button-wide no-print" onClick={() => window.print()}><FiPrinter /> Chekni chop etish</button>
  </div>
}

function HistoryPage({ sales, receipts, products, owner, employees }) {
  const now = useClock()
  const [period, setPeriod] = useState('month')
  const [selectedDate, setSelectedDate] = useState(() => dayKey(now))
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(now))
  const [lookup, setLookup] = useState('')
  const filteredSales = sales.filter((sale) => {
    const date = new Date(sale.createdAt)
    if (period === 'today') return dayKey(date) === dayKey(now)
    if (period === 'week') return date >= startOfWeek(now)
    if (period === 'month') return monthKey(date) === monthKey(now)
    if (period === 'date') return dayKey(date) === selectedDate
    return true
  })
  const receipt = sales.find((sale) => sale.receiptNumber === lookup.trim().replace(/\D/g, '').padStart(6, '0'))
  const monthlyReceipts = receipts.filter((entry) => monthKey(new Date(entry.createdAt)) === selectedMonth)
  const monthlySales = sales.filter((entry) => monthKey(new Date(entry.createdAt)) === selectedMonth)
  const periodReceipts = receipts.filter((entry) => {
    const date = new Date(entry.createdAt)
    if (period === 'today') return dayKey(date) === dayKey(now)
    if (period === 'week') return date >= startOfWeek(now)
    if (period === 'month') return monthKey(date) === monthKey(now)
    if (period === 'date') return dayKey(date) === selectedDate
    return true
  })
  const report = new Map()
  for (const item of monthlyReceipts) {
    const key = item.productId
    const row = report.get(key) || { name: item.name, unit: item.unit, incoming: 0, incomingValue: 0, sold: 0, soldValue: 0 }
    row.incoming += item.quantity
    row.incomingValue += item.total
    report.set(key, row)
  }
  for (const sale of monthlySales) for (const line of sale.items) {
    const key = line.productId
    const row = report.get(key) || { name: line.name, unit: line.unit, incoming: 0, incomingValue: 0, sold: 0, soldValue: 0 }
    row.sold += line.quantity
    row.soldValue += line.lineTotal
    report.set(key, row)
  }
  const reportRows = [...report.values()].sort((a, b) => a.name.localeCompare(b.name, 'uz'))
  const periods = [['today', 'Bugun'], ['week', 'Hafta'], ['month', 'Oy'], ['date', 'Sana'], ['all', 'Hammasi']]
  return <>
    <PageHeading eyebrow="SAVDO VA KIRIM HISOBOTI" title="Cheklar va hisobot" description="Chek raqamini tekshiring, tushum va oylik tovar harakatini ko‘ring." />
    <section className="panel report-panel">
      <div className="lookup-row"><div><h2>Chekni tekshirish</h2><p>Chek raqami orqali sotilgan mahsulot va narxini toping.</p></div><label className="search-box"><FiSearch /><input inputMode="numeric" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="Masalan, 000123" /></label></div>
      {lookup && (receipt ? <Receipt sale={receipt} /> : <p className="not-found">Bu do‘konda ushbu chek raqami topilmadi.</p>)}
      <div className="report-toolbar"><div className="segmented">{periods.map(([value, label]) => <button key={value} className={period === value ? 'selected' : ''} onClick={() => setPeriod(value)}>{label}</button>)}</div>{period === 'date' && <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />}</div>
      <div className="report-summary"><Metric label="Tanlangan davr tushumi" value={money(amountSum(filteredSales))} detail={`${filteredSales.length} ta chek`} icon={FiDollarSign} tone="green" /><Metric label="Tanlangan davr kirimi" value={movementQuantity(periodReceipts)} detail={money(amountSum(periodReceipts))} icon={FiArrowDownLeft} tone="blue" /><Metric label="Mahsulot turlari" value={products.length} detail="Ombordagi jami" icon={FiBox} tone="violet" /></div>
      <div className="panel-head report-title"><div><h2>Oylik kelim va sotuv</h2><p>Har bir tovar bo‘yicha kelgan va sotilgan miqdor hamda qiymati</p></div><input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></div>
      {reportRows.length ? <div className="table-wrap"><table><thead><tr><th>TOVAR</th><th>KELDI</th><th>KIRIM QIYMATI</th><th>SOTILDI</th><th>SOTUV TUSHUMI</th></tr></thead><tbody>{reportRows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.incoming.toLocaleString('uz-UZ')} {row.unit === 'bag' ? 'qop' : 'kg'}</td><td>{money(row.incomingValue)}</td><td>{row.sold.toLocaleString('uz-UZ')} {row.unit === 'bag' ? 'qop' : 'kg'}</td><td>{money(row.soldValue)}</td></tr>)}</tbody></table></div> : <Empty title="Bu oyda harakat yo‘q" text="Tanlangan oydagi kirim va savdolar shu yerda jamlanadi." />}
      <div className="panel-head report-title"><div><h2>Mahsulot kirimlari tarixi</h2><p>{periodReceipts.length} ta kirim · tanlangan davr va kelgan sanasi bo‘yicha</p></div></div>
      {periodReceipts.length ? <div className="table-wrap"><table><thead><tr><th>KELGAN SANA</th><th>TOVAR</th><th>MIQDOR</th><th>BIRLIK NARXI</th><th>JAMI</th></tr></thead><tbody>{[...periodReceipts].sort((first, second) => second.createdAt.localeCompare(first.createdAt)).map((entry) => <tr key={entry.id}><td>{dateTime(entry.createdAt)}</td><td><strong>{entry.name}</strong></td><td>{Number(entry.quantity).toLocaleString('uz-UZ', { maximumFractionDigits: 3 })} {entry.unit === 'bag' ? 'qop' : 'kg'}</td><td>{money(entry.price)}</td><td><strong>{money(entry.total)}</strong></td></tr>)}</tbody></table></div> : <Empty title="Tanlangan davrda kirim yo‘q" text="Tovar qo‘shilganda kirim summasi va sanasi shu yerda saqlanadi." />}
      <div className="panel-head report-title"><div><h2>Savdo cheklari</h2><p>{filteredSales.length} ta savdo · sotuvchi va vaqt bo‘yicha</p></div></div>
      {filteredSales.length ? <div className="table-wrap"><table><thead><tr><th>CHEK</th><th>SOTUVCHI</th><th>TOVARLAR</th><th>SANA</th><th>JAMI</th></tr></thead><tbody>{filteredSales.map((sale) => <tr key={sale.id}><td><strong>№ {sale.receiptNumber}</strong></td><td>{sale.sellerName}</td><td>{sale.items.map((item) => `${item.name} × ${item.quantity} ${item.unit === 'bag' ? 'qop' : 'kg'}`).join(', ')}</td><td>{dateTime(sale.createdAt)}</td><td><strong>{money(sale.total)}</strong></td></tr>)}</tbody></table></div> : <Empty title="Cheklar topilmadi" text="Tanlangan davrda savdo yo‘q." />}
      {owner && employees.length > 0 && <div className="seller-totals"><strong>Tanlangan davr sotuvchilari</strong>{employees.map((employee) => <span key={employee.id}>{employee.name}: {money(amountSum(filteredSales.filter((sale) => sale.sellerId === employee.id)))}</span>)}</div>}
    </section>
  </>
}

function StaffPage({ employees, movements, attendance, sales, month, onAdd, onMovement, onEdit, onRemove, onAttendance }) {
  const now = useClock()
  const [attendanceDate, setAttendanceDate] = useState(() => dayKey(now))
  const payroll = (employee) => {
    const advances = movements.filter((item) => item.employeeId === employee.id && item.period === month && item.kind === 'advance').reduce((sum, item) => sum + item.amount, 0)
    const abed = movements.filter((item) => item.employeeId === employee.id && item.period === month && item.kind === 'abed').reduce((sum, item) => sum + item.amount, 0)
    const abedTotal = movements.filter((item) => item.employeeId === employee.id && item.kind === 'abed').reduce((sum, item) => sum + item.amount, 0)
    return { advances, abed, abedTotal, remaining: Math.max(employee.monthlySalary - advances, 0) }
  }
  return <>
    <PageHeading eyebrow="JAMOA VA OYLIK" title="Hodimlar" description="Har bir xodimning loginini, oyligini, avansini va Abed pulini alohida kuzating." action={<button className="button button-primary" onClick={onAdd}><FiPlus /> Hodim qo‘shish</button>} />
    <section className="panel"><div className="panel-head"><div><h2>Jamoa</h2><p>Oylik hisob davri: {month}</p></div><label className="attendance-date">Davomat sanasi<input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} /></label><span className="count-pill">{employees.length} hodim</span></div>{employees.length ? <div className="staff-grid">{employees.map((employee) => {
      const values = payroll(employee)
      const employeeSales = sales.filter((sale) => sale.sellerId === employee.id && monthKey(new Date(sale.createdAt)) === month)
      const todayStatus = attendance.find((item) => item.employeeId === employee.id && item.date === attendanceDate)?.status
      return <article className="staff-card" key={employee.id}>
        <div className="staff-card-head"><span className="avatar avatar-green">{employee.name.slice(0, 1).toUpperCase()}</span><div><h3>{employee.name}</h3><span>@{employee.login}</span></div><button className="text-button" onClick={() => onEdit(employee)}>Tahrirlash</button><button className="button button-danger button-small" onClick={() => onRemove(employee)}><FiTrash2 /> Chiqarish</button></div>
        <div className="attendance-control"><span className={`attendance-status ${todayStatus || 'unmarked'}`}>{todayStatus === 'present' ? 'Keldi' : todayStatus === 'absent' ? 'Kelmadi' : 'Qayd etilmagan'}</span><button className={`button button-small ${todayStatus === 'present' ? 'button-primary' : 'button-secondary'}`} aria-label={`${employee.name}: keldi deb belgilash`} onClick={() => onAttendance(employee, 'present', attendanceDate)}>Keldi</button><button className={`button button-small ${todayStatus === 'absent' ? 'button-danger' : 'button-secondary'}`} aria-label={`${employee.name}: kelmadi deb belgilash`} onClick={() => onAttendance(employee, 'absent', attendanceDate)}>Kelmadi</button></div>
        <div className="staff-stats"><div><small>Oylik</small><strong>{money(employee.monthlySalary)}</strong></div><div><small>Avans</small><strong className="text-danger">{money(values.advances)}</strong></div><div><small>Qolgan oylik</small><strong className="text-green">{money(values.remaining)}</strong></div><div><small>Abed puli jami · shu oy {money(values.abed)}</small><strong>{money(values.abedTotal)}</strong></div></div>
        <div className="staff-sales"><span>Oy savdosi</span><strong>{money(amountSum(employeeSales))}</strong></div>
        <div className="table-actions"><button className="button button-secondary button-small" onClick={() => onMovement(employee, 'advance')}><FiDollarSign /> Avans berish</button><button className="button button-tertiary button-small" onClick={() => onMovement(employee, 'abed')}>Abed pulini qayd etish</button></div>
      </article>
    })}</div> : <Empty title="Hodimlar hali qo‘shilmagan" text="Boshqa foydalanuvchilarga kirish berish uchun hodim qo‘shing." />}</section>
    <section className="panel"><div className="panel-head"><div><h2>To‘lovlar tarixi</h2><p>Avans oylikdan ushlanadi; har kunlik Abed puli esa alohida yig‘ilib boradi.</p></div></div>{movements.length ? <div className="table-wrap"><table><thead><tr><th>HODIM</th><th>TURI</th><th>HISOB OYI</th><th>BERILGAN SANA</th><th>SUMMA</th></tr></thead><tbody>{[...movements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((movement) => <tr key={movement.id}><td>{movement.employeeName}</td><td><span className={`status-pill ${movement.kind === 'advance' ? 'status-pending' : 'status-paid'}`}>{movement.kind === 'advance' ? 'Oylik avansi' : 'Abed puli'}</span></td><td>{movement.period}</td><td>{movement.date || dateTime(movement.createdAt)}</td><td><strong>{money(movement.amount)}</strong></td></tr>)}</tbody></table></div> : <Empty title="Hali to‘lov qayd etilmagan" text="Ishchiga berilgan avans va Abed pullari shu jadvalda turadi." />}</section>
  </>
}

function ConfirmEmployeeRemoval({ onCancel, onConfirm }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setSaving(true)
    setError('')
    try {
      await onConfirm()
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="remove-confirm-content"><p className="remove-warning">Xodim akkaunti, davomat, oylik avanslari va Abed yozuvlari o‘chadi. U ilgari sotgan tovarlari hamda chek tarixi saqlanadi.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-secondary" disabled={saving} onClick={onCancel}>Bekor qilish</button><button className="button button-danger" disabled={saving} onClick={confirm}><FiTrash2 /> {saving ? 'O‘chirilmoqda...' : 'Butunlay chiqarish'}</button></div></div>
}

function ConfirmCompanyRemoval({ company, onCancel, onConfirm }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setSaving(true)
    setError('')
    try {
      await onConfirm()
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="remove-confirm-content">
    <p className="remove-warning"><strong>{company.name}</strong> bilan birga uning boshliq va hodim akkauntlari, tovarlari, cheklari, to‘lovlari, tariflari va barcha hisobotlari butunlay o‘chiriladi. Saqlab qolish uchun oldin `database.json` faylining zaxira nusxasini oling.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button button-secondary" disabled={saving} onClick={onCancel}>Bekor qilish</button><button className="button button-danger" disabled={saving} onClick={confirm}><FiTrash2 /> {saving ? 'O‘chirilmoqda...' : 'Do‘konni butunlay o‘chirish'}</button></div>
  </div>
}

function MyAccountPage({ user, sales, movements, month }) {
  const advances = movements.filter((item) => item.period === month && item.kind === 'advance').reduce((sum, item) => sum + item.amount, 0)
  const abed = movements.filter((item) => item.period === month && item.kind === 'abed').reduce((sum, item) => sum + item.amount, 0)
  const abedTotal = movements.filter((item) => item.kind === 'abed').reduce((sum, item) => sum + item.amount, 0)
  const ownSales = sales.filter((sale) => sale.sellerId === user.id && monthKey(new Date(sale.createdAt)) === month)
  return <>
    <PageHeading eyebrow="SHAXSIY HISOB" title={`Salom, ${user.name}`} description="Sizga tegishli oylik va savdo ma’lumotlari." />
    <div className="metric-grid"><Metric label="Oylik maosh" value={money(user.monthlySalary)} detail={month} icon={FiDollarSign} tone="green" /><Metric label="Olingan avans" value={money(advances)} detail="Oylikdan ushlanadi" icon={FiArrowDownLeft} tone="amber" /><Metric label="Qolgan oylik" value={money(Math.max(user.monthlySalary - advances, 0))} detail="Abed pulini o‘z ichiga olmaydi" icon={FiCheck} tone="blue" /><Metric label="Abed puli jami" value={money(abedTotal)} detail={`Shu oy: ${money(abed)} · oylikdan ayrilmaydi`} icon={FiBriefcase} tone="violet" /></div>
    <section className="panel"><div className="panel-head"><div><h2>Shu oydagi savdolarim</h2><p>{ownSales.length} ta chek · {month}</p></div><strong>{money(amountSum(ownSales))}</strong></div>{ownSales.length ? <div className="table-wrap"><table><thead><tr><th>CHEK</th><th>SANA</th><th>TOVARLAR</th><th>JAMI</th></tr></thead><tbody>{ownSales.map((sale) => <tr key={sale.id}><td>№ {sale.receiptNumber}</td><td>{dateTime(sale.createdAt)}</td><td>{sale.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}</td><td>{money(sale.total)}</td></tr>)}</tbody></table></div> : <Empty title="Hozircha savdo yo‘q" text="Savdolaringiz shu yerda ko‘rinadi." />}</section>
  </>
}

function AccessForm({ onSubmit, children, submitLabel = 'Saqlash' }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try { await onSubmit(new FormData(event.currentTarget)) } catch (cause) {
      setError(cause.message)
    } finally { setSaving(false) }
  }
  return <form className="modal-form" onSubmit={submit}>{children}{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-primary" disabled={saving}>{saving ? 'Saqlanmoqda...' : submitLabel} <FiCheck /></button></div></form>
}

function CompanyForm({ month, onSubmit }) {
  return <AccessForm onSubmit={(form) => onSubmit({ name: form.get('name'), ownerName: form.get('ownerName'), login: form.get('login'), password: form.get('password'), monthlyFee: readNumber(form.get('monthlyFee')) })} submitLabel="Do‘kon yaratish">
    <Field label="Do‘kon yoki brend nomi"><input name="name" required minLength="2" maxLength="80" placeholder="Masalan, Baraka Yem" /></Field>
    <Field label="Do‘kon boshlig‘i"><input name="ownerName" required minLength="2" maxLength="80" placeholder="Ism-familiya" /></Field>
    <Field label="Boshliq login"><input name="login" autoComplete="off" required minLength="3" maxLength="40" placeholder="Faqat shu do‘kon uchun" /></Field>
    <Field label="Boshlang‘ich parol"><PasswordInput name="password" autoComplete="new-password" required minLength="10" placeholder="Kamida 10 ta belgi" /></Field>
    <Field label={`${month} oyi uchun tarif`}><MoneyField name="monthlyFee" required /><span className="field-hint">Tarif faqat shu oy amal qiladi. Keyingi oy uchun yangi tarif belgilanadi.</span></Field>
    <p className="security-note">Login va parol yaratilgach boshliqqa xavfsiz tarzda yetkazing. Xodimlar loginini shu do‘kon boshlig‘i yaratadi.</p>
  </AccessForm>
}

function FeeForm({ month, rate, onSubmit }) {
  const [period, setPeriod] = useState(month)
  return <AccessForm onSubmit={(form) => onSubmit({ period, monthlyFee: readNumber(form.get('monthlyFee')) })} submitLabel="Tarifni saqlash">
    <Field label="Tarif amal qiladigan oy"><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} required /></Field>
    <Field label={`${period} oyi uchun narx`}><MoneyField key={`${period}-${rate?.amount || 0}`} name="monthlyFee" defaultValue={rate?.period === period ? rate.amount : ''} required /></Field>
    <p className="security-note">Bu narx faqat tanlangan oy uchun. Keyingi oyga o‘tkazilmaydi, ammo ortiqcha to‘langan pul balans sifatida saqlanib qoladi.</p>
  </AccessForm>
}

function PaymentForm({ month, onSubmit }) {
  const [period, setPeriod] = useState(month)
  return <AccessForm onSubmit={(form) => onSubmit({ period, amount: readNumber(form.get('amount')) })} submitLabel="To‘lovni qayd etish">
    <Field label="Qaysi oy uchun to‘lov"><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} required /></Field>
    <Field label="Haqiqiy qabul qilingan summa"><MoneyField name="amount" required /><span className="field-hint">Oylik tarifdan ortiq qismi keyingi oylar uchun balans bo‘lib qoladi.</span></Field>
    <label className="payment-confirm"><input name="confirmed" type="checkbox" required /><span>Pul haqiqatda qabul qilinganini tasdiqlayman.</span></label>
    <p className="security-note">Bu amal pul o‘tkazmaydi. To‘lov kelib tushganidan keyin platforma egasi uni qo‘lda qayd qiladi.</p>
  </AccessForm>
}

function ContactSettingsForm({ phone, onSubmit }) {
  return <AccessForm onSubmit={(form) => onSubmit({ phone: form.get('phone') })} submitLabel="Raqamni saqlash">
    <Field label="Bog‘lanish telefoni"><input name="phone" type="tel" defaultValue={phone} placeholder="+998 90 123 45 67" maxLength="24" /></Field>
    <p className="security-note">Raqam Yemzor’ning ommaviy landing sahifasındaki bog‘lanish bo‘limida ko‘rinadi. Telegram: @naziroff1</p>
  </AccessForm>
}

function ProductForm({ product, onSubmit }) {
  const [unit, setUnit] = useState(product?.unit || 'bag')
  return <AccessForm onSubmit={(form) => onSubmit(product ? {
    name: form.get('name'),
    price: readNumber(form.get('price')),
    minimumPrice: readNumber(form.get('minimumPrice')),
  } : {
    name: form.get('name'),
    unit,
    quantity: Number(form.get('quantity')),
    quantityUnit: unit === 'bag' ? 'bag' : form.get('quantityUnit'),
    price: readNumber(form.get('price')),
    minimumPrice: readNumber(form.get('minimumPrice')),
  })} submitLabel={product ? 'Narxni saqlash' : 'Kirimni saqlash'}>
    <Field label="Tovar nomi"><input name="name" required minLength="2" maxLength="80" defaultValue={product?.name || ''} placeholder="Masalan, kepak" /></Field>
    {!product && <Field label="Hisob birligi"><select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="bag">Qop</option><option value="weight">Vazn (kg / tonna)</option></select></Field>}
    {!product && <div className="field-row"><Field label="Kelgan miqdor"><input name="quantity" type="number" min="0.001" step="0.001" required placeholder="0" /></Field>{unit === 'weight' && <Field label="Kirim birligi"><select name="quantityUnit"><option value="kg">Kilogramm</option><option value="ton">Tonna</option></select></Field>}</div>}
    <Field label={`Sotuv narxi (${product?.unit === 'bag' || unit === 'bag' ? '1 qop' : '1 kg'})`}><MoneyField name="price" defaultValue={product?.price} required /></Field>
    <Field label="Eng past sotuv narxi"><MoneyField name="minimumPrice" defaultValue={product?.minimumPrice} required /><span className="field-hint">Shu narxga teng yoki undan past sotuv serverda rad etiladi.</span></Field>
  </AccessForm>
}

function StockForm({ product, onSubmit }) {
  const [unit, setUnit] = useState(product.unit === 'bag' ? 'bag' : 'kg')
  return <AccessForm onSubmit={(form) => onSubmit({ quantity: Number(form.get('quantity')), unit })} submitLabel="Kirimni saqlash">
    <Field label="Kelgan miqdor"><input name="quantity" type="number" min="0.001" step="0.001" required placeholder="0" /></Field>
    {product.unit === 'weight' && <Field label="Kirim birligi"><select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="kg">Kilogramm</option><option value="ton">Tonna</option></select></Field>}
    {product.unit === 'bag' && <p className="security-note">Ushbu tovar qop hisobida. Faqat butun qop kiritiladi.</p>}
  </AccessForm>
}

function EmployeeForm({ employee, onSubmit }) {
  return <AccessForm onSubmit={(form) => {
    const result = { name: form.get('name'), monthlySalary: readNumber(form.get('monthlySalary')) }
    if (!employee) Object.assign(result, { login: form.get('login'), password: form.get('password') })
    return onSubmit(result)
  }} submitLabel={employee ? 'O‘zgarishlarni saqlash' : 'Hodim akkauntini yaratish'}>
    <Field label="Hodim ismi"><input name="name" required minLength="2" maxLength="80" defaultValue={employee?.name || ''} placeholder="Ism-familiya" /></Field>
    {!employee && <><Field label="Hodim login"><input name="login" autoComplete="off" required minLength="3" maxLength="40" placeholder="Boshqa brendlarda ishlamaydi" /></Field><Field label="Boshlang‘ich parol"><PasswordInput name="password" autoComplete="new-password" required minLength="10" placeholder="Kamida 10 ta belgi" /></Field></>}
    {employee && <p className="security-note">Login: <strong>{employee.login}</strong></p>}
    <Field label="Oylik maosh"><MoneyField name="monthlySalary" defaultValue={employee?.monthlySalary} required /></Field>
  </AccessForm>
}

function MovementForm({ kind, month, onSubmit }) {
  const today = dayKey(useClock())
  return <AccessForm onSubmit={(form) => {
    const date = kind === 'abed' ? form.get('date') : today
    return onSubmit({
      kind,
      amount: readNumber(form.get('amount')),
      date,
      period: kind === 'abed' ? date.slice(0, 7) : form.get('period'),
    })
  }} submitLabel={kind === 'advance' ? 'Avansni saqlash' : 'Abed pulini saqlash'}>
    {kind === 'advance'
      ? <Field label="Hisob oyi"><input name="period" type="month" defaultValue={month} required /></Field>
      : <Field label="Abed puli berilgan sana"><input name="date" type="date" defaultValue={today} required /></Field>}
    <Field label="Berilgan summa"><MoneyField name="amount" required /></Field>
    <p className={kind === 'advance' ? 'security-note' : 'security-note accent-note'}>{kind === 'advance' ? 'Avans tanlangan oy oyligidan ushlab qolinadi.' : 'Abed puli tarixda saqlanadi, oylik qoldig‘iga ta’sir qilmaydi.'}</p>
  </AccessForm>
}

function Field({ label, children }) {
  return <label className="field-label"><span>{label}</span>{children}</label>
}

function PasswordInput({ ...props }) {
  const [visible, setVisible] = useState(false)
  return <span className="password-input-wrap">
    <input {...props} className={`password-input ${props.className || ''}`.trim()} type={visible ? 'text' : 'password'} />
    <button
      type="button"
      className="password-visibility"
      aria-label={visible ? 'Parolni yashirish' : 'Parolni ko‘rsatish'}
      aria-pressed={visible}
      onClick={() => setVisible((current) => !current)}
    >{visible ? <FiEyeOff /> : <FiEye />}</button>
  </span>
}

function MoneyField({ name, defaultValue, required, readOnly = false }) {
  const [value, setValue] = useState(defaultValue ? numberInput(defaultValue) : '')
  return <div className="money-field"><input name={name} type="text" inputMode="numeric" readOnly={readOnly} value={value} onChange={(event) => setValue(numberInput(readNumber(event.target.value)))} placeholder="0" required={required} /><span>so‘m</span></div>
}

function Modal({ title, subtitle, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header className="modal-heading"><div><span className="eyebrow">YEMZOR</span><h2 id="dialog-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Yopish"><FiX /></button></header>{children}</section></div>
}

function Empty({ title, text }) {
  return <div className="empty-state"><span className="empty-icon"><FiBox /></span><strong>{title}</strong><p>{text}</p></div>
}

function Loading() {
  return <div className="loading-state"><span className="spinner" /> Ma’lumotlar yuklanmoqda...</div>
}

export default App
