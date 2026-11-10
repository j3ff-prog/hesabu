import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Today } from './Today'
import { Dashboard } from './Dashboard'
import { useAuth } from './Auth'

export function Reports({ shop }: { shop: string }) {
  const { can } = useAuth()
  const dash = can('dashboard')
  return (
    <>
      <div className="reports-head">
        <h1>{dash ? 'Reports' : 'My day'}</h1>
        {dash && (
          <nav className="subtabs" aria-label="Reports">
            <NavLink to="/reports" end>Today</NavLink>
            <NavLink to="/reports/dashboard">Overview</NavLink>
          </nav>
        )}
      </div>
      <Routes>
        <Route index element={<Today shop={shop} />} />
        <Route path="dashboard" element={dash ? <main className="page report-page"><Dashboard /></main> : <Navigate to="/reports" replace />} />
      </Routes>
    </>
  )
}
