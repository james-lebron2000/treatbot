const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const patientController = require('../controllers/patientController');
const asyncHandler = require('../utils/asyncHandler');

// All patient routes require auth
router.use(authenticateToken);

// List patients for current user
router.get('/', asyncHandler(patientController.listPatients));

// Create patient
router.post('/', asyncHandler(patientController.createPatient));

// Patient record operations must come before dynamic id routes
router.get('/:id/records', asyncHandler(patientController.listPatientRecords));

// Get one patient
router.get('/:id', asyncHandler(patientController.getPatient));

// Update patient
router.put('/:id', asyncHandler(patientController.updatePatient));

// Delete patient (soft delete optional; here hard delete plus records unlinked)
router.delete('/:id', asyncHandler(patientController.deletePatient));

// Attach an existing medical record to patient
router.post('/:id/attach-record', asyncHandler(patientController.attachMedicalRecord));

// Trigger AI integration for latest medical record (or with provided text)
router.post('/:id/integrate', asyncHandler(patientController.integratePatientRecord));

// Trigger LLM matching using CSV + prompt for this patient
router.post('/:id/match', asyncHandler(patientController.matchPatientTrials));

module.exports = router;
