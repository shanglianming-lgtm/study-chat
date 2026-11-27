import type { Section } from './content'
import type { Volume } from './library'

export function volumeSections({ name, title, memory, profile }: Pick<Volume, 'name' | 'title' | 'memory' | 'profile'>): Section[] {
  const front = { matter: 'front', markdown: '' } as const
  const leaves: Section[] = [
    { ...front, id: 'cover', title: name, kind: 'cover', hideFolio: true },
    { ...front, id: 'title', title: name, kind: 'title', recto: true, hideFolio: true },
    { ...front, id: 'imprint', title: 'Edition', kind: 'imprint', hideFolio: true },
    { ...front, id: 'contents', title: 'Contents', kind: 'toc', recto: true },
  ]
  leaves.push(
    { ...front, id: 'preface', title: 'Preface', recto: true, ...(memory.trim() ? { plainText: memory } : { kind: 'preface' }) },
    { ...front, id: 'profile', title: 'A Note on the Reader', recto: true, ...(profile.trim() ? { plainText: profile } : { kind: 'profile' }) }
  )
  return [...leaves,
    { ...front, id: 'margins', title: 'Marginalia', kind: 'margins', hideFolio: true },
    { id: 'correspondence', title, kind: 'live', chapter: 'I', recto: true, markdown: '' },
    { id: 'colophon', title: 'Colophon', kind: 'colophon', markdown: '' },
  ]
}
