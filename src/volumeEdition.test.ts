// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { paginate } from './book'
import { appearsInContents } from './content'
import { newVolume } from './library'
import { volumeSections } from './volumeEdition'

describe('the bound volume on the desk', () => {
  it('prints the selected book and its actual chapter in the contents and reserves facing pages', () => {
    const book = { ...newVolume('Winter Letters'), title: 'The First Frost', memory: 'A line of frost.', profile: '<reader> & author' }
    const sections = volumeSections(book)
    const pages = paginate(sections, document.createElement('div'), 500)
    const page = (id: string) => pages.find(p => p.sectionId === id)!
    expect(sections.filter(appearsInContents).map(s => s.title)).toEqual(['Preface', 'A Note on the Reader', book.title, 'Colophon'])
    expect(pages[0].kind).toBe('blank')
    expect(pages[1]).toMatchObject({ kind: 'cover', title: book.name })
    for (const id of ['title', 'contents', 'preface', 'profile', 'correspondence'])
      expect(pages.indexOf(page(id)) % 2).toBe(1)
    expect(page('imprint')).toBe(pages[pages.indexOf(page('title')) + 1])
    expect(page('contents').folio).toBe('v')
    expect(page('title').folio).toBeUndefined()
    expect(page('profile').html).toContain('&lt;reader&gt; &amp; author')
    expect(page('margins')).toBe(pages[pages.indexOf(page('correspondence')) - 1])
    expect(page('correspondence').folio).toBe('1')
    expect(pages.at(-1)).toMatchObject({ kind: 'colophon', folio: '2' })
  })
  it('provides writable front matter for a fresh volume without borrowing another reader’s text', () => {
    const sections = volumeSections(newVolume('Field Notes'))
    expect(sections.find(s => s.id === 'profile')?.kind).toBe('profile')
    expect(sections.find(s => s.id === 'preface')?.kind).toBe('preface')
    expect(sections[0].title).toBe('Field Notes')
  })
})
