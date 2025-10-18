# AlienPass Android APK (Offline)

This project is a static web app that runs fully offline. The steps below package it as an Android APK using Capacitor, bundling all files locally inside a WebView (no network wrapping).

## What you get
- A single APK with local assets (index.html, js, icons).
- Works offline. Vault uses IndexedDB in the WebView.
- No external CDNs; everything is shipped with the app.

## Prerequisites (Linux)
- Node.js 18+ and npm
- Java JDK 17 (or 11)
- Android SDK + build-tools (via Android Studio or sdkmanager)
- Set SDK path (choose one):
  - ANDROID_SDK_ROOT env var
  - Or create `android/local.properties` with: `sdk.dir=/absolute/path/to/Android/Sdk`

## Install dependencies
```bash
npm install
```

## Add Android platform (already done in this repo)
If starting fresh:
```bash
npx cap add android
```

## Copy web assets to native project
Whenever you change web files, re-copy:
```bash
npx cap copy android
```

## Build APK
GUI (optional):
```bash
npx cap open android
```
Then Build > Build APK(s) in Android Studio.

CLI via Gradle:
```bash
cd android
./gradlew assembleDebug
```
The APK will be in `android/app/build/outputs/apk/debug/`.

## Notes
- Service worker is disabled inside native WebViews; the app is local anyway.
- If you change the app id/name, edit `capacitor.config.json`.
- If you move files, ensure `webDir` points to the folder containing `index.html` (here: `www`).
