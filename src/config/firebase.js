const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Resolve service account path with multiple fallbacks:
// 1) Use environment variable FIREBASE_SERVICE_ACCOUNT (absolute or relative to project root)
// 2) Try known filenames (previous default)
// 3) Try to find first .json in project root that looks like a service account file
const projectRoot = path.resolve(__dirname, '../../');
let serviceAccountPath = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const candidate = path.isAbsolute(process.env.FIREBASE_SERVICE_ACCOUNT)
    ? process.env.FIREBASE_SERVICE_ACCOUNT
    : path.resolve(projectRoot, process.env.FIREBASE_SERVICE_ACCOUNT);
  if (fs.existsSync(candidate)) serviceAccountPath = candidate;
}

// common fallback name used previously
const fallbackNames = [
  'jejakberkas-99011-firebase-adminsdk-fbsvc-03113f6290.json',
  'serviceAccountKey.json',
  'firebase-service-account.json',
  'firebase-adminsdk.json'
];

if (!serviceAccountPath) {
  for (const name of fallbackNames) {
    const p = path.resolve(projectRoot, name);
    if (fs.existsSync(p)) { serviceAccountPath = p; break; }
  }
}

// last resort: try to find any json file in project root that contains 'firebase' or 'adminsdk' in filename
if (!serviceAccountPath) {
  try {
    const files = fs.readdirSync(projectRoot);
    for (const f of files) {
      if (f.toLowerCase().endsWith('.json') && (f.toLowerCase().includes('firebase') || f.toLowerCase().includes('adminsdk') || f.toLowerCase().includes('serviceaccount'))) {
        const candidate = path.resolve(projectRoot, f);
        if (fs.existsSync(candidate)) { serviceAccountPath = candidate; break; }
      }
    }
  } catch (e) {
    // ignore
  }
}

if (!serviceAccountPath) {
  throw new Error(
    `Firebase service account not found. Please set FIREBASE_SERVICE_ACCOUNT env var or place a service account JSON in project root.\n` +
    `Tried these fallback names: ${fallbackNames.join(', ')}\n` +
    `Current project root: ${projectRoot}`
  );
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

module.exports = db;