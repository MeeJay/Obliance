import java.util.Properties
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

// ---------------------------------------------------------------------------
// Secrets, same rules as the WebView :app module. Gradle does NOT load
// local.properties as project properties on its own: it is loaded explicitly
// here, and secret() looks, in order, at:
//   1. -Pname=value
//   2. local.properties (git-ignored)
//   3. the environment variable NAME_WITH_UNDERSCORES (obli.keystore.file ->
//      OBLI_KEYSTORE_FILE)
// Values are never printed; a partial set only names the missing KEYS.
// ---------------------------------------------------------------------------
val localProperties: Properties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun secret(name: String): String? =
    ((project.findProperty(name) as String?)
        ?: localProperties.getProperty(name)
        ?: System.getenv(name.replace('.', '_').uppercase()))
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

// Release signing: all four values or none. None -> unsigned release APK (never
// an error). A partial set is a mistake and fails the build loudly. The key is
// the one of the WebView shell (RELEASE-FINGERPRINT.txt): the in-app updater
// (S86) refuses an APK whose signer differs from the installed one.
val signingKeys = listOf("obli.keystore.file", "obli.keystore.password", "obli.key.alias", "obli.key.password")
val signingValues = signingKeys.associateWith { secret(it) }
val signingReady = signingValues.values.all { it != null }
if (!signingReady && signingValues.values.any { it != null }) {
    val missing = signingValues.filterValues { it == null }.keys
    throw GradleException("Release signing is partially configured; missing: ${missing.joinToString()}")
}

android {
    namespace = "tools.obli.obliance.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "tools.obli.obliance.next"
        minSdk = 26
        targetSdk = 37
        // 0.3.0: background notifications, enrolments, global-view filter, app settings.
        // (mobile/android/VERSION belongs to the WebView :app and is not used here.)
        versionCode = 3
        versionName = "0.3.0-alpha"
    }

    signingConfigs {
        if (signingReady) {
            create("release") {
                // An absolute path is used as is; a relative one is resolved next to local.properties.
                storeFile = rootProject.file(signingValues.getValue("obli.keystore.file")!!)
                storePassword = signingValues.getValue("obli.keystore.password")
                keyAlias = signingValues.getValue("obli.key.alias")
                keyPassword = signingValues.getValue("obli.key.password")
            }
        }
    }

    buildTypes {
        // Debug is signed with the local debug key. Release is signed with the
        // obli.keystore.* key when it is configured, unsigned otherwise. A debug
        // install must be uninstalled before the first release-signed install
        // (different signer, same applicationId).
        release {
            // Alpha: no shrinking yet (reflection in serialization / Socket.IO not audited).
            isMinifyEnabled = false
            if (signingReady) {
                signingConfig = signingConfigs.getByName("release")
            }
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
    // 0.3.0: background notifications of every server, S84, the Quick Settings tile.
    implementation(project(":obliance:notifications"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    // FragmentActivity + AppCompat theme for BiometricPrompt (its API < 28 dialog needs it).
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.lifecycle.runtime.compose)
    // Foreground / background of the process: the socket only lives in the foreground.
    implementation(libs.androidx.lifecycle.process)
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
