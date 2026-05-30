export default function InventoryPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-20 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-stone-100 mb-8">
        <svg className="w-9 h-9 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      </div>
      <h2 className="font-serif text-4xl text-stone-700 mb-3">Lager</h2>
      <p className="text-[#C9A57A] italic text-lg mb-4">Kommer snart</p>
      <p className="text-stone-400 text-sm leading-relaxed max-w-sm mx-auto">
        Her vil du holde oversikt over stoffer du har liggende — med materiale, bredde, vekt, vaskeinstruksjoner og bilde.
      </p>
    </div>
  )
}
