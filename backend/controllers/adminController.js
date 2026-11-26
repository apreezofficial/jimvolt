const { validationResult } = require('express-validator')
const adModel = require('../models/adModel')
const categoryModel = require('../models/categoryModel')
const adminModel = require('../models/adminModel')
const sellerModel = require('../models/sellerModel')
const messageModel = require('../models/messageModel')
const { readVerificationFile } = require('../utils/verificationStorage')

function checkValidation(req) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    const error = new Error(errors.array()[0].msg)
    error.statusCode = 400
    throw error
  }
}

function metadata(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  }
}

function pageArgs(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20))
  return { page, limit }
}

function sendMissing(res, message) {
  return res.status(404).json({ message })
}

async function dashboard(req, res) {
  return res.json(await adminModel.getDashboard())
}

async function analytics(req, res) {
  return res.json(await adminModel.getAnalytics())
}

async function advertisements(req, res) {
  checkValidation(req)
  const { page, limit } = pageArgs(req.query)
  const result = await adminModel.listAds({
    q: String(req.query.q || '').trim().slice(0, 120),
    status: req.query.status || null,
    sort: req.query.sort,
    page,
    limit,
  })
  return res.json({ ...result, pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) } })
}

async function viewAdvertisement(req, res) {
  checkValidation(req)
  const advertisement = await adminModel.findAd(req.params.id)
  if (!advertisement) return sendMissing(res, 'Advertisement not found.')
  return res.json({ advertisement })
}

async function changeAdvertisement(req, res, action, options = {}) {
  checkValidation(req)
  const result = await adminModel.moderateAd({
    id: req.params.id,
    administratorId: req.user.id,
    action,
    status: options.status,
    reason: req.body.reason?.trim() || null,
    featured: options.featured,
    reqMeta: metadata(req),
  })
  if (!result) return sendMissing(res, 'Advertisement not found.')
  return res.json({ message: `Advertisement ${action.replaceAll('_', ' ')} completed.` })
}

async function approveAdvertisement(req, res) {
  return changeAdvertisement(req, res, 'approve', { status: 'approved' })
}
async function rejectAdvertisement(req, res) {
  return changeAdvertisement(req, res, 'reject', { status: 'rejected' })
}
async function requestAdvertisementChanges(req, res) {
  return changeAdvertisement(req, res, 'request_changes', { status: 'changes_requested' })
}
async function suspendAdvertisement(req, res) {
  return changeAdvertisement(req, res, 'suspend', { status: 'suspended' })
}
async function reactivateAdvertisement(req, res) {
  return changeAdvertisement(req, res, 'reactivate', { status: 'approved' })
}
async function featureAdvertisement(req, res) {
  return changeAdvertisement(req, res, 'feature', { featured: req.body.featured })
}

async function updateAdvertisement(req, res) {
  checkValidation(req)
  const fields = { ...req.body }
  if (fields.categoryId !== undefined) {
    const category = await categoryModel.findByIdOrSlug(String(fields.categoryId))
    if (!category) {
      const error = new Error('Choose an active category.')
      error.statusCode = 400
      throw error
    }
    fields.categoryId = category.id
  }
  const updated = await adminModel.updateAdFields({
    id: req.params.id,
    fields,
    administratorId: req.user.id,
    reqMeta: metadata(req),
  })
  if (updated === null) return sendMissing(res, 'Advertisement not found.')
  if (!updated) {
    const error = new Error('Provide at least one valid advertisement field to update.')
    error.statusCode = 400
    throw error
  }
  return res.json({ message: 'Advertisement updated.' })
}

async function deleteAdvertisement(req, res) {
  checkValidation(req)
  const deleted = await adminModel.deleteAd(req.params.id, req.user.id, metadata(req))
  if (!deleted) return sendMissing(res, 'Advertisement not found.')
  return res.status(204).end()
}

async function users(req, res) {
  checkValidation(req)
  const { page, limit } = pageArgs(req.query)
  const result = await adminModel.listUsers({
    q: String(req.query.q || '').trim().slice(0, 120),
    role: req.query.role || null,
    status: req.query.status || null,
    verified: req.query.verified === undefined ? null : req.query.verified === 'true',
    verificationStatus: req.query.verificationStatus || null,
    sort: req.query.sort || 'newest',
    page,
    limit,
  })
  return res.json({ ...result, pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) } })
}

async function userDetail(req, res) {
  checkValidation(req)
  const result = await adminModel.getUser(req.params.id)
  if (!result) return sendMissing(res, 'User not found.')
  return res.json(result)
}

function sendUserError(res, error) {
  const messages = {
    not_found: [404, 'User not found.'],
    self: [400, 'You cannot change your own account status or permissions.'],
    forbidden: [403, 'Only a super administrator may manage administrator accounts or permissions.'],
    last_super_admin: [409, 'The last active super administrator cannot be suspended or demoted.'],
  }
  const [status, message] = messages[error] || [400, 'User update could not be completed.']
  return res.status(status).json({ message })
}

