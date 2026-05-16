const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Selalu resolve dari lokasi file ini (src/config/) → naik 2 level ke root proyek
const serviceAccountPath = path.resolve(__dirname, '../../jejakberkas-99011-firebase-adminsdk-fbsvc-03113f6290.json');

if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(`Firebase service account file not found at: ${serviceAccountPath}`);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

module.exports = db;