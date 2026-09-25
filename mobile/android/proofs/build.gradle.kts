import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Phase 0 proofs (design doc §11): each file compiles one risky library in THIS
// toolchain (AGP 9.3.1, built-in Kotlin 2.2.10, Compose BOM 2026.08). Never
// depended on by :app; the report lives in docs/mobile/phase0-proofs.md.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

android {
    namespace = "tools.obli.proofs"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core:designsystem"))
    implementation(platform(libs.compose.bom))
    implementation(libs.bundles.compose)

    // Proof 1: terminal emulator (libvterm + Compose renderer).
    implementation(libs.termlib)

    // Proof 2: Navigation 3 + Material 3 adaptive list-detail scene.
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.compose.material3.adaptive.navigation3)

    // Proof 3: Room through KSP2 on AGP 9 built-in Kotlin.
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
    testImplementation(libs.kotlinx.coroutines.test)
}
