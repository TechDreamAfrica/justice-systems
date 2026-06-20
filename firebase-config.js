// ============================================================
// firebase-config.js
// Firebase initialization — replace placeholder values with
// your actual project credentials from the Firebase Console.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// 🔑 Replace each value with your Firebase project's credentials.
//    Find them in the Firebase Console → Project Settings → Your apps.
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Initialize Firebase core
const app  = initializeApp(firebaseConfig);

// Export service instances for use throughout the app
export const auth = getAuth(app);
export const db   = getFirestore(app);
