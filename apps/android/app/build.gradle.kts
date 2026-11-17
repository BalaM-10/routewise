import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.services)
}

// Release signing comes from apps/android/keystore.properties, which stays on the developer's computer
// (git-ignored, as is the keystore itself). Without it, release builds are simply unsigned.
val keystoreProps = Properties().apply {
    rootProject.file("keystore.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}

android {
    namespace = "com.routewise.shopdesk"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.routewise.shopdesk"
        // firebase-ai-ondevice needs API 26.
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.1"
    }

    signingConfigs {
        if (!keystoreProps.isEmpty) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

}

// The same tickets and orders as the web app, read straight from the engine package,
// so both platforms are always tested on identical data.
androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addStaticSourceDirectory(rootDir.resolve("../../packages/core/src/data").canonicalPath)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.ai)
    implementation(libs.firebase.ai.ondevice)
    implementation(libs.firebase.config)
    // App Check: a debug token while developing, Play Integrity in release builds.
    debugImplementation(libs.firebase.appcheck.debug)
    releaseImplementation(libs.firebase.appcheck.playintegrity)
}
