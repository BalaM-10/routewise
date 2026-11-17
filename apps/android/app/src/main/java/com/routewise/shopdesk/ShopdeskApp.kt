package com.routewise.shopdesk

import android.app.Application
import com.google.firebase.Firebase
import com.google.firebase.initialize

class ShopdeskApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Data.load(this)
        Firebase.initialize(this)
        installAppCheck()
    }
}
