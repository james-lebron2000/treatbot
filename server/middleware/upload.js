const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const uploadDir = path.join(__dirname, '../uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf' || file.mimetype === 'text/plain') {
    return cb(null, true);
  }
  return cb(new Error('Only PDF, image, and text files are allowed'));
};

const maxFileSize = Number(process.env.UPLOAD_MAX_BYTES || 50 * 1024 * 1024);

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: maxFileSize
  }
});