async function suspendUser(req, res) {
  checkValidation(req)
  const result = await adminModel.setUserStatus({
    id: req.params.id, administratorId: req.user.id, administratorRole: req.user.role,
    status: 'suspended', reqMeta: metadata(req),
  })
  if (result.error) return sendUserError(res, result.error)
  return res.json({ message: 'User account suspended.' })
}

async function activateUser(req, res) {
  checkValidation(req)
  const result = await adminModel.setUserStatus({
    id: req.params.id, administratorId: req.user.id, administratorRole: req.user.role,
    status: 'active', reqMeta: metadata(req),
  })
  if (result.error) return sendUserError(res, result.error)
  return res.json({ message: 'User account reactivated.' })
}

async function updateUserRole(req, res) {
  checkValidation(req)
  const result = await adminModel.setUserRole({
    id: req.params.id, role: req.body.role, administratorId: req.user.id,
    administratorRole: req.user.role, reqMeta: metadata(req),
  })
  if (result.error) return sendUserError(res, result.error)
  return res.json({ message: 'User role updated.' })
}

async function administrators(req, res) {
  return res.json({ administrators: await adminModel.listAdmins() })
}

async function sellers(req, res) {
  checkValidation(req)
  const { page, limit } = pageArgs(req.query)
  const result = await adminModel.listSellers({
    q: String(req.query.q || '').trim().slice(0, 120), page, limit,
  })
  return res.json({ ...result, pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) } })
}

async function verifications(req, res) {
  checkValidation(req)
  const { page, limit } = pageArgs(req.query)
  const result = await sellerModel.listVerifications({
    status: req.query.status || null,
    q: String(req.query.q || '').trim().slice(0, 120),
    page,
    limit,
  })
  return res.json({
    ...result,
    pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) },
  })
}

async function verificationDetail(req, res) {
  checkValidation(req)
  const verification = await sellerModel.getVerificationDetail(req.params.id)
  if (!verification) return sendMissing(res, 'Verification application not found.')
  return res.json({ verification })
}

async function reviewVerification(req, res, status) {
  checkValidation(req)
  const reason = req.body.reason?.trim() || req.body.notes?.trim() || null
  const userId = await sellerModel.reviewVerification(
    req.params.id, req.user.id, status, reason, metadata(req),
  )
  if (!userId) return sendMissing(res, 'Verification request not found or already reviewed.')
  return res.json({ message: `Seller verification ${status}.` })
}
async function approveVerification(req, res) { return reviewVerification(req, res, 'verified') }
async function rejectVerification(req, res) { return reviewVerification(req, res, 'rejected') }
async function requestVerificationInfo(req, res) {
  checkValidation(req)
  const updated = await sellerModel.requestVerificationInfo(req.params.id, req.user.id, req.body.notes.trim(), metadata(req))
  if (!updated) return sendMissing(res, 'Pending verification request not found.')
  return res.json({ message: 'Additional information requested from seller.' })
}

async function revokeVerification(req, res) {
  checkValidation(req)
  const result = await sellerModel.revokeVerification(
    req.params.id, req.user.id, req.body.reason.trim(), metadata(req),
  )
  if (result === false) return sendMissing(res, 'Verification application not found.')
  if (result === 'not_verified') {
    const error = new Error('Only currently verified applications can be revoked.')
    error.statusCode = 409
    throw error
  }
  return res.json({ message: 'Business verification revoked.' })
}

async function listCategories(req, res) {
  return res.json({ categories: await adminModel.listCategories() })
}
function categorySlug(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 140)
}
async function saveCategory(req, res) {
  checkValidation(req)
  const parentId = req.body.parentId ? Number(req.body.parentId) : null
  const result = await adminModel.saveCategory({
    id: req.params.id ? Number(req.params.id) : null,
    name: req.body.name.trim(),
    slug: req.body.slug?.trim().toLowerCase() || categorySlug(req.body.name.trim()),
    description: req.body.description?.trim() || null,
    image: req.body.image?.trim() || null,
    isActive: req.body.isActive !== false,
    displayOrder: Number(req.body.displayOrder || 0),
    parentId,
    administratorId: req.user.id,
    reqMeta: metadata(req),
  })
  if (!result) return sendMissing(res, 'Category not found.')
  if (result.error) {
    const error = new Error(result.error === 'self_parent'
      ? 'A category cannot be its own subcategory.'
      : 'Choose an existing active parent category.')
    error.statusCode = 400
    throw error
  }
  return res.status(req.params.id ? 200 : 201).json({
    message: req.params.id ? 'Category updated.' : 'Category created.',
    id: result,
  })
}
async function deleteCategory(req, res) {
  checkValidation(req)
  const deleted = await adminModel.deleteCategory(req.params.id, req.user.id, metadata(req))
  if (deleted === false) return sendMissing(res, 'Category not found.')
  if (deleted === 'in_use') {
    const error = new Error('Category has advertisements or subcategories. Reassign them or deactivate the category instead.')
    error.statusCode = 409
    throw error
  }
  return res.status(204).end()
}

