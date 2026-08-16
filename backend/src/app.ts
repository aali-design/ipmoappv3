import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { requestContext } from './middleware/requestContext.js'
import { rateLimit } from './middleware/rateLimit.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'
import { authRouter } from './routes/auth.js'
import { opsRouter } from './routes/ops.js'
import { academicRouter } from './routes/academic.js'
import { peopleRouter } from './routes/people.js'
import { enrollmentsRouter } from './routes/enrollments.js'
import { timetableRouter } from './routes/timetable.js'
import { attendanceRouter } from './routes/attendance.js'
import { assessmentsRouter } from './routes/assessments.js'
import { reportCardsRouter } from './routes/reportCards.js'
import { feesRouter } from './routes/fees.js'
import { communicationRouter } from './routes/communication.js'
import { documentsRouter } from './routes/documents.js'
import { webhooksRouter } from './routes/webhooks.js'

/**
 * Express app. All routers mount under `/api` (the nginx front proxy forwards
 * `/api/*` unrewritten). Auth endpoints are rate-limited per spec §8.
 */
export function createApp(): express.Express {
  const app = express()

  app.set('trust proxy', true)

  app.use(helmet())
  app.use(cors())
  app.use(express.json({ limit: '5mb' }))
  app.use(requestContext)

  // Spec §8: auth 10/min/IP. Apply to credential-bearing endpoints only.
  const authRateLimit = rateLimit(60_000, 10)
  app.use('/api/auth/login', authRateLimit)
  app.use('/api/auth/refresh', authRateLimit)
  app.use('/api/auth/forgot-password', authRateLimit)

  app.use('/api/auth', authRouter)
  app.use('/api', opsRouter)
  app.use('/api', academicRouter)
  app.use('/api', peopleRouter)
  app.use('/api', enrollmentsRouter)
  app.use('/api', timetableRouter)
  app.use('/api', attendanceRouter)
  app.use('/api', assessmentsRouter)
  app.use('/api', reportCardsRouter)
  app.use('/api', feesRouter)
  app.use('/api', communicationRouter)
  app.use('/api', documentsRouter)
  app.use('/api', webhooksRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
