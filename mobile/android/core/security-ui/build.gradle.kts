import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Root host of the action prompts (design doc §7.6, §10.4, S41–S44): the
// Compose side of core:security's ActionRunner, the biometric step and the
// result messages. Platform module: no Obliance type.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "tools.obli.core.security.ui"
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
    api(project(":core:security"))
    implementation(project(":core:designsystem"))
    implementation(platform(libs.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.kotlinx.coroutines.test)
    debugImplementation(libs.compose.ui.test.manifest)
}
