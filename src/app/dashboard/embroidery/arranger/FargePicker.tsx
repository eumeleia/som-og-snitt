'use client'

import { BROTHER_PALETT } from './broderPalett'

export function FargePicker({ nuvarendeHex, originalHex, onVelg, onNullstill, onClose }: {
  nuvarendeHex: string
  originalHex: string
  onVelg: (hex: string) => void
  onNullstill: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-serif text-xl text-stone-800">Velg trådfarge</h3>
          <p className="text-xs text-stone-400 mt-1">
            Brothers 64-fargers palett — ikke fri hex, siden PEC-blokken snapper til nærmeste palettfarge.
          </p>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-4">
          <div className="grid grid-cols-8 gap-2">
            {BROTHER_PALETT.map(f => (
              <button
                key={f.hex}
                title={f.navn}
                onClick={() => onVelg(f.hex)}
                className={`w-full aspect-square rounded-lg border-2 transition-all ${
                  f.hex === nuvarendeHex ? 'border-stone-800 scale-110' : 'border-stone-200 hover:border-stone-400'
                }`}
                style={{ backgroundColor: f.hex }}
              />
            ))}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-stone-100 flex-shrink-0 flex gap-2">
          {nuvarendeHex !== originalHex && (
            <button
              onClick={onNullstill}
              className="flex-1 py-2 text-sm text-stone-500 hover:text-stone-700 border border-stone-200 rounded-xl transition-colors"
            >
              Nullstill til original
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm text-white bg-stone-800 hover:bg-stone-700 rounded-xl transition-colors"
          >
            Lukk
          </button>
        </div>
      </div>
    </div>
  )
}
