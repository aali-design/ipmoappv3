import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { pool } from '../db/pool.js'
import { config } from '../config.js'
import { asyncHandler } from '../lib/http.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { badRequest, forbidden, notFound } from '../lib/errors.js'
import { newUuid } from '../lib/crypto.js'

export const documentsRouter = Router()

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB (spec §8)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
})

function sanitizeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'))
  return base.replace(/[^a-zA-Z0-9._-]/g, '_')
}

documentsRouter.post(
  '/documents',
  authenticate,
  requireRole('admin', 'registrar', 'accountant', 'teacher'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('A file is required')
    const entityType = req.body.entity_type as string
    const entityId = req.body.entity_id as string
    if (!entityType || !entityId) throw badRequest('entity_type and entity_id are required')

    fs.mkdirSync(config.uploadDir, { recursive: true })
    const safeName = sanitizeName(req.file.originalname)
    const storedName = `${newUuid()}-${safeName}`
    const absolutePath = path.join(config.uploadDir, storedName)
    fs.writeFileSync(absolutePath, req.file.buffer)

    const { rows } = await pool.query(
      `INSERT INTO documents (school_id, entity_type, entity_id, filename, content_type, size_bytes, storage_path, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, school_id, entity_type, entity_id, filename, content_type, size_bytes, uploaded_by, created_at`,
      [
        req.auth!.school_id,
        entityType,
        entityId,
        safeName,
        req.file.mimetype,
        req.file.size,
        storedName,
        req.auth!.id,
      ],
    )
    res.status(201).json(rows[0])
  }),
)

documentsRouter.get(
  '/documents/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM documents WHERE id = $1`, [req.params.id])
    if (rows.length === 0) throw notFound('Document not found')
    const doc = rows[0]
    if (doc.school_id !== req.auth!.school_id) throw notFound('Document not found')

    // Relationship scoping for student/guardian on their own documents.
    if (req.auth!.role === 'student' || req.auth!.role === 'guardian') {
      const ownIds = req.auth!.student_ids ?? []
      if (doc.entity_type === 'student' && !ownIds.includes(doc.entity_id)) throw forbidden('Document access denied')
    }

    const absolutePath = path.join(config.uploadDir, path.basename(doc.storage_path))
    if (!fs.existsSync(absolutePath)) throw notFound('Document content not found')

    res.setHeader('Content-Type', doc.content_type)
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`)
    fs.createReadStream(absolutePath).pipe(res)
  }),
)
