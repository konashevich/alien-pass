# Android launcher icon

This app now uses the same AlienPass glyph as the website for the Android launcher icon.

- Foreground: `res/drawable/ic_alienpass_foreground.xml` (VectorDrawable with the AlienPass shape in brand blue `#3b82f6`).
- Background: `res/values/ic_launcher_background.xml` set to dark `#0b0b0c` to match the site background and provide contrast.
- Adaptive icon XMLs:
  - `res/mipmap-anydpi-v26/ic_launcher.xml`
  - `res/mipmap-anydpi-v26/ic_launcher_round.xml`
  Both point to `@drawable/ic_alienpass_foreground`.

Notes

- Min SDK is 22. On Android < 8.0 (API < 26), legacy PNG mipmaps (`mipmap-*/ic_launcher.png`) are used by the OS. If you need the new look on very old devices, regenerate those PNGs (e.g., via Android Studio Image Asset) using the same foreground and background.
- On Android 8.0+ the adaptive icon above is used automatically.

Build tips

- After changes, rebuild the app (debug):
  - From `android/`: `./gradlew :app:assembleDebug`.
- If icons don’t update on device/emulator, clear the app data or uninstall before reinstalling; the launcher may cache icons.
