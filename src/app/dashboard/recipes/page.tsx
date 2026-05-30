export default function RecipesPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-20 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-stone-100 mb-8">
        <svg className="w-9 h-9 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h2 className="font-serif text-4xl text-stone-700 mb-3">Oppskrifter</h2>
      <p className="text-[#C9A57A] italic text-lg mb-4">Kommer snart</p>
      <p className="text-stone-400 text-sm leading-relaxed max-w-sm mx-auto">
        Her vil du samle symønstre, oppskrifter og PDF-filer — med størrelsesvelger og stofberegner for hvert mønster.
      </p>
    </div>
  )
}
