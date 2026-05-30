export default function TechniquesPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-20 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-stone-100 mb-8">
        <svg className="w-9 h-9 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </div>
      <h2 className="font-serif text-4xl text-stone-700 mb-3">Teknikker</h2>
      <p className="text-[#C9A57A] italic text-lg mb-4">Kommer snart</p>
      <p className="text-stone-400 text-sm leading-relaxed max-w-sm mx-auto">
        Her vil du notere sy-teknikker du har lært — stinglengde, stingbredde, nål, tråd, trøkkfot og egne observasjoner.
      </p>
    </div>
  )
}
