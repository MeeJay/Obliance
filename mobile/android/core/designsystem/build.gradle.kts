import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Design system of the Obli apps (design doc §8): tokens, theme, components.
// Accent colours are injected per app (ObliAccent); nothing Obliance-specific.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "tools.obli.core.designsystem"
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

// Screenshots (Roborazzi on Robolectric: no emulator on the build hosts).
// Recorded under build/outputs/roborazzi; compared later against goldens.
tasks.withType<Test>().configureEach {
    systemProperty("roborazzi.test.record", "true")
    systemProperty("roborazzi.output.dir", layout.buildDirectory.dir("outputs/roborazzi").get().asFile.absolutePath)
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    api(project(":core:model"))
    api(platform(libs.compose.bom))
    api(libs.bundles.compose)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    debugImplementation(libs.compose.ui.test.manifest)
}
