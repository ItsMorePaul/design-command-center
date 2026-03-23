import express from 'express';

interface SSEClient {
  id: number
  res: express.Response
}

let sseClientId = 0
const sseClients: SSEClient[] = []

export function broadcast(event: string, data: Record<string, unknown>) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].res.write(payload)
    } catch {
      sseClients.splice(i, 1)
    }
  }
}

export function createSSEHandler(getSiteVersion: () => string, getMaintenancePayload: () => Record<string, unknown>) {
  return (req: express.Request, res: express.Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    // Send initial state
    res.write(`event: maintenance\ndata: ${JSON.stringify(getMaintenancePayload())}\n\n`)
    res.write(`event: version\ndata: ${JSON.stringify({ site_version: getSiteVersion() })}\n\n`)

    const client: SSEClient = { id: ++sseClientId, res }
    sseClients.push(client)

    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n') } catch { clearInterval(keepAlive) }
    }, 30000)

    req.on('close', () => {
      clearInterval(keepAlive)
      const idx = sseClients.findIndex(c => c.id === client.id)
      if (idx !== -1) sseClients.splice(idx, 1)
    })
  }
}
