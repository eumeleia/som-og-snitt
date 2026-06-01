'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

export default function Login() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

async function handleLogin() {
  setLoading(true)
  setError('')

  try {
    console.log('Starter login...')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    console.log('Login data:', data)
    console.log('Login error:', error)

    if (error) {
      setError('Feil e-post eller passord.')
      return
    }

    router.push('/dashboard')
    router.refresh()
  } catch (err) {
    console.error('Uventet login-feil:', err)
    setError('Noe gikk galt med innloggingen.')
  } finally {
    setLoading(false)
  }
}

  return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ backgroundColor: '#FAF7F4' }}>
      <Image src="/logo.png" alt="Søm & Snitt" width={0} height={0} sizes="100vw"
        className="h-14 w-auto mb-1" priority />
      <p className="text-xs tracking-widest text-stone-400 uppercase mb-6">Din sydagbok</p>

      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-10 w-full max-w-sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold tracking-widest uppercase text-stone-400 mb-1.5">
              E-post
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
              placeholder="din@epost.no"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-widest uppercase text-stone-400 mb-1.5">
              Passord
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            onClick={handleLogin}
            disabled={loading || !email || !password}
            className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Logger inn…' : 'Logg inn'}
          </button>
        </div>
      </div>
    </div>
  )
}