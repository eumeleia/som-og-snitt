import { describe, it, expect } from 'vitest'
import { FINDING_SCHEMA, isVisibleInGarnlager, mergeStashData, normalizeFinding, stashThumbnailUrl } from './stash'
import { schemaErrors } from './extraction'

describe('normalizeFinding', () => {
  it('fills in a full finding', () => {
    const f = normalizeFinding({
      brand: 'DROPS', name: 'Lima', color_number: '0518', color_name: 'Mørk gråmelert',
      skein_count: 5, leftover_g: 0, images: ['IMG_3850.HEIC', 'IMG_3851.HEIC'],
      thumbnail_image: 'IMG_3850.HEIC', note: '',
      uncertain: [{ field: 'color_number', reason: 'Delvis skjult av hånden' }],
    })
    expect(f).toEqual({
      brand: 'DROPS', name: 'Lima', color_number: '0518', color_name: 'Mørk gråmelert',
      skein_count: 5, leftover_g: 0, images: ['IMG_3850.HEIC', 'IMG_3851.HEIC'],
      thumbnail_image: 'IMG_3850.HEIC', note: null,
      uncertain_fields: ['color_number'], uncertain_reasons: { color_number: 'Delvis skjult av hånden' },
    })
  })
  it('defaults an empty finding to zero counts and no colour', () => {
    const f = normalizeFinding({ brand: 'House of Yarn', name: 'Solid', images: [] })
    expect(f.color_number).toBeNull()
    expect(f.leftover_g).toBeNull()
    expect(f.skein_count).toBe(0)
    expect(f.uncertain_fields).toEqual([])
  })
  it('matches FINDING_SCHEMA', () => {
    const answer = {
      brand: 'DROPS', name: 'Lima', color_number: '0518', color_name: '', skein_count: 5, leftover_g: 0,
      images: ['IMG_3850.HEIC'], thumbnail_image: 'IMG_3850.HEIC', note: '', uncertain: [],
    }
    expect(schemaErrors(FINDING_SCHEMA, answer)).toEqual([])
  })
})

describe('mergeStashData', () => {
  it('adds counts and keeps the first non-empty colour', () => {
    const a = { color_number: '0518', color_name: null, skein_count: 3, leftover_g: null, note: 'Fra kurven', uncertain_fields: ['color_name'], uncertain_reasons: { color_name: 'Ikke lesbart' }, source_images: ['IMG_3850.HEIC'] }
    const b = { color_number: null, color_name: 'Grå', skein_count: 2, leftover_g: 20, note: null, uncertain_fields: [], uncertain_reasons: {}, source_images: ['IMG_3920.HEIC'] }
    expect(mergeStashData(a, b)).toEqual({
      color_number: '0518', color_name: 'Grå', skein_count: 5, leftover_g: 20, note: 'Fra kurven',
      uncertain_fields: ['color_name'], uncertain_reasons: { color_name: 'Ikke lesbart' },
      source_images: ['IMG_3850.HEIC', 'IMG_3920.HEIC'],
    })
  })
  it('keeps leftover_g null when neither row has any', () => {
    const empty = { color_number: null, color_name: null, skein_count: 1, leftover_g: null, note: null, uncertain_fields: [], uncertain_reasons: {}, source_images: [] }
    expect(mergeStashData(empty, empty).leftover_g).toBeNull()
  })
})

describe('isVisibleInGarnlager', () => {
  it('is visible when not tied to any project', () => {
    expect(isVisibleInGarnlager({ strikk_project: null })).toBe(true)
  })
  it('is visible while the project is still planned', () => {
    expect(isVisibleInGarnlager({ strikk_project: { id: '1', name: 'Genser', status: 'planned' } })).toBe(true)
  })
  it('is hidden once the project is in progress or done', () => {
    expect(isVisibleInGarnlager({ strikk_project: { id: '1', name: 'Genser', status: 'in_progress' } })).toBe(false)
    expect(isVisibleInGarnlager({ strikk_project: { id: '1', name: 'Genser', status: 'done' } })).toBe(false)
  })
})

describe('stashThumbnailUrl', () => {
  it('builds the public storage URL', () => {
    expect(stashThumbnailUrl('garnlager/abc.jpg', 'https://x.supabase.co')).toBe('https://x.supabase.co/storage/v1/object/public/strikk-thumbnails/garnlager%2Fabc.jpg')
  })
  it('is null without a path or a base URL', () => {
    expect(stashThumbnailUrl(null, 'https://x.supabase.co')).toBeNull()
    expect(stashThumbnailUrl('garnlager/abc.jpg', '')).toBeNull()
  })
})
