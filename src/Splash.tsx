export function Splash() {
  return (
    <main className="splash" role="status" aria-label="Loading Tallyfy">
      <img src="icon.svg" alt="" width="72" height="72" />
      <div className="spinner" aria-hidden="true" />
      <p>Opening Tallyfy…</p>
    </main>
  )
}
