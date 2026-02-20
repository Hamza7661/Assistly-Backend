/**
 * Chat Upload Routes
 * Handles file uploads from chat widget users (e.g. resumes, documents)
 */
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { AppError } = require('../utils/errorHandler');
const { logger } = require('../utils/logger');
const { uploadDocumentSingle } = require('../middleware/upload');

const router = express.Router();

// In-memory store for uploaded chat files (keyed by fileId)
// In production, replace with cloud storage (S3, GCS, etc.)
const chatFileStore = new Map();

// Clean up files older than 24 hours periodically
const FILE_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of chatFileStore.entries()) {
    if (now - entry.uploadedAt > FILE_TTL_MS) {
      chatFileStore.delete(id);
    }
  }
}, 60 * 60 * 1000); // Run every hour

// Upload a file from the chat widget (no auth required – public user action)
router.post('/apps/:appId', uploadDocumentSingle('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No file provided', 400);
    }

    const { appId } = req.params;
    const fileId = crypto.randomUUID();

    chatFileStore.set(fileId, {
      appId,
      data: req.file.buffer,
      contentType: req.file.mimetype,
      filename: req.file.originalname,
      size: req.file.size,
      uploadedAt: Date.now()
    });

    logger.info('Chat file uploaded', { fileId, appId, filename: req.file.originalname, size: req.file.size });

    res.status(201).json({
      status: 'success',
      message: 'File uploaded successfully',
      data: {
        fileId,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        size: req.file.size
      }
    });
  } catch (err) {
    next(err);
  }
});

// Download/view a chat-uploaded file (by fileId)
router.get('/:fileId', async (req, res, next) => {
  try {
    const { fileId } = req.params;
    const entry = chatFileStore.get(fileId);

    if (!entry) {
      throw new AppError('File not found or expired', 404);
    }

    res.set('Content-Type', entry.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${entry.filename || 'file'}"`);
    res.send(entry.data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
