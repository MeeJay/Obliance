// Root build script: declares the plugins used by the single `:app` module.
// AGP 9 ships Kotlin itself ("built-in Kotlin"): org.jetbrains.kotlin.android
// must NOT be applied anywhere in this project.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
