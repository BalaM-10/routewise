# Shopdesk for Android

The same Shopdesk flow on a phone, through Firebase AI Logic hybrid inference (Gemini Nano on the phone, Gemini in the cloud). It reads the same published routes as the web app, and can calibrate the steps that have known answers on the phone itself.

Requires a phone that supports Gemini Nano through ML Kit and AICore (for example Pixel 9, 10 or 11). Hybrid inference on Android is an experimental Firebase feature.

## Set up

1. In Android Studio, create a project: **Empty Activity**, name `Shopdesk`, package `com.routewise.shopdesk`, Kotlin, minimum SDK **API 26**, Kotlin DSL.
2. Copy `app/src/main/java/com/routewise/shopdesk/*.kt` from this folder into the same folder of the new project, replacing `MainActivity.kt`.
3. In `app/src/main/AndroidManifest.xml`, add the internet permission above `<application`, and the application class inside the `<application` tag:
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   ```
   ```xml
   android:name=".ShopdeskApp"
   ```
4. In the project-level `build.gradle.kts`, add to `plugins { }`:
   ```kotlin
   id("com.google.gms.google-services") version "4.4.2" apply false
   ```
5. In `app/build.gradle.kts`, add to `plugins { }`:
   ```kotlin
   id("com.google.gms.google-services")
   ```
   and to `dependencies { }`:
   ```kotlin
   implementation(platform("com.google.firebase:firebase-bom:34.10.0"))
   implementation("com.google.firebase:firebase-config")
   implementation("com.google.firebase:firebase-appcheck-debug")
   implementation("com.google.firebase:firebase-ai:18.2.0")
   implementation("com.google.firebase:firebase-ai-ondevice:16.0.0-beta08")
   ```
6. In the Firebase console, register an Android app with package `com.routewise.shopdesk`, download `google-services.json` and put it in the `app/` folder. Do not commit it to a public repository.
7. Click **Sync Now**, then run the app on the phone with USB debugging on.
8. App Check: find the line `Enter this debug secret into the allow list` in Logcat, and add that token in the Firebase console under App Check, Apps, the Android app, Manage debug tokens.

If an import is flagged in red after syncing, place the cursor on it and press Alt+Enter to import it from the Firebase AI Logic library; package names of the experimental on-device library can change between beta releases.

## How it differs from the web app

- Android's on-device structured output needs generated schema classes, so these steps ask for JSON in the prompt and the app checks every answer. Calibration measures how often that works on the phone.
- Phone models accept about 4,000 tokens, so every route is limited to 2,500 words; longer tickets go to the cloud.
- On-device inference runs only while the app is in the foreground, and AICore limits how often one app can call it.

## Calibrate on the phone

The Calibrate tab runs sorting, order details and finding personal details on Gemini Nano and in the cloud for 48 fictional tickets each, scores them against known answers, and decides a route per step. **Share the routes** produces the policy text; paste it into the Remote Config parameter `routewise_policy_android` and publish. The phone then uses its own measured routes for those steps and the web-measured routes for writing replies and summaries.
