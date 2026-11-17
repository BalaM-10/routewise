package com.routewise.shopdesk

import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/** Debug builds print a debug token to Logcat, which you register in the Firebase console. */
internal fun installAppCheck() {
    Firebase.appCheck.installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
}
