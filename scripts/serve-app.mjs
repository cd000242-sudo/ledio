/* global console, process */
import { createShortsFactoryServer } from './local-server.mjs'

const requestedPort = Number(process.env.PORT ?? 4173)
const host = '127.0.0.1'
const server = createShortsFactoryServer({ host, port: requestedPort })

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${requestedPort} is already in use. Try PORT=4174 npm run app.`)
    process.exitCode = 1
    return
  }
  console.error(err.message)
  process.exitCode = 1
})

function shutdown() {
  server.close(() => {
    process.exitCode = 0
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(requestedPort, host, () => {
  console.log(`shorts-factory app: http://${host}:${requestedPort}/`)
})
