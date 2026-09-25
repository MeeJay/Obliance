import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// The native Obliance application (alpha): assembles the screen modules into
// the shell of design doc §2 (5 destinations, scope chip, per-destination back
// stacks). Installs NEXT TO the WebView app (different applicationId).
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    // Navigation 3 keys are @Serializable (rememberNavBackStack saves them).
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "tools.obli.obliance.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "tools.obli.obliance.next"
        minSdk = 26
        targetSdk = 37
        versionCode = 2
        versionName = "0.2.0-alpha"
    }

    buildTypes {
        // Only debug is used for the alpha; it is signed with the default debug key.
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
        // Screen modules' resources (strings en + fr) are checked with the app.
        checkDependencies = true
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/versions/9/OSGI-INF/MANIFEST.MF",
            )
        }
    }
}

// Screenshots of the shell (Roborazzi on Robolectric).
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
    implementation(project(":core:data"))
    implementation(project(":core:realtime"))
    // Action prompts (S41–S44, biometric) and the S90 web view.
    implementation(project(":core:security-ui"))
    implementation(project(":core:webfallback"))
    implementation(project(":obliance:data"))
    implementation(project(":obliance:access"))
    implementation(project(":obliance:triage"))
    implementation(project(":obliance:devices"))
    implementation(project(":obliance:fleet"))
    implementation(project(":obliance:more"))
    // 0.2.0 "Agir": terminal, ObliReach, sessions; scripts, batches, scenarios, Activité.
    implementation(project(":obliance:remote"))
    implementation(project(":obliance:automations"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    // FragmentActivity + AppCompat theme for BiometricPrompt (its API < 28 dialog needs it).
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    implementation(platform(libs.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.compose.material3.adaptive.navigation.suite)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.compose.material3.adaptive.navigation3)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    // MainActivity smoke test: the real repositories against fake Obliance servers.
    testImplementation(libs.okhttp.mockwebserver)
    debugImplementation(libs.compose.ui.test.manifest)
}
