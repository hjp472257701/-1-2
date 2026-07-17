import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import QuestionnaireApp from './QuestionnaireApp.tsx'
import FullStudyApp from './FullStudyApp.tsx'

function pickEntry() {
  const p = window.location.pathname.replace(/\/+$/, '')
  if (p === '/questionnaire') return <QuestionnaireApp />
  if (p === '/online-points') return <FullStudyApp />
  if (p === '/online-points-formal') return <FullStudyApp mode="formal" />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {pickEntry()}
  </StrictMode>,
)
