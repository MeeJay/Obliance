import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// S90 "Vue web" (design doc §2.8): a WebView on a same-origin path of one
// server, sharing the process-wide CookieManager session; everything else
// leaves through a Custom Tab. Platform module: no Obliance type.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "tools.obli.core.webfallback"
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
    api(project(":core:common"))
    implementation(project(":core:designsystem"))
    implementation(platform(libs.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.core.ktx)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    debugImplementation(libs.compose.ui.test.manifest)
}
