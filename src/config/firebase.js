const admin = require('firebase-admin');

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

// Railway often stores the key with literal \n and/or wrapping quotes; turn it back into a real PEM.
function cleanKey(raw) {
  let k = raw.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\r/g, '').replace(/\r/g, '').replace(/\\n/g, '\n');
}

let ready = false;
if (!admin.apps.length && FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: cleanKey(FIREBASE_PRIVATE_KEY),
      }),
    });
    ready = true;
  } catch (e) {
    console.error('⚠️ Firebase Admin init fail:', e.message);
  }
} else if (admin.apps.length) {
  ready = true;
} else {
  console.error('⚠️ Firebase env vars set nahi hain — login wale routes kaam nahi karenge.');
}

module.exports = admin;
module.exports.isReady = () => ready;
