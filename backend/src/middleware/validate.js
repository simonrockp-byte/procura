'use strict';
const { z } = require('zod');

/**
 * Middleware factory: validates req.body against a Zod schema.
 * On failure returns 400 with structured field errors.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        fields: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    next();
  };
}

// ─── Shared schemas ───────────────────────────────────────────────────────────

const schemas = {
  registerOrg: z.object({
    org_name: z.string().min(2).max(120),
    org_slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
    full_name: z.string().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(8),
    phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164 format').optional(),
  }),

  login: z.object({
    email: z.string().email(),
    password: z.string().min(1),
    org_slug: z.string().min(1),
  }),

  inviteOfficer: z.object({
    email: z.string().email(),
    full_name: z.string().min(2).max(120),
    role: z.enum(['Officer', 'Manager', 'Executive', 'Auditor']),
    phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  }),

  acceptInvite: z.object({
    token: z.string().min(1),
    password: z.string().min(8),
  }),

  createRequisition: z.object({
    title: z.string().min(3).max(200),
    description: z.string().max(2000).optional(),
    amount: z.number().positive(),
    currency: z.string().length(3).default('ZMW'),
    supplier_id: z.string().uuid().optional(),
  }),

  updateRequisitionStatus: z.object({
    status: z.enum(['Approved', 'Ordered', 'Delivered', 'Paid', 'Disputed']),
    note: z.string().max(500).optional(),
  }),

  createSupplier: z.object({
    name: z.string().min(2).max(200),
    registration_number: z.string().max(100).optional(),
    contact_email: z.string().email().optional(),
    contact_phone: z.string().max(30).optional(),
    document_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),

  blacklistSupplier: z.object({
    reason: z.string().min(5).max(500),
  }),

  updateComplianceScore: z.object({
    compliance_score: z.number().int().min(0).max(100),
  }),

  createDelivery: z.object({
    requisition_id: z.string().uuid(),
    gps_lat: z.number().min(-90).max(90).optional(),
    gps_lng: z.number().min(-180).max(180).optional(),
    notes: z.string().max(1000).optional(),
  }),

  createPayment: z.object({
    requisition_id: z.string().uuid(),
    delivery_id: z.string().uuid(),
    amount: z.number().positive(),
    currency: z.string().length(3).default('ZMW'),
    payment_reference: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
  }),

  acknowledgeEscalation: z.object({
    escalation_id: z.string().uuid(),
  }),
};

module.exports = { validate, schemas };
