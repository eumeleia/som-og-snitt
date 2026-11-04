import { describe, it, expect } from 'vitest'
import { planDriveRenames, type NamedRecipe } from './drive-names'

const row = (id: string, title: string, designer: string | null, file_name: string): NamedRecipe =>
  ({ id, title, designer, file_name, drive_file_id: `f-${id}` })

describe('planDriveRenames', () => {
  it('renames the catalogue to «Ellinor - Flere plagg - Katalog - Viking Garn.pdf»', () => {
    const rows = [row('e', 'Ellinor - Flere plagg - Katalog', 'Viking Garn', 'Alpaca Silk katalog - Viking Garn.pdf')]
    const plan = planDriveRenames(rows, new Map([['f-e', 'Alpaca Silk katalog - Viking Garn.pdf']]))
    expect(plan.rename).toEqual([{ id: 'e', fileId: 'f-e', from: 'Alpaca Silk katalog - Viking Garn.pdf', to: 'Ellinor - Flere plagg - Katalog - Viking Garn.pdf' }])
    expect(plan.rowOnly).toEqual([])
  })

  it('leaves names that already match, uses only the title without a designer, and skips files it cannot see', () => {
    const rows = [
      row('a', 'Ankers bluse', 'PetiteKnit', 'Ankers bluse - PetiteKnit.pdf'),
      row('t', 'Tusseladd genser', null, 'Tusseladd.pdf'),
      row('p', 'Privat', 'X', 'gammel.pdf'),
    ]
    const plan = planDriveRenames(rows, new Map([['f-a', 'Ankers bluse - PetiteKnit.pdf'], ['f-t', 'Tusseladd.pdf']]))
    expect(plan.rename).toEqual([{ id: 't', fileId: 'f-t', from: 'Tusseladd.pdf', to: 'Tusseladd genser.pdf' }])
  })

  it('only updates the row when Drive already has the right name', () => {
    const plan = planDriveRenames([row('a', 'Iris', 'Camilla Pihl', 'CP_57.pdf')], new Map([['f-a', 'Iris - Camilla Pihl.pdf']]))
    expect(plan).toEqual({ rename: [], rowOnly: [{ id: 'a', to: 'Iris - Camilla Pihl.pdf' }] })
  })

  it('plans nothing once everything matches', () => {
    const rows = [row('e', 'Ellinor - Flere plagg - Katalog', 'Viking Garn', 'Ellinor - Flere plagg - Katalog - Viking Garn.pdf')]
    expect(planDriveRenames(rows, new Map([['f-e', 'Ellinor - Flere plagg - Katalog - Viking Garn.pdf']]))).toEqual({ rename: [], rowOnly: [] })
  })
})
