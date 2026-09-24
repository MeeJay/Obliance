import com.android.build.api.variant.ResValue
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// ---------------------------------------------------------------------------
// Secrets and machine-specific values.
//
// Gradle does NOT load local.properties as project properties on its own (this
// is how LifeTrack once lost its release key: the build came out unsigned with
// no error). It is loaded explicitly here, and secret() looks, in order, at:
//   1. -Pname=value
//   2. local.properties (git-ignored)
//   3. the environment variable NAME_WITH_UNDERSCORES (obli.keystore.file ->
//      OBLI_KEYSTORE_FILE)
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

// ---------------------------------------------------------------------------
// Version: a single source of truth, the VERSION file next to this project.
// versionCode = major * 10000 + minor * 100 + patch (1.0.0 -> 10000,
// 1.2.3 -> 10203). Only versionCode is ever compared by the updater.
// ---------------------------------------------------------------------------
val appVersionName: String = rootProject.file("VERSION").readText().trim()
val appVersionCode: Int = run {
    val m = Regex("""^(\d+)\.(\d+)\.(\d+)$""").matchEntire(appVersionName)
        ?: throw GradleException("VERSION must be MAJOR.MINOR.PATCH, got '$appVersionName'")
    val (major, minor, patch) = m.destructured.toList().map { it.toInt() }
    if (minor > 99 || patch > 99) throw GradleException("VERSION minor/patch must be 0..99, got '$appVersionName'")
    if (major < 1 || major > 20000) throw GradleException("VERSION major must be 1..20000, got '$appVersionName'")
    major * 10000 + minor * 100 + patch
}

// ---------------------------------------------------------------------------
// THE app table: the only place per-app data lives. One product flavor per row;
// per-flavor source sets hold resources only (launcher icon), never Kotlin.
// ---------------------------------------------------------------------------
data class ObliApp(val id: String, val displayName: String, val accent: String, val accent2: String)

val obliApps = listOf(
    ObliApp("obliance", "Obliance", "#e03a3a", "#ff6868"),
    ObliApp("obliview", "Obliview", "#2bc4bd", "#5fd9d3"),
    ObliApp("obliguard", "Obliguard", "#f5a623", "#ffb84a"),
    ObliApp("oblimap", "Oblimap", "#1edd8a", "#5cf0a8"),
    ObliApp("obliplan", "Obliplan", "#7c6cff", "#9d86ff"),
    ObliApp("oblidesk", "Oblidesk", "#22b8f5", "#5fd0ff"),
    ObliApp("oblihub", "Oblihub", "#2d4ec9", "#5a78e8"),
)

/** Default server of a flavor, normalised here (a trailing slash in a property
 *  is a doubled slash in every URL built from it). Empty = setup starts empty. */
fun defaultServerUrl(appId: String): String {
    val raw = secret("obli.$appId.server.url") ?: return ""
    val url = raw.trimEnd('/')
    if (!url.startsWith("https://") || url.any { it == '"' || it == '\\' || it.isWhitespace() }) {
        throw GradleException("obli.$appId.server.url must be an https:// URL without quotes or spaces, got '$raw'")
    }
    return url
}

// ---------------------------------------------------------------------------
// Release signing: all four values or none. None -> unsigned release APK (never
// an error). A partial set is a mistake and fails the build loudly.
// ---------------------------------------------------------------------------
val signingKeys = listOf("obli.keystore.file", "obli.keystore.password", "obli.key.alias", "obli.key.password")
val signingValues = signingKeys.associateWith { secret(it) }
val signingReady = signingValues.values.all { it != null }
if (!signingReady && signingValues.values.any { it != null }) {
    val missing = signingValues.filterValues { it == null }.keys
    throw GradleException("Release signing is partially configured; missing: ${missing.joinToString()}")
}

android {
    namespace = "tools.obli.shell"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
        targetSdk = 37
        versionCode = appVersionCode
        versionName = appVersionName

        // All known app ids, from the table above: used by the navigation
        // policy to map another Obli origin to its Android package.
        buildConfigField("String", "OBLI_APP_IDS", "\"${obliApps.joinToString(",") { it.id }}\"")
        buildConfigField("String", "PRODUCT_NAME", "\"Obli Shell\"")
    }

    flavorDimensions += "app"
    productFlavors {
        obliApps.forEach { app ->
            create(app.id) {
                dimension = "app"
                applicationId = "tools.obli.${app.id}"
                resValue("string", "app_name", app.displayName)
                resValue("color", "obli_accent", app.accent)
                resValue("color", "obli_accent2", app.accent2)
                buildConfigField("String", "OBLI_APP", "\"${app.id}\"")
                buildConfigField("String", "DEFAULT_SERVER_URL", "\"${defaultServerUrl(app.id)}\"")
                // Deep link scheme obli-<id>://setup?server=https://...
                manifestPlaceholders["obliScheme"] = "obli-${app.id}"
            }
        }
    }

    signingConfigs {
        if (signingReady) {
            create("release") {
                storeFile = file(signingValues.getValue("obli.keystore.file")!!)
                storePassword = signingValues.getValue("obli.keystore.password")
                keyAlias = signingValues.getValue("obli.key.alias")
                keyPassword = signingValues.getValue("obli.key.password")
            }
        }
    }

    buildTypes {
        debug {
            // Debug and release installs can live side by side.
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
        resValues = true
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
        checkReleaseBuilds = true
        lintConfig = file("lint.xml")
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

// The static launcher shortcut (res/xml/shortcuts.xml) must name the exact
// installed package, which depends on flavor AND build type.
androidComponents {
    onVariants { variant ->
        val flavor = variant.productFlavors.first().second
        val suffix = if (variant.buildType == "debug") ".debug" else ""
        variant.resValues.put(
            variant.makeResValueKey("string", "shortcut_target_package"),
            ResValue("tools.obli.$flavor$suffix", null),
        )
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// Where BridgeScriptTest writes the generated document-start script, so it can
// also be exercised with Node when available.
tasks.withType<Test>().configureEach {
    systemProperty("obli.test.out", layout.buildDirectory.dir("test-out").get().asFile.absolutePath)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.kotlinx.coroutines.android)

    implementation(platform(libs.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.androidx.activity.compose)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.androidx.webkit)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
}
