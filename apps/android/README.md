# Shopdesk for Android

The same Shopdesk flow on a phone, through Firebase AI Logic hybrid inference: Gemini Nano on the phone through AICore, Gemini in the cloud. It follows the same published routes as the web app, uses the same tickets and orders (read straight from `packages/core/src/data`), and can calibrate on the phone the steps that have known answers.

Hybrid inference on Android is an experimental Firebase feature. The on-device model is chosen on the Calibrate tab: Standard (`OnDeviceModelOption.STABLE`, Gemini Nano 2 or 3), Nano 4 Full (`PREVIEW`) or Nano 4 Fast (`PREVIEW_FAST`). The Nano 4 categories need the [AICore developer preview](https://developers.google.com/ml-kit/genai/aicore-dev-preview) on the phone. Every calibration records which category it ran on. It needs a phone that supports Gemini Nano through ML Kit and AICore, such as recent Pixel phones.

## Run it

1. Register an Android app in the Firebase project with package `com.routewise.shopdesk`, download `google-services.json` and put it in `app/`. It is git-ignored; never commit it.
2. Open this folder in Android Studio, or build from a terminal:
   ```
   ./gradlew :app:installDebug
   ```
3. App Check: debug builds print `Enter this debug secret into the allow list` in Logcat. Add that token in the Firebase console under App Check, the Android app, **Manage debug tokens**. Release builds use Play Integrity.

## What is on each tab

- **Shopdesk.** The inbox is sorted on the phone; opening a ticket reads its order details; replies and summaries are written in the cloud from text with personal details removed, with the order facts and the shop voice. A two-lane trace shows where each step ran. The owner can hide anything else, see exactly what the cloud receives, copy the reply and resolve the ticket.
- **Routes.** The published routes as a route map, with what each one means.
- **Calibrate.** Sorting, order details and finding personal details run on Gemini Nano and in the cloud for every fictional ticket in the shared set and are checked against known answers. Keep the app open and the screen on while it runs; if Android pauses Gemini Nano because the app went to the background, the run waits and asks again. **Share the routes** gives the policy text for the Remote Config parameter `routewise_policy_android`, and every finished run is also saved to the app's files folder, where adb can copy it:
  ```
  adb pull /sdcard/Android/data/com.routewise.shopdesk/files/routewise_policy_android.json .
  adb pull /sdcard/Android/data/com.routewise.shopdesk/files/routewise_report_android.json .
  ```
  The report holds every example's answer, result and timing on the phone and in the cloud, and which Gemini Nano category ran; tickets are referred to by number. Each finished step is kept if a run is stopped.

## How it differs from the web app

- On-device structured output on Android needs generated schema classes, so the JSON steps state the shape in the prompt and every answer is checked; calibration measures how often that works on the phone.
- Phone models accept about 4,000 tokens, so every route is limited to 2,500 words; longer text goes to the cloud.
- Gemini Nano runs only while the app is in the foreground, and AICore limits how often one app can call it; a busy answer is retried with a short backoff.
- Any step that has not answered within 30 seconds counts as failed, and the normal fallback applies.