async function reports(req, res) {
  checkValidation(req)
  const { page, limit } = pageArgs(req.query)
  const result = await adminModel.listReports({
    status: req.query.status || null,
    category: req.query.category || null,
    q: String(req.query.q || '').trim().slice(0, 120),
    page,
    limit,
  })
  return res.json({ ...result, pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) } })
}
async function resolveReport(req, res, status) {
  checkValidation(req)
  const report = await adminModel.resolveReport({
    id: req.params.id, administratorId: req.user.id, status,
    notes: req.body.notes?.trim() || null, reqMeta: metadata(req),
  })
  if (!report) return sendMissing(res, 'Report not found.')
  if (report.reporter_id) {
    await sellerModel.createNotification({
      userId: report.reporter_id,
      type: `report_${status}`,
      title: status === 'dismissed' ? 'Report reviewed' : 'Report resolved',
      body: `Your report #${req.params.id} has been ${status}.`,
      advertisementId: report.advertisement_id,
    })
  }
  return res.json({ message: `Report ${status}.` })
}
async function resolveReportAction(req, res) { return resolveReport(req, res, 'resolved') }
async function dismissReport(req, res) { return resolveReport(req, res, 'dismissed') }
async function investigateReport(req, res) { return resolveReport(req, res, 'investigating') }

async function investigateReportedConversation(req, res) {
  checkValidation(req)
  const reason = String(req.body.reason || '').trim()
  if (reason.length < 10) {
    const error = new Error('Provide an authorized investigation reason of at least 10 characters.')
    error.statusCode = 400
    throw error
  }
  const report = await adminModel.getReport(req.params.id)
  if (!report || !report.conversation_id) return sendMissing(res, 'Reported conversation not found.')
  if (report.message_id && !(await messageModel.getMessageInConversation(
    report.message_id, report.conversation_id,
  ))) return sendMissing(res, 'Reported message not found in this conversation.')

  const updated = await adminModel.resolveReport({
    id: report.id,
    administratorId: req.user.id,
    status: 'investigating',
    notes: `Authorized conversation investigation: ${reason}`,
    reqMeta: metadata(req),
  })
  if (!updated) return sendMissing(res, 'Report not found.')
  const messages = await messageModel.getReportedConversationMessages(report.conversation_id)
  return res.json({
    reportId: report.id,
    conversationId: report.conversation_id,
    reportedMessageId: report.message_id,
    messages,
  })
}

async function payments(req, res) {
  checkValidation(req)
  const { page, limit } = pageArgs(req.query)
  const result = await adminModel.listPayments({ status: req.query.status || null, page, limit })
  return res.json({ ...result, pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) } })
}
async function auditLogs(req, res) {
  checkValidation(req)
  const { page, limit } = pageArgs(req.query)
  const result = await adminModel.listAuditLogs({
    q: String(req.query.q || '').trim().slice(0, 120), page, limit,
  })
  return res.json({ ...result, pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) } })
}

async function listPending(req, res) {
  return res.json({ advertisements: await adModel.findPending() })
}
async function moderate(req, res) {
  checkValidation(req)
  const action = req.body.status === 'approved' ? 'approve' : 'reject'
  if (action === 'reject' && !req.body.reason?.trim()) {
    return res.status(400).json({ message: 'A reason is required when rejecting an advertisement.' })
  }
  return changeAdvertisement(req, res, action, { status: req.body.status })
}
async function listPendingVerifications(req, res) {
  return res.json({ verifications: await sellerModel.listPendingVerifications() })
}
async function getVerificationDocument(req, res) {
  checkValidation(req)
  const documentType = req.params.document || req.query.document || 'identity'
  const filePath = await sellerModel.getVerificationDocument(req.params.id, documentType)
  if (!filePath) {
    return sendMissing(res, 'Verification document not found.')
  }
  const { data } = await readVerificationFile(filePath)
  const extension = filePath.split('.').pop().toLowerCase()
  const contentType = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
  }[extension]
  if (!contentType) return sendMissing(res, 'Verification document not found.')
  res.set('Cache-Control', 'private, no-store')
  res.set('Content-Type', contentType)
  res.set('Content-Disposition', `attachment; filename="verification-document.${extension}"`)
  res.set('X-Content-Type-Options', 'nosniff')
  return res.send(data)
}
async function moderateVerification(req, res) {
  return reviewVerification(req, res, req.body.status)
}

module.exports = {
  activateUser, administrators, analytics, approveAdvertisement, approveVerification, auditLogs,
  advertisements, dashboard, deleteAdvertisement, deleteCategory, dismissReport,
  getVerificationDocument, investigateReport, listCategories, listPending, listPendingVerifications,
  investigateReportedConversation, moderate, moderateVerification, payments, reactivateAdvertisement, rejectAdvertisement,
  rejectVerification, reports, requestAdvertisementChanges, requestVerificationInfo,
  resolveReportAction, revokeVerification, saveCategory, sellers, suspendAdvertisement, suspendUser,
  updateAdvertisement, updateUserRole, userDetail, users, verifications,
  verificationDetail, viewAdvertisement, featureAdvertisement,
}
