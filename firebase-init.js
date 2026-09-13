/* =========================================================
   Firebase init — connects the app to your Firebase project
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyAGufCRzM4vHPOllRS8nb7F1_x3grDMBok",
  authDomain: "ragab-s-smart-management-54797.firebaseapp.com",
  projectId: "ragab-s-smart-management-54797",
  storageBucket: "ragab-s-smart-management-54797.firebasestorage.app",
  messagingSenderId: "856250730878",
  appId: "1:856250730878:web:ab47786a851f0c0d6b4b2f",
  measurementId: "G-7JSZ04202B"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Let the app keep working (reading/writing) even when there's no internet;
// Firestore will sync automatically once the connection comes back.
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn('Firestore offline persistence not enabled:', err.code);
});
