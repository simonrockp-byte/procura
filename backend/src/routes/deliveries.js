'use strict';
const express = require('express');
const multer = require('multer');
const db = require('../db');
const audit = require('../services/audit');
const s3 = require('../services/s3');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const router = express.Router();
router.use(authenticate);

// Multer: accept photo in memory (max 10 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted'));
    }
    cb(null, true);
  },
});

// ─── POST /api/deliveries ─────────────────────────────────────────────────────
// Officer confirms delivery. Optionally attaches a photo and GPS coords.
router.post(
  '/',
  upload.single('photo'),
  async (req, res) => {
    const { orgId, id: actorId, role } = req.officer;

    // Parse JSON fields from multipart body
    const requisition_id = req.body.requisition_id;
    const gps_lat = req.body.gps_lat ? parseFloat(req.body.gps_lat) : null;
    const gps_lng = req.body.gps_lng ? parseFloat(req.body.gps_lng) : null;
    const notes = req.body.notes || null;

    if (!requisition_id) {
      return res.status(400).json({ error: 'requisition_id is required' });
    }

    if (role === 'Auditor') {
      return res.status(403).json({ error: 'Auditors cannot confirm deliveries' });
    }

    try {
      // Verify requisition exists and is in Ordered status
      const reqCheck = await db.withOrg(orgId, async (client) =>
        client.query(
          'SELECT * FROM requisitions WHERE id = $1 AND org_id = $2',
          [requisition_id, orgId]
        )
      );

      if (!reqCheck.rows.length) {
        return res.status(404).json({ error: 'Requisition not found' });
      }
      const requisition = reqCheck.rows[0];

      if (requisition.status !== 'Ordered') {
        return res.status(422).json({
          error: `Delivery can only be confirmed on an 'Ordered' requisition (current: ${requisition.status})`,
        });
      }

      // Upload photo to S3 if provided
      let photoUrl = null;
      if (req.file) {
        const key = await s3.uploadDeliveryPhoto(
          orgId,
          requisition_id,
          req.file.buffer,
          req.file.mimetype
        );
        photoUrl = key; // stored as S3 key; generate pre-signed URL on read
      }

      const result = await db.withOrg(orgId, async (client) => {
        const inserted = await client.query(
          `INSERT INTO deliveries
             (org_id, requisition_id, photo_url, gps_lat, gps_lng, confirmed_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [orgId, requisition_id, photoUrl, gps_lat, gps_lng, actorId, notes]
        );

        const delivery = inserted.rows[0];

        // Transition requisition to Delivered
        await client.query(
          `UPDATE requisitions SET status = 'Delivered', updated_at = NOW() WHERE id = $1`,
          [requisition_id]
        );

        await audit.log(client, {
          orgId, actorId,
          tableName: 'deliveries',
          recordId: delivery.id,
          action: 'INSERT',
          payload: {
            requisition_id,
            has_photo: !!photoUrl,
            gps: gps_lat ? { lat: gps_lat, lng: gps_lng } : null,
          },
        });

        await audit.log(client, {
          orgId, actorId,
          tableName: 'requisitions',
          recordId: requisition_id,
          action: 'UPDATE',
          payload: { from_status: 'Ordered', to_status: 'Delivered', delivery_id: delivery.id },
        });

        return delivery;
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error('[deliveries/create]', err);
      return res.status(500).json({ error: 'Failed to record delivery' });
    }
  }
);

// ─── GET /api/deliveries/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { orgId } = req.officer;

  try {
    const result = await db.withOrg(orgId, async (client) =>
      client.query(
        `SELECT d.*, o.full_name AS confirmed_by_name,
                r.ref_number AS requisition_ref
         FROM deliveries d
         JOIN officers o ON o.id = d.confirmed_by
         JOIN requisitions r ON r.id = d.requisition_id
         WHERE d.id = $1 AND d.org_id = $2`,
        [req.params.id, orgId]
      )
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Delivery not found' });

    const delivery = result.rows[0];

    // Generate pre-signed URL for photo if stored
    if (delivery.photo_url) {
      delivery.photo_signed_url = await s3.getSignedPhotoUrl(delivery.photo_url);
    }

    return res.json(delivery);
  } catch (err) {
    console.error('[deliveries/get]', err);
    return res.status(500).json({ error: 'Failed to fetch delivery' });
  }
});

// ─── GET /api/deliveries?requisition_id=xxx ───────────────────────────────────
router.get('/', async (req, res) => {
  const { orgId } = req.officer;
  const { requisition_id } = req.query;

  if (!requisition_id) {
    return res.status(400).json({ error: 'requisition_id query param is required' });
  }

  try {
    const result = await db.withOrg(orgId, async (client) =>
      client.query(
        `SELECT d.*, o.full_name AS confirmed_by_name
         FROM deliveries d
         JOIN officers o ON o.id = d.confirmed_by
         WHERE d.requisition_id = $1 AND d.org_id = $2
         ORDER BY d.created_at DESC`,
        [requisition_id, orgId]
      )
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('[deliveries/list]', err);
    return res.status(500).json({ error: 'Failed to fetch deliveries' });
  }
});

module.exports = router;
