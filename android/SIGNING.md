# Sign and build Play Store AAB

This project uses a property-based signing setup.

## 1) Get your existing keystore

If your keystore is stored on another machine/Android Studio project, copy the keystore file (e.g., `my-release-key.jks` or `.keystore`) to this machine. You can place it anywhere (inside or outside the repo). For convenience, you can put it in `android/` but it’s fine to keep it outside the project.

## 2) Create `keystore.properties`

Copy `android/keystore.properties.example` to `android/keystore.properties` and fill values:

```properties
storeFile=/absolute/path/to/your-release-key.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=YOUR_KEY_ALIAS
keyPassword=YOUR_KEY_PASSWORD
```

Notes:

- `storeFile` can be an absolute path or a path relative to the `android/` folder.
- The file `android/keystore.properties` and `*.jks/*.keystore` are ignored by git.

## 3) Build a signed AAB (Play Store)

From the `android/` folder:

```bash
./gradlew :app:bundleRelease
```

The output will be at:

- `android/app/build/outputs/bundle/release/app-release.aab`

Gradle will sign the AAB automatically using `keystore.properties`.

## 4) Optional: Build a signed APK (for side-loading)

```bash
./gradlew :app:assembleRelease
```

Output:

- `android/app/build/outputs/apk/release/app-release.apk`

## 5) If you don’t have the passwords

If you don’t remember the store or key passwords, you must retrieve them from the original machine or the person who created the keystore. There’s no way to recover a lost keystore.

## 6) Play App Signing reminder

If your app uses Play App Signing (recommended), you still upload a signed AAB. Google will manage distribution signing keys. Keep your upload keystore safe—the alias and passwords must match what Play expects for your app.

---

## Build a signed AAB in GitHub Actions (remote build)

If your local machine (e.g., Linux ARM64/aarch64) doesn’t have supported Android SDK CLI tooling, you can build in CI:

1. Add repository secrets (Settings → Secrets and variables → Actions):
   - `ANDROID_KEYSTORE_BASE64`: base64 of your keystore file (.jks/.keystore)
   - `ANDROID_KEYSTORE_STORE_PASSWORD`: keystore password
   - `ANDROID_KEYSTORE_ALIAS`: key alias
   - `ANDROID_KEYSTORE_KEY_PASSWORD`: key password
   You can generate base64 on Linux/Mac: `base64 -w0 your-key.jks` (omit `-w0` on macOS: `base64 your-key.jks`)

2. Run the workflow "Build AAB (Release)" from the Actions tab.
   - Optionally pass `versionCode` and/or `versionName` inputs.

3. Download `app-release.aab` from the workflow artifacts.

The workflow sets up the Android SDK on `ubuntu-latest`, injects the keystore, and runs `:app:bundleRelease`.
