// Phase 2A · 研究关系操作测试（双向一致性 + 创建阅读笔记）

import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store'
import {
  linkPaperNote, unlinkPaperNote,
  linkPaperProject, unlinkPaperProject,
  linkNoteProject, unlinkNoteProject,
  createLiteratureNote, LITERATURE_NOTE_TEMPLATE,
  notesOfPaper, papersOfNote, projectsOfPaper, papersOfProject, notesOfProject, projectsOfNote,
} from './relations'

function makePaper(id: string, o: Record<string, unknown> = {}) {
  return { id, title: `Paper ${id}`, stage: '未分类', category: 'x', status: 'unread', createdAt: 'x', ...o }
}
function makeNote(id: string, o: Record<string, unknown> = {}) {
  return { id, title: `Note ${id}`, content: 'c', tags: [], createdAt: 'x', updatedAt: 'x', ...o }
}
function makeProject(id: string, o: Record<string, unknown> = {}) {
  return { id, name: `Proj ${id}`, color: 'blue', ...o }
}

beforeEach(() => {
  useStore.setState({ papers: [], notes: [], projects: [], tasks: [], milestones: [] } as any)
})

describe('Paper ↔ Note', () => {
  it('link → 双向引用一致', () => {
    useStore.setState({ papers: [makePaper('p1')], notes: [makeNote('n1')] } as any)
    linkPaperNote('p1', 'n1')
    const s = useStore.getState()
    expect(s.papers[0].noteIds).toEqual(['n1'])
    expect(s.notes[0].paperIds).toEqual(['p1'])
    expect(notesOfPaper('p1').map((n) => n.id)).toEqual(['n1'])
    expect(papersOfNote('n1').map((p) => p.id)).toEqual(['p1'])
  })

  it('unlink → 双向解除（§17 双向一致性）', () => {
    useStore.setState({ papers: [makePaper('p1', { noteIds: ['n1'] })], notes: [makeNote('n1', { paperIds: ['p1'] })] } as any)
    unlinkPaperNote('p1', 'n1')
    const s = useStore.getState()
    expect(s.papers[0].noteIds).toEqual([])
    expect(s.notes[0].paperIds).toEqual([])
    expect(notesOfPaper('p1')).toHaveLength(0)
    expect(papersOfNote('n1')).toHaveLength(0)
  })

  it('重复 link 幂等（不重复添加）', () => {
    useStore.setState({ papers: [makePaper('p1')], notes: [makeNote('n1')] } as any)
    linkPaperNote('p1', 'n1')
    linkPaperNote('p1', 'n1')
    expect(useStore.getState().papers[0].noteIds).toEqual(['n1'])
  })
})

describe('Paper ↔ Project', () => {
  it('link / unlink 双向一致', () => {
    useStore.setState({ papers: [makePaper('p1')], projects: [makeProject('pj1')] } as any)
    linkPaperProject('p1', 'pj1')
    expect(useStore.getState().papers[0].projectIds).toEqual(['pj1'])
    expect(useStore.getState().projects[0].paperIds).toEqual(['p1'])
    expect(projectsOfPaper('p1').map((p) => p.id)).toEqual(['pj1'])
    expect(papersOfProject('pj1').map((p) => p.id)).toEqual(['p1'])
    unlinkPaperProject('p1', 'pj1')
    expect(useStore.getState().papers[0].projectIds).toEqual([])
    expect(useStore.getState().projects[0].paperIds).toEqual([])
  })
})

describe('Note ↔ Project', () => {
  it('link / unlink 双向一致', () => {
    useStore.setState({ notes: [makeNote('n1')], projects: [makeProject('pj1')] } as any)
    linkNoteProject('n1', 'pj1')
    expect(useStore.getState().notes[0].projectIds).toEqual(['pj1'])
    expect(useStore.getState().projects[0].noteIds).toEqual(['n1'])
    expect(projectsOfNote('n1').map((p) => p.id)).toEqual(['pj1'])
    expect(notesOfProject('pj1').map((n) => n.id)).toEqual(['n1'])
    unlinkNoteProject('n1', 'pj1')
    expect(useStore.getState().notes[0].projectIds).toEqual([])
    expect(useStore.getState().projects[0].noteIds).toEqual([])
  })
})

describe('createLiteratureNote（一键创建阅读笔记）', () => {
  it('创建 Note + 自动关联 Paper + 模板', () => {
    useStore.setState({ papers: [makePaper('p1')], notes: [] } as any)
    const id = createLiteratureNote(useStore.getState().papers[0])
    const s = useStore.getState()
    const note = s.notes.find((n) => n.id === id)
    expect(note).toBeTruthy()
    expect(note!.title).toContain('Paper p1')
    expect(note!.paperIds).toEqual(['p1'])
    expect(note!.content).toContain('# Paper p1')
    expect(note!.content).toContain(LITERATURE_NOTE_TEMPLATE)
    expect(note!.tags).toContain('文献')
    expect(s.papers[0].noteIds).toContain(id) // Paper 反向关联
  })

  it('阅读笔记可被 unlink（删除关系不删笔记）', () => {
    useStore.setState({ papers: [makePaper('p1')], notes: [] } as any)
    const id = createLiteratureNote(useStore.getState().papers[0])
    unlinkPaperNote('p1', id)
    const s = useStore.getState()
    expect(s.papers[0].noteIds).toEqual([])
    expect(s.notes.find((n) => n.id === id)).toBeTruthy() // 笔记保留
  })
})
