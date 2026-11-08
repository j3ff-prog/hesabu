// Pulled into the app's service worker. Shows a notification when the server sends one, and opens the app when it is tapped.
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { title: 'Tallyfy', body: event.data ? event.data.text() : '' } }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Tallyfy', {
      body: d.body || '',
      icon: 'pwa-192.png',
      badge: 'pwa-192.png',
      data: { url: d.url || './' }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url).catch(() => {})
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
