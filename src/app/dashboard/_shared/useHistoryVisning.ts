'use client'

import { useCallback, useEffect, useRef } from 'react'

// Generisk versjon av mønsteret som allerede fungerte i embroidery/page.tsx (replaceState
// ved mount, pushState når en detaljvisning/modal åpnes, popstate-lytter som gjenoppretter
// UI-state). Én instans av hooken per side, med en egen `visning`-type for akkurat den
// sidens tilstander (f.eks. { v: 'liste' } | { v: 'item'; id: string }).
//
// `namespace` skiller state-objektet denne siden eier fra andre history-state-nøkler
// (nyttig om flere hooker skulle deles på samme side i fremtiden, selv om ingen side i
// dag gjør det). `base` er "lukket"-tilstanden — den skrives med replaceState ved mount,
// IKKE pushState, slik at ett ekstra tilbaketrykk fra basen tar brukeren ut av seksjonen
// (til ruten hen kom fra), akkurat som før denne hooken fantes.
//
// `onNavigate` kalles med visningen browseren nettopp navigerte TIL (både ved tilbake og
// fram). Kalleren sin jobb er å sette lokal React-state (currentItem, showAdd, osv.) til å
// matche — hooken selv har ingen mening om hva en visning betyr. Callbacken leses via en
// ref som oppdateres hver rendring, så den alltid har ferske closures (siste `items`-liste
// osv.) uten at popstate-lytteren må registreres på nytt.
export function useHistoryVisning<T>(namespace: string, base: T, onNavigate: (visning: T) => void) {
  const onNavigateRef = useRef(onNavigate)
  useEffect(() => { onNavigateRef.current = onNavigate })

  useEffect(() => {
    // `base` leses her, ikke via en ref satt under rendring (react-compiler forbyr å
    // skrive en ref-verdi i selve rendringsfasen) — denne effekten kjører uansett bare
    // ved mount (namespace endres aldri i praksis), så den fanger `base` slik den var
    // på FØRSTE rendring, som er akkurat det "lukket"-tilstanden skal være.
    window.history.replaceState({ [namespace]: base }, '')
    function onPopState(e: PopStateEvent) {
      const state = (e.state as Record<string, T> | null)?.[namespace]
      if (state === undefined) return
      onNavigateRef.current(state)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace])

  const push = useCallback((visning: T) => {
    window.history.pushState({ [namespace]: visning }, '')
  }, [namespace])

  // Bytter visningen på PLASS i historikken, uten å legge til en oppføring — for
  // overganger der forrige visning ikke lenger finnes å gå tilbake til (f.eks. et
  // "ny ting"-skjema som blir til den ferdig opprettede tingens detaljvisning; ett
  // tilbaketrykk derfra skal gå til listen, ikke gjenåpne det tomme skjemaet).
  const replace = useCallback((visning: T) => {
    window.history.replaceState({ [namespace]: visning }, '')
  }, [namespace])

  // For lukkeknapper i UI-en (ikke nettleserens tilbakeknapp): historikk-oppføringen som
  // ble lagt til av push() skal fjernes, ikke bare overskrives — ellers vokser stacken med
  // en gjenværende "spøkelses"-oppføring hver gang noe åpnes og lukkes med en X-knapp i
  // stedet for nettleserens tilbakeknapp. history.back() lar popstate-lytteren over gjøre
  // selve UI-oppdateringen, samme kodevei som et ekte tilbaketrykk.
  const closeToBase = useCallback(() => {
    window.history.back()
  }, [])

  return { push, replace, closeToBase }
}
