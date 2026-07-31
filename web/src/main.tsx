import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { applyColumnWidth, initialColumnWidth } from './components/ColumnResizer.js'
import './index.css'

const host = document.getElementById('root')
if (!host) throw new Error('#root missing from index.html')

applyColumnWidth(initialColumnWidth())

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
