// Phase 2A · 研究关系操作（Paper ↔ Note / Paper ↔ Project / Note ↔ Project）
// 所有关系变更通过 renderer 乐观双写（一次 setState 改两个实体）→ persist diff
// → 自动生成 [paper.update, note.update] batch mutation → 引擎原子应用 → State Sync。
// 一致性由 batch 原子性保证（§17 双向一致）。

import { useStore, uid } from '../store'
import type { Project } from '../store'
import type { Paper, Note } from '../types'

function addRef(list: string[] | undefined, id: string): string[] {
  const l = list ? [...list] : []
  if (!l.includes(id)) l.push(id)
  return l
}

function removeRef(list: string[] | undefined, id: string): string[] {
  return (list || []).filter((x) => x !== id)
}

// ===== Paper ↔ Note =====

export function linkPaperNote(paperId: string, noteId: string) {
  const s = useStore.getState()
  useStore.setState({
    papers: s.papers.map((p) => (p.id === paperId ? { ...p, noteIds: addRef(p.noteIds, noteId) } : p)),
    notes: s.notes.map((n) => (n.id === noteId ? { ...n, paperIds: addRef(n.paperIds, paperId) } : n)),
  })
}

export function unlinkPaperNote(paperId: string, noteId: string) {
  const s = useStore.getState()
  useStore.setState({
    papers: s.papers.map((p) => (p.id === paperId ? { ...p, noteIds: removeRef(p.noteIds, noteId) } : p)),
    notes: s.notes.map((n) => (n.id === noteId ? { ...n, paperIds: removeRef(n.paperIds, paperId) } : n)),
  })
}

// ===== Paper ↔ Project =====

export function linkPaperProject(paperId: string, projectId: string) {
  const s = useStore.getState()
  useStore.setState({
    papers: s.papers.map((p) => (p.id === paperId ? { ...p, projectIds: addRef(p.projectIds, projectId) } : p)),
    projects: s.projects.map((pr) => (pr.id === projectId ? { ...pr, paperIds: addRef(pr.paperIds, paperId) } : pr)),
  })
}

export function unlinkPaperProject(paperId: string, projectId: string) {
  const s = useStore.getState()
  useStore.setState({
    papers: s.papers.map((p) => (p.id === paperId ? { ...p, projectIds: removeRef(p.projectIds, projectId) } : p)),
    projects: s.projects.map((pr) => (pr.id === projectId ? { ...pr, paperIds: removeRef(pr.paperIds, paperId) } : pr)),
  })
}

// ===== Note ↔ Project =====

export function linkNoteProject(noteId: string, projectId: string) {
  const s = useStore.getState()
  useStore.setState({
    notes: s.notes.map((n) => (n.id === noteId ? { ...n, projectIds: addRef(n.projectIds, projectId) } : n)),
    projects: s.projects.map((pr) => (pr.id === projectId ? { ...pr, noteIds: addRef(pr.noteIds, noteId) } : pr)),
  })
}

export function unlinkNoteProject(noteId: string, projectId: string) {
  const s = useStore.getState()
  useStore.setState({
    notes: s.notes.map((n) => (n.id === noteId ? { ...n, projectIds: removeRef(n.projectIds, projectId) } : n)),
    projects: s.projects.map((pr) => (pr.id === projectId ? { ...pr, noteIds: removeRef(pr.noteIds, noteId) } : pr)),
  })
}

// ===== 创建阅读笔记（一键：创建 Note + 自动关联当前 Paper + 轻量模板） =====

export const LITERATURE_NOTE_TEMPLATE = [
  '## 研究问题',
  '',
  '## 核心贡献',
  '',
  '## 方法',
  '',
  '## 主要发现',
  '',
  '## 局限',
  '',
  '## 我的思考',
  '',
].join('\n')

export function createLiteratureNote(paper: Pick<Paper, 'id' | 'title'>): string {
  const id = uid()
  const now = new Date().toISOString()
  const s = useStore.getState()
  useStore.setState({
    notes: [
      ...s.notes,
      {
        id,
        title: `${paper.title.slice(0, 50)} · 阅读笔记`,
        content: `# ${paper.title}\n\n${LITERATURE_NOTE_TEMPLATE}`,
        tags: ['文献'],
        paperIds: [paper.id],
        createdAt: now,
        updatedAt: now,
      },
    ],
    papers: s.papers.map((p) => (p.id === paper.id ? { ...p, noteIds: addRef(p.noteIds, id) } : p)),
  })
  return id
}

// 创建项目笔记（一键：创建 Note + 自动关联当前 Project）
export function createProjectNote(project: Pick<Project, 'id' | 'name'>): string {
  const id = uid()
  const now = new Date().toISOString()
  const s = useStore.getState()
  useStore.setState({
    notes: [
      ...s.notes,
      {
        id,
        title: `${project.name.slice(0, 50)} · 项目笔记`,
        content: `# ${project.name}\n\n`,
        tags: ['项目'],
        projectIds: [project.id],
        createdAt: now,
        updatedAt: now,
      },
    ],
    projects: s.projects.map((p) => (p.id === project.id ? { ...p, noteIds: addRef(p.noteIds, id) } : p)),
  })
  return id
}

// ===== 关系查询辅助（含缺失实体防御） =====

export function notesOfPaper(paperId: string): Note[] {
  return useStore.getState().notes.filter((n) => (n.paperIds || []).includes(paperId))
}

export function papersOfNote(noteId: string): Paper[] {
  return useStore.getState().papers.filter((p) => (p.noteIds || []).includes(noteId))
}

export function projectsOfPaper(paperId: string): Project[] {
  return useStore.getState().projects.filter((p) => (p.paperIds || []).includes(paperId))
}

export function papersOfProject(projectId: string): Paper[] {
  return useStore.getState().papers.filter((p) => (p.projectIds || []).includes(projectId))
}

export function notesOfProject(projectId: string): Note[] {
  return useStore.getState().notes.filter((n) => (n.projectIds || []).includes(projectId))
}

export function projectsOfNote(noteId: string): Project[] {
  return useStore.getState().projects.filter((p) => (p.noteIds || []).includes(noteId))
}
