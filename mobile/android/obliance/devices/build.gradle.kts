import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Obliance screen module (see obliance/CONTRACT.md): depends on :core:* and the
// Obliance plumbing only, never on another screen module or on :obliance:app.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "tools.obli.obliance.devices"
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

// Screenshots (Roborazzi on Robolectric), recorded under build/outputs/roborazzi.
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
    implementation(project(":core:designsystem"))
    implementation(project(":obliance:data"))
    implementation(project(":core:security-ui"))
    implementation(platform(libs.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    debugImplementation(libs.compose.ui.test.manifest)
}
