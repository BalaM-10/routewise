package com.routewise.shopdesk

import android.app.Application
import android.content.pm.ApplicationInfo
import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import com.google.firebase.initialize

class ShopdeskApp : Application() {
    override fun onCreate() {
        super.onCreate()
        loadTickets(this)
        Firebase.initialize(this)
        // Debug builds only: prints a debug token to Logcat, which you register in the Firebase console.
        // A release build would use Play Integrity instead.
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            Firebase.appCheck.installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
        }
    }
}
