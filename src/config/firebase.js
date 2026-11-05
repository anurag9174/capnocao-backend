const admin = require('firebase-admin');

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

let ready = false;
if (!admin.apps.length && FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\n/g, '\n'),
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
