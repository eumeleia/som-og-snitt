import StitchCalculator from '../../_components/StitchCalculator'

export default function StitchCalculatorPage() {
  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-8 py-4 sm:py-6">
      <div className="max-w-md flex flex-col gap-4">
        <h1 className="font-serif text-2xl text-stone-800">Øke/felle-kalkulator</h1>
        <p className="text-sm text-stone-600 -mt-2">Finn ut hvordan du øker eller feller jevnt fordelt i én omgang eller pinne.</p>
        <StitchCalculator />
      </div>
    </div>
  )
}
